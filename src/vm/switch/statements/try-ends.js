import {
  dominators,
  laterEnds,
  reachableBlockIds,
  walkForward,
} from './graph.js'
import { enclosingLoopStops, transfersFrom } from './loop-ends.js'

/**
 * Where each try closes, over a function's graph (`view`), the regions found so far (`regions`),
 * the loop and try heads (`entries`), the loop ends (`loopEnds`) and the switch ends holding a
 * head (`switchEnds`). `bounds(head)` gives a try's end, its layout end, its labeled later ends
 * and the enclosing loops a continue from inside it reaches.
 */
export class TryEnds {
  constructor(view, regions, entries, loopEnds, switchEnds) {
    Object.assign(this, { view, regions, entries, loopEnds, switchEnds })
  }

  // A try's end, its layout end and its labeled later ends. The compiler emits one normal tail per
  // try; another (a reachable injected copy, say) leaves through the first, and the rest are
  // walked as routed exits. An end whose members are not closed is dropped.
  bounds(head) {
    const { view } = this
    const loopsOutside = this.loopsContinuedFrom(head)
    const tails = this.tryTails(head, loopsOutside)
    let continuation = tails.length ? view.sortedByPc(tails)[0] : null
    let layoutEnd = continuation ? null : this.catchLayoutEnd(head)
    const { blockEnds, cuts } = this.tryLaterEnds(
      head,
      continuation ?? layoutEnd,
      loopsOutside.map((region) => region.trailing[0]),
    )
    if (
      continuation &&
      !view.closed(head, view.membersOf(head, continuation, cuts), 'try')
    )
      continuation = null
    // A labeled exit from a loop inside the try to the try's own end: a break leaves only the
    // loop, so the try is a labeled block ending at its end.
    const labeledEnd =
      continuation &&
      !blockEnds.length &&
      this.loopExitsTo(continuation, view.membersOf(head, continuation, cuts))
    // A continuation the closure check dropped leaves the try to its layout end as well.
    if (!continuation && !layoutEnd) layoutEnd = this.catchLayoutEnd(head)
    return {
      continuation,
      layoutEnd,
      blockEnds: labeledEnd ? [continuation] : blockEnds,
      cuts,
      loopsOutside,
    }
  }

  // The pops of a try's own handler record: `[pc, record]` for each.
  popsOf(head) {
    const setupPc = this.view.lastLeaf(head).pc
    const { stateIn } = this.view
    return [...this.view.leafByPc]
      .filter(
        ([pc, leaf]) =>
          leaf.operation.kind === 'handler-pop' &&
          stateIn.get(pc)?.at(-1)?.setupPc === setupPc,
      )
      .map(([pc]) => [pc, stateIn.get(pc).at(-1)])
  }

  // The block a route leads to through jump steps only it enters: a jump step that several
  // routes enter is where they meet, a location (a try nested in a catch ends at the jump that
  // its own pops and its catch share).
  ownSteps(id) {
    const { view } = this
    const seen = new Set()
    while (
      view.jumpOnly(id) &&
      !seen.has(id) &&
      view.normalNext(id).length === 1 &&
      view.normalPredecessors(id).length === 1
    ) {
      seen.add(id)
      id = view.normalNext(id)[0]
    }
    return id
  }

  // Where a catch-only try completes when its catch completes normally: a native try statement
  // ends where its block's normal end and its catch's normal end meet. Each pop is followed
  // through its own jump steps to the block it leads to; of those the catch's own normal walk
  // (never passing the setup again, so a loop's next iteration is not the catch completing)
  // reaches, the end is the one it reaches first, which dominates the others over that walk. A
  // pop of a break or continue crossing the try leads to a block the catch reaches only through
  // the end, or to an enclosing loop's head or end, which is never the end. Null when the catch
  // never completes normally.
  catchEnd(head, enclosing) {
    const { view } = this
    const setup = view.lastLeaf(head).operation
    const handler = view.graph.byPc.get(setup.target)?.id
    if (setup.kind !== 'catch-setup' || !handler) return null
    const walk = new Set()
    const queue = [handler]
    for (const id of queue) {
      if (walk.has(id) || id === head) continue
      walk.add(id)
      queue.push(...view.normalNext(id))
    }
    const reached = [
      ...new Set(
        this.popsOf(head)
          .map(([pc]) => view.fallthroughPc(pc))
          .filter((pc) => pc != null)
          .map((pc) => this.ownSteps(view.graph.byPc.get(pc).id)),
      ),
    ].filter((id) => walk.has(id) && !enclosing.has(id))
    const { dom } = dominators(walk, handler, view.normalEdges)
    return (
      reached.find((id) => reached.every((other) => dom.get(other).has(id))) ??
      null
    )
  }

  // Jump steps may sit between any two steps of a finally's tail.
  finallyTailStep(leaf, record) {
    const { view } = this
    const seen = new Set()
    while (
      leaf?.operation.kind === 'jump' &&
      view.outgoing(leaf.pc)[0]?.targetPc !== record.target &&
      !seen.has(leaf.pc)
    ) {
      seen.add(leaf.pc)
      leaf = view.leafByPc.get(view.outgoing(leaf.pc)[0]?.targetPc)
    }
    return leaf
  }

  // The block a catch pop's exit tail leads to: the target of the compiler's exit jump after it. A
  // pop that falls into code (a return crossing the try) ends nothing; a reordered normal exit of
  // such a catch that dropped the jump has the same graph.
  catchTailTarget(next) {
    const jump =
      next?.operation.kind === 'jump' ? this.view.outgoing(next.pc)[0] : null
    return (
      (jump?.targetPc != null && this.view.graph.byPc.get(jump.targetPc)) ||
      null
    )
  }

  // The block a finally pop's exit tail leads to: the pad its continuation write names, when the
  // tail jumps to the finalizer.
  finallyTailTarget(next, record) {
    const { view } = this
    const write = this.finallyTailStep(next, record)
    const jump =
      write &&
      this.finallyTailStep(
        view.leafByPc.get(view.fallthroughPc(write.pc)),
        record,
      )
    return (
      (write?.operation.kind === 'assign' &&
        write.operation.destination === record.continuation &&
        write.operation.value.kind === 'literal' &&
        jump?.operation.kind === 'jump' &&
        view.outgoing(jump.pc)[0]?.targetPc === record.target &&
        view.graph.byPc.get(write.operation.value.value)) ||
      null
    )
  }

  // Blocks of a try's normal exit tails, found from the pops of its own handler record.
  exitTails(head) {
    const targets = new Set()
    for (const [pc, record] of this.popsOf(head)) {
      const next = this.view.leafByPc.get(this.view.fallthroughPc(pc))
      if (record.kind === 'catch') {
        const target = this.catchTailTarget(next)
        if (target) targets.add(target.id)
        continue
      }
      const target = this.finallyTailTarget(next, record)
      if (target) targets.add(this.view.throughJumps(target.id))
    }
    return targets
  }

  // Where a finally with no reachable normal tail ends: where its routed exits land. Each exit
  // names a pad; one that jumps, or opens the enclosing finally's tail, runs what follows the
  // statement, and writing it there behaves the same. A routed return's pad does neither: it reads
  // the pending payload and stays at its exit.
  routedEnds(head) {
    const { view } = this
    const setup = view.lastLeaf(head)
    const { stateIn } = view
    const ends = new Set()
    for (const [pc, { operation }] of view.leafByPc) {
      if (
        operation.kind !== 'assign' ||
        operation.destination !== setup.operation.continuation ||
        operation.value.kind !== 'literal' ||
        stateIn.get(pc)?.at(-1)?.setupPc !== setup.pc
      )
        continue
      const pad = view.graph.byPc.get(operation.value.value)?.id
      if (!pad) continue
      const end = view.throughJumps(pad)
      const first = view.lastLeaf(end)
      const opensOuter =
        first.operation.kind === 'assign' &&
        first.operation.destination ===
          stateIn.get(first.pc)?.at(-1)?.continuation
      if (view.jumpOnly(pad) || opensOuter) ends.add(end)
    }
    return [...ends]
  }

  // Where an exit goes next: an exit tail's write of a literal to the top finally record's
  // continuation names the pad that runs after the finalizer, so the route continues there; a
  // finalizer's resume is shared by every exit and continues none of them. An exit runs nothing on
  // its way: past a handler pop, a jump or such a write, the route has landed.
  exitNext(id) {
    const { pc, operation } = this.view.lastLeaf(id)
    const record = this.view.stateIn.get(pc)?.at(-1)
    if (
      operation.kind === 'assign' &&
      operation.value.kind === 'literal' &&
      record?.kind === 'finally' &&
      operation.destination === record.continuation
    ) {
      const pad = this.view.graph.byPc.get(operation.value.value)?.id
      return pad ? [pad] : []
    }
    return ['handler-pop', 'jump'].includes(operation.kind)
      ? this.view.normalNext(id)
      : []
  }

  // Whether a loop among the try's members leaves, other than to its own end, by an exit landing
  // at `end`.
  loopExitsTo(end, members) {
    const exitNext = new Map(
      [...this.view.blockById.keys()].map((id) => [id, this.exitNext(id)]),
    )
    return this.entries
      .filter(({ kind, head }) => kind === 'loop' && members.has(head))
      .some(({ head }) => {
        const { cycle } = this.view.cycleOf(head)
        const own = this.loopEnds.loopEnd(head)
        const skipped = new Set(own ? [own] : [])
        return [...cycle].some((id) =>
          this.view
            .normalNext(id)
            .some(
              (target) =>
                !cycle.has(target) &&
                target !== own &&
                walkForward(target, exitNext, skipped, new Set()).includes(end),
            ),
        )
      })
  }

  // A catch whose block never completes normally has no reachable end; the frontend's layout end
  // places one where the catch's own normal walk arrives inside the catch.
  catchLayoutEnd(head) {
    const { view } = this
    const setup = view.lastLeaf(head).operation
    if (setup.kind !== 'catch-setup' || setup.layoutEnd === undefined)
      return null
    const handler = view.graph.byPc.get(setup.target)?.id
    const end = view.graph.byPc.get(setup.layoutEnd)?.id
    return handler &&
      end &&
      view.reachable.has(end) &&
      view.dominates(handler, end) &&
      reachableBlockIds(handler, view.normalEdges).has(end)
      ? end
      : null
  }

  // The enclosing loops whose trailing run a continue from inside `head` reaches (a catch's tail,
  // or a finally's routed pad), unless the try's normal end arrives there as well.
  loopsContinuedFrom(head) {
    return this.regions.filter(
      (region) =>
        region.kind === 'loop' &&
        region.members.has(head) &&
        region.trailing.length &&
        !this.view.dominates(region.trailing[0], head),
    )
  }

  // A try's normal end: its catch's end, or the target of its exit tails, or a finally's routed
  // ends. A break or continue crossing the try has the same tail as its normal end, whether it
  // leaves an enclosing loop or an enclosing switch.
  tryTails(head, loopsOutside) {
    const enclosing = new Set([
      ...enclosingLoopStops(this.regions, head),
      ...this.switchEnds(head),
    ])
    const ended = this.catchEnd(head, enclosing)
    let tails = ended ? [ended] : [...this.exitTails(head)]
    if (
      !tails.length &&
      this.view.lastLeaf(head).operation.kind === 'finally-setup'
    )
      tails = this.routedEnds(head).filter((id) => !enclosing.has(id))
    if (tails.length > 1) tails = tails.filter((id) => !enclosing.has(id))
    const continued = (id) =>
      loopsOutside.find(
        (region) => region.trailing[0] === this.view.throughJumps(id),
      )
    if (tails.length > 1) {
      const rest = tails.filter((id) => !continued(id))
      if (rest.length) tails = rest
    }
    return tails
  }

  // A labeled exit out of the try past its tail lands where the tail's walk arrives too, whether
  // or not another route reaching it from before the try leaves it outside the members. Such
  // blocks are its later ends, as for a loop; a try cannot move its end past the tail, which runs
  // after the finalizer, so they are cut and a labeled block headed by the try ends there. A
  // continue to an enclosing loop's trailing run is a transfer, never a later end. The try's end
  // is its continuation, or the layout end of a catch whose block never completes normally.
  tryLaterEnds(head, tryEnd, cuts) {
    const { view } = this
    if (!tryEnd) return { blockEnds: [], cuts }
    const transfers = new Set([
      ...transfersFrom(view, this.regions, head),
      ...cuts,
      ...this.switchEnds(head),
    ])
    const tail = new Set(
      walkForward(tryEnd, view.normalSuccessors, new Set(), transfers),
    )
    const inside = new Set(
      [...view.membersOf(head, tryEnd, cuts)].filter((id) => !tail.has(id)),
    )
    const ends = laterEnds(inside, tryEnd, view.normalSuccessors, transfers)
    if (
      ends.length &&
      view.closed(head, view.membersOf(head, tryEnd, [...cuts, ...ends]), 'try')
    )
      return { blockEnds: ends, cuts: [...cuts, ...ends] }
    return { blockEnds: [], cuts }
  }
}
