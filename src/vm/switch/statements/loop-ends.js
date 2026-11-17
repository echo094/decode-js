import { closeConditional } from './conditionals.js'
import { laterEnds, walkForward } from './graph.js'

// The kinds of operation a conditional that is one expression never runs: a try's head or tail, a
// return, a throw, an indirect jump or a for-in step are statements.
const STATEMENT_KINDS = new Set([
  'catch-setup',
  'finally-setup',
  'handler-pop',
  'indirect-jump',
  'return',
  'throw',
  'for-in-next',
])

// What a jump from inside `head` reaches as a transfer: the statements holding it.
export function transfersFrom(view, regions, head) {
  return new Set(
    regions
      .filter(({ members }) => members.has(head))
      .flatMap((region) => [
        region.continuation,
        ...region.blockEnds,
        region.kind === 'loop'
          ? region.head
          : view.graph.byPc.get(view.lastLeaf(region.head).operation.target)
              ?.id,
      ])
      .filter(Boolean),
  )
}

// The heads and continuations of the loops holding `head`: where a walk from inside it stops.
export function enclosingLoopStops(regions, head) {
  return regions
    .filter((region) => region.kind === 'loop' && region.members.has(head))
    .flatMap((region) => [region.head, region.continuation])
    .filter(Boolean)
}

/**
 * Where each loop closes, over a function's graph (`view`) and the regions found so far, outermost
 * first (`regions`). `bounds(head)` gives a loop's end, its labeled later ends and its trailing
 * run; `loopEnd(head)` the end alone. The test each loop closes at is recorded as it is found.
 */
export class LoopEnds {
  constructor(view, regions) {
    this.view = view
    this.regions = regions
    // Where a loop closes: its test's target outside the cycle, through jump-only blocks.
    // A loop whose test is the branch its back edge falls from (a do-while), by its header.
    this.bottomTests = new Map()
    // The test each loop closes at, by its header: `{ test, bottom, run }`, the run being, for a test
    // in the header's run, the blocks before it in walk order (a nested conditional with its arms).
    this.exitTests = new Map()
  }

  // A loop's end and the later exits it leaves to; no end when its members are not closed.
  bounds(head) {
    let continuation = this.loopEnd(head)
    let blockEnds = []
    if (continuation)
      ({ end: continuation, blockEnds } = this.closeLaterExits(
        head,
        continuation,
      ))
    const cuts = blockEnds
    if (
      continuation &&
      !this.view.closed(
        head,
        this.view.membersOf(head, continuation, cuts),
        'loop',
      )
    )
      continuation = null
    return {
      continuation,
      blockEnds,
      cuts,
      trailing: this.trailingRun(head),
      trailingIsTest: this.bottomTests.has(head),
      exitTest: this.exitTests.get(head) ?? null,
    }
  }

  // A conditional that closes at `merge` and is one expression: its test's two arms reach only
  // blocks it dominates, share none of them (so they first meet at the merge: an `if` whose arms
  // meet earlier is a statement before the merge), leave only to the merge, every entry into the
  // merge comes from them, and none of its blocks runs a statement.
  expressionConditional(merge, head) {
    const { dom } = this.view
    const test = [...dom.get(merge)]
      .filter((id) => id !== merge)
      .sort((left, right) => dom.get(right).size - dom.get(left).size)[0]
    if (!test || test === head || this.view.normalNext(test).length !== 2)
      return null
    const members = this.armMembers(test, merge, head)
    if (!members) return null
    const enteredOnlyFromArms = (id) =>
      this.view.normalPredecessors(id).every((pred) => members.has(pred))
    if (
      !enteredOnlyFromArms(merge) ||
      [...members].some(
        (id) =>
          (id !== test && !enteredOnlyFromArms(id)) ||
          STATEMENT_KINDS.has(this.view.lastLeaf(id).operation.kind),
      )
    )
      return null
    return [...members]
  }

  // The test and the blocks of its two arms short of the merge, when each block is in one arm
  // only, is not the loop's head and is dominated by the test; null otherwise.
  armMembers(test, merge, head) {
    const members = new Set([test])
    const armOf = new Map()
    for (const start of this.view.normalNext(test)) {
      const work = start === merge ? [] : [start]
      while (work.length) {
        const id = work.pop()
        if (armOf.get(id) === start) continue
        if (armOf.has(id) || id === head || !this.view.dominates(test, id))
          return null
        armOf.set(id, start)
        members.add(id)
        work.push(...this.view.normalNext(id).filter((next) => next !== merge))
      }
    }
    return members
  }

  // The run that ends at a loop's only back edge, when several paths enter it: where a continue
  // that skips the rest of the body arrives (a for's update, or a do-while's test, which the walk
  // starts from), unless a merge explains every entry. It walks back over straight blocks and
  // over conditionals that are one expression (an update `i = x ? i + 2 : i + 1`), so it begins
  // where the update or the test does.
  trailingRun(head) {
    const latches = this.view.latchesOf(head)
    if (latches.length !== 1) return []
    const run = this.bottomTests.has(head)
      ? [this.bottomTests.get(head), latches[0]]
      : [latches[0]]
    for (;;) {
      const preds = this.view.normalPredecessors(run[0])
      if (run[0] === head) return []
      if (preds.length > 1) {
        const conditional = this.expressionConditional(run[0], head)
        if (!conditional) return run
        run.unshift(...conditional)
        continue
      }
      if (preds.length !== 1 || this.view.normalNext(preds[0]).length !== 1)
        return []
      run.unshift(preds[0])
    }
  }

  // Where a branch inside a loop's header run closes, short of the loop's own head and of the
  // enclosing loops' heads and ends.
  nestedClose(id, head) {
    const outgoing = this.view.graph.adjacency.get(id)
    const branch = outgoing.find(({ edge }) => edge.kind === 'conditional')
    const fallthrough = outgoing.find(({ edge }) => edge.kind === 'fallthrough')
    if (!branch || !fallthrough) return null
    const stops = new Set([head, ...enclosingLoopStops(this.regions, head)])
    const { merge } = closeConditional(
      {
        testBlockId: id,
        branchId: branch.target,
        fallthroughId: fallthrough.target,
      },
      {
        adjacency: this.view.normalEdges,
        throughJumps: this.view.throughJumps,
      },
      { stops },
    )
    return merge && merge !== head ? merge : null
  }

  // A loop test's exit: its one target outside the cycle, through jump-only blocks.
  loopExit(id, cycle) {
    const next = this.view.normalNext(id)
    const kind = this.view.lastLeaf(id).operation.kind
    if (!['branch', 'for-in-next'].includes(kind) || next.length !== 2)
      return null
    const outside = next.filter((target) => !cycle.has(target))
    if (outside.length !== 1) return null
    let target = outside[0]
    const seen = new Set()
    while (this.view.jumpOnly(target) && !seen.has(target)) {
      seen.add(target)
      const following = this.view.normalNext(target)
      if (following.length !== 1 || cycle.has(following[0])) break
      target = following[0]
    }
    return target
  }

  // Where a loop closes, walking its header run to the first test that leaves the cycle; a loop
  // whose run reaches no such test closes at the test its only back edge falls from.
  loopEnd(head) {
    const { latches, cycle } = this.view.cycleOf(head)
    let at = head
    const walked = new Set()
    const run = []
    while (!walked.has(at)) {
      walked.add(at)
      const next = this.view.normalNext(at)
      if (next.length === 1) {
        run.push(at)
        at = next[0]
        continue
      }
      const end = this.loopExit(at, cycle)
      if (end) {
        // A test whose staying arm is the loop's only back edge ends the body (a do-while with a
        // straight body), unless it is the header itself.
        const stay = next.find((target) => cycle.has(target))
        const bottom =
          at !== head &&
          latches.length === 1 &&
          (stay === head || (stay === latches[0] && this.view.jumpOnly(stay)))
        this.exitTests.set(head, { test: at, bottom, run: bottom ? null : run })
        return end
      }
      // A branch whose arms close inside the cycle is nested in the test (a short-circuit
      // operand, say): the walk continues where it closes.
      const close = this.nestedClose(at, head)
      if (!close) break
      run.push(at)
      for (const target of next)
        run.push(
          ...walkForward(
            target,
            this.view.normalSuccessors,
            new Set([head]),
            new Set([close]),
          ).filter((id) => id !== close && !run.includes(id)),
        )
      at = close
    }
    if (latches.length !== 1) return null
    const before = (this.view.predecessors.get(latches[0]) ?? []).filter((id) =>
      cycle.has(id),
    )
    const end = before.length === 1 ? this.loopExit(before[0], cycle) : null
    if (end) {
      this.bottomTests.set(head, before[0])
      this.exitTests.set(head, { test: before[0], bottom: true, run: null })
    }
    return end
  }

  // A labeled exit past the loop's own exit. Moving the loop's end there, with the code it skips in
  // the arm of the test that leaves, needs no label; a statement label is the last resort, for
  // what that cannot hold: several such ends, a tail that is itself a loop, and a for-in, whose
  // advance must leave at the loop's end.
  closeLaterExits(head, end) {
    const { view } = this
    const { cycle } = view.cycleOf(head)
    const transfers = transfersFrom(view, this.regions, head)
    const ends = laterEnds(cycle, end, view.normalSuccessors, transfers)
    if (!ends.length) return { end, blockEnds: [] }
    const skipped = walkForward(
      end,
      view.normalSuccessors,
      cycle,
      new Set([...transfers, ends[0]]),
    )
    const tailLoops = skipped.some((id) =>
      (view.predecessors.get(id) ?? []).some(
        (pred) => view.reachable.has(pred) && view.dominates(id, pred),
      ),
    )
    const forIn = [...cycle].some(
      (id) =>
        view.lastLeaf(id).operation.kind === 'for-in-next' &&
        view.normalNext(id).some((target) => !cycle.has(target)),
    )
    return ends.length === 1 && !tailLoops && !forIn
      ? { end: ends[0], blockEnds: [] }
      : { end, blockEnds: ends }
  }
}
