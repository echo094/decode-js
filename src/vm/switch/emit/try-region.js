import * as t from '@babel/types'
import {
  functionRegisterSet,
  localCaptureRegisterSet,
  registerName,
} from '../model/operations.js'
import { decline, requireValue } from '../model/model.js'

// Try-statement regions in structured emission.

// One step of a finally region's exit tail, read from the typed operation and the setup's own
// fields (`continuation`, `target`): the pop, the write of the continuation's literal (the PC the
// resume jumps to), a jump step, or the jump into the finalizer that ends the tail.
function finallyTailStep(operation, { continuation, target }) {
  if (operation.kind === 'handler-pop') return 'pop'
  if (
    operation.kind === 'assign' &&
    operation.destination === continuation &&
    operation.value.kind === 'literal'
  )
    return 'continuation'
  if (operation.kind === 'jump')
    return operation.target === target ? 'finalizer' : 'step'
  return null
}

/**
 * Try regions in structured emission over one function's emission state (`state`). The renderers
 * walk a try's body, catch, finalizer and exit tails by yielding each walk they need
 * (`{ start, stops, context }`) and receiving its result.
 */
export class TryRegions {
  constructor(state) {
    this.state = state
  }

  // Try statements are regions delimited by compiler-only head and tail instructions (see the
  // try-region design): a catch-setup or finally-setup head, catch/finalizer entry heads, and
  // exit tails made of handler-pop, an optional continuation literal and a jump. Every exit stays
  // native: return and throw as written, any other transfer handed to the enclosing walk.
  regionProtects(edge, context) {
    const protector = context.regions?.at(-1)
    if (!protector || edge.targetPc === null) return false
    return (
      edge.kind === (protector.kind === 'catch' ? 'handler' : 'finally') &&
      this.state.targetBlock(edge) === protector.entryId
    )
  }

  // Registers that only a region's own exit tails, pads and resume may touch: the continuation
  // and payload of every enclosing finally region, plus those a finalizer walk bars for its own
  // region. Native try/finally keeps the pending completion itself, so code that read or wrote
  // them would behave differently once recovered.
  carriers(context) {
    const registers = new Set(context.barred ?? [])
    for (const region of context.regions ?? [])
      if (region.kind === 'finally') {
        registers.add(region.continuation)
        registers.add(region.payload)
      }
    return registers
  }

  checkCarriers(instruction, context) {
    const barred = this.carriers(context)
    if (!barred.size) return
    for (const register of functionRegisterSet([instruction]))
      if (barred.has(register))
        decline(
          'unemittable-structured-control',
          `Try region completion register used at ${instruction.pc}`,
        )
  }

  // The handler records a block must carry on entry: one per enclosing region, innermost last.
  // The solver builds one record per setup from its own fields, so the setup identifies it.
  checkState(block, regions, pc = block.startPc) {
    const stack = this.state.stateIn.get(block.startPc)
    if (!stack) return
    const same =
      stack.length === regions.length &&
      regions.every((region, index) => stack[index].setupPc === region.setupPc)
    if (!same)
      decline(
        'unemittable-structured-control',
        `Try region target state at ${pc} does not match its regions`,
      )
  }

  // The block `block` falls into, through jump steps.
  soleFallthrough(block) {
    const edges = this.state.outgoing(block)
    if (
      edges.length !== 1 ||
      edges[0].kind !== 'fallthrough' ||
      edges[0].targetPc === null
    )
      return null
    let next = this.state.nodeById.get(this.state.targetBlock(edges[0]))
    const seen = new Set()
    while (this.state.isJumpStep(next) && !seen.has(next.id)) {
      seen.add(next.id)
      const [edge] = this.state.outgoing(next)
      if (edge?.targetPc == null) break
      next = this.state.nodeById.get(this.state.targetBlock(edge))
    }
    return next
  }

  *renderTry(block, context, stopIds) {
    this.state.markBlock(block)
    const setup = block.instruction
    const { kind, target } = setup.operation
    const entry = this.state.nodeForPc(target)
    const bodyEdge = this.state.edgeTo(block, 'fallthrough')
    if (!bodyEdge || bodyEdge.targetPc === null)
      decline(
        'unemittable-structured-control',
        `${kind} at ${setup.pc} has no body entry`,
      )
    const region = this.regionOf(block, entry, context)
    const stops = new Set([...stopIds, ...region.exitTargets])
    const body = yield {
      start: this.state.targetBlock(bodyEdge),
      stops: stops,
      context: {
        ...context,
        regions: [...(context.regions ?? []), region],
      },
    }
    if (
      !body.terminated &&
      !region.exitTargets.has(body.nextBlockId) &&
      !(region.kind === 'catch' && this.closes(region, stops, body.nextBlockId))
    )
      decline(
        'unemittable-structured-control',
        `${kind} at ${setup.pc} body leaves its region unstructured`,
      )
    const after = body.terminated ? null : body.nextBlockId
    const clause =
      region.kind === 'catch'
        ? yield* this.renderCatchClause(region, setup, stops, after)
        : yield* this.renderFinallyClause(region, setup, after)
    const statements = [
      t.tryStatement(
        t.blockStatement(body.statements),
        clause.handler ?? null,
        clause.finalizer ?? null,
      ),
    ]
    return clause.after !== null
      ? { statements, nextBlockId: clause.after, terminated: false }
      : { statements, nextBlockId: null, terminated: true }
  }

  // The region record of a setup block, and the stops its planner try row ends it at.
  regionOf(block, entry, context) {
    const setup = block.instruction
    const { kind, continuation, payload } = setup.operation
    const isCatch = kind === 'catch-setup'
    if (
      !isCatch &&
      [continuation, payload].some((register) =>
        localCaptureRegisterSet(this.state.instructions).has(register),
      )
    )
      decline(
        'unemittable-structured-control',
        `FINALLY_SETUP at ${setup.pc} has captured completion registers`,
      )
    const row = requireValue(
      this.state.tryBySetup.get(block.id),
      'unemittable-structured-control',
      `${isCatch ? 'TRY_SETUP' : 'FINALLY_SETUP'} at ${setup.pc} has no planned try statement`,
    )
    const region = {
      kind: isCatch ? 'catch' : 'finally',
      setupPc: setup.pc,
      entryId: entry.id,
      outer: context,
    }
    // A catch statement continues where the planner's row ends it: its normal end, or, when the
    // block never completes normally, the frontend's layout end (where the source closed the
    // statement); with neither, the catch keeps the code only it reaches.
    if (isCatch) {
      const end = row.continuationBlockId ?? row.layoutEndBlockId
      return { ...region, exitTargets: new Set(end ? [end] : []) }
    }
    // A finally statement completes normally where its try row ends it; every other exit tail
    // names a pad that re-issues an exit after the finalizer.
    const normalEnd = row.continuationBlockId
    return {
      ...region,
      continuation,
      payload,
      normalEnd,
      exitTargets: new Set(normalEnd ? [normalEnd] : []),
    }
  }

  // Where `id` lands in the region's enclosing context: a try that ends at the enclosing
  // finally's normal tail lands, through it, at that finally's normal end.
  landing(region, id) {
    return this.normalLanding(id, region.outer.regions?.at(-1))
  }

  // Whether a walk stopping at `id` closes the region's statement. A statement with no end of its
  // own closes where the enclosing walk stops it.
  closes(region, stops, id) {
    return region.exitTargets.size
      ? [...region.exitTargets].some(
          (end) => end === id || this.landing(region, end) === id,
        )
      : region.kind === 'catch' && stops.has(id)
  }

  *renderCatchClause(region, setup, stops, after) {
    const handler = yield {
      start: region.entryId,
      stops: stops,
      context: region.outer,
    }
    let next = after
    if (!handler.terminated) {
      if (
        !this.closes(region, stops, handler.nextBlockId) ||
        (after !== null &&
          this.landing(region, after) !==
            this.landing(region, handler.nextBlockId))
      )
        decline(
          'unemittable-structured-control',
          `TRY_SETUP at ${setup.pc} catch does not rejoin its body`,
        )
      // Either walk may stop at the tail; the statement continues there, so the tail is written.
      if (after === null || region.exitTargets.has(handler.nextBlockId))
        next = handler.nextBlockId
    }
    const error = () => t.identifier('__recovered_error')
    const register = registerName(
      this.state.functionId,
      setup.operation.exceptionRegister,
    )
    return {
      handler: t.catchClause(
        error(),
        t.blockStatement([
          t.expressionStatement(
            t.assignmentExpression('=', t.identifier(register), error()),
          ),
          ...handler.statements,
        ]),
      ),
      after: next,
    }
  }

  // The compiler gives each try/finally its own continuation register and ends the finalizer
  // with the one indirect jump that reads it, so that jump is the resume whether or not the
  // finalizer completes. A finalizer that never completes leaves it unreachable, with the throw
  // pad, as dead code.
  *renderFinallyClause(region, setup, after) {
    const { continuation, payload, throwPad } = setup.operation
    const resume = this.state.instructions.find(
      (item) =>
        item.operation.kind === 'indirect-jump' &&
        item.operation.source === region.continuation,
    )
    if (!resume)
      decline(
        'unemittable-structured-control',
        `FINALLY_SETUP at ${setup.pc} has no finalizer resume`,
      )
    const resumeBlock = this.state.nodeForPc(resume.pc)
    const finalizer = yield {
      start: region.entryId,
      stops: new Set([resumeBlock.id]),
      context: {
        ...region.outer,
        barred: [...(region.outer.barred ?? []), continuation, payload],
      },
    }
    if (!finalizer.terminated && finalizer.nextBlockId !== resumeBlock.id)
      decline(
        'unemittable-structured-control',
        `FINALLY_SETUP at ${setup.pc} finalizer does not reach its resume`,
      )
    if (!finalizer.terminated) {
      this.state.markBlock(resumeBlock)
      // The throw pad only rethrows the pending exception after the finalizer, which native
      // try/finally already does.
      const padBlock = this.state.nodeForPc(throwPad)
      const { operation: pad } = padBlock.instruction
      if (pad.kind !== 'throw' || pad.source !== region.payload)
        decline(
          'unemittable-structured-control',
          `FINALLY_SETUP at ${setup.pc} has no payload throw pad`,
        )
      this.state.markBlock(padBlock)
    }
    return {
      finalizer: t.blockStatement(finalizer.statements),
      after: finalizer.terminated ? null : after,
    }
  }

  // The finally's normal end when `id` opens its tail that names that end; otherwise `id`.
  normalLanding(id, region) {
    if (region?.kind !== 'finally') return id
    const fields = this.finallyFields(region)
    const seen = new Set()
    let current = this.state.nodeById.get(id)
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      const { operation } = current.instruction
      const step = finallyTailStep(operation, fields)
      if (step === 'continuation') {
        let end = this.state.nodeForPc(operation.value.value)
        while (
          end.id !== region.normalEnd &&
          this.state.isJumpStep(end) &&
          !seen.has(end.id)
        ) {
          seen.add(end.id)
          end = this.state.nodeById.get(
            this.state.targetBlock(this.state.outgoing(end)[0]),
          )
        }
        return end.id === region.normalEnd ? end.id : id
      }
      if (step !== 'pop' && step !== 'step') return id
      const next = this.state.outgoing(current)
      if (next.length !== 1 || next[0].targetPc === null) return id
      current = this.state.nodeById.get(this.state.targetBlock(next[0]))
    }
    return id
  }

  // The setup fields a finally region's exit tail is read against.
  finallyFields(region) {
    return {
      continuation: region.continuation,
      target: this.state.nodeById.get(region.entryId).startPc,
    }
  }

  // An exit tail of the innermost region, starting at `block`. A catch region's tail is its
  // handler-pop; what follows belongs to the enclosing context. A finally region's tail is
  // `continuation = literal` and handler-pop in either order, then the jump to the finalizer;
  // the normal literal completes the statement, any other names a pad that re-issues the exit
  // in the enclosing context, so the pad is walked here, in place.
  *renderRegionExit(block, region, context, stopIds) {
    if (region.kind === 'catch')
      return yield* this.renderCatchExit(block, region, context, stopIds)
    const { statements, literal } = this.readFinallyTail(block, region, context)
    const landing = this.state.nodeForPc(literal)
    if (landing.id === region.normalEnd)
      return { statements, nextBlockId: landing.id, terminated: false }
    const pad = yield {
      start: landing.id,
      stops: stopIds,
      context: this.exitContext(region, context, region),
    }
    return { ...pad, statements: [...statements, ...pad.statements] }
  }

  // What follows a pop runs in the enclosing context. It is no longer protected, yet it is
  // rendered inside the native try block, so it may only transfer control (the compiler's unwind:
  // further pops, routing, jumps, returns). Inside a pad it is still that pad.
  exitContext(region, context, pad) {
    return {
      ...region.outer,
      enclosing: context.enclosing ?? context.loops,
      exiting: true,
      ...(pad ? { pad } : {}),
    }
  }

  // The solver's stack after a pop holds exactly the enclosing regions.
  checkPopEdge(pop, region) {
    const outerRegions = region.outer.regions ?? []
    const after = this.state.solvedEdgesBySource
      .get(pop.startPc)
      ?.find(({ kind }) => kind === 'fallthrough')?.stackAfter
    if (
      after &&
      (after.length !== outerRegions.length ||
        outerRegions.some(
          (item, index) => after[index]?.setupPc !== item.setupPc,
        ))
    )
      decline(
        'unemittable-structured-control',
        `Try region edge state at ${pop.startPc} does not leave exactly its region`,
      )
  }

  *renderCatchExit(block, region, context, stopIds) {
    const pop = block.instruction
    const state = this.state.stateIn.get(block.startPc)
    if (
      pop.operation.kind !== 'handler-pop' ||
      (state && state.at(-1)?.setupPc !== region.setupPc)
    )
      decline(
        'unemittable-structured-control',
        `handler-pop at ${pop.pc} does not close TRY_SETUP at ${region.setupPc}`,
      )
    this.state.markBlock(block)
    this.checkPopEdge(block, region)
    const next = this.state.edgeTo(block, 'fallthrough')
    if (!next || next.targetPc === null)
      decline(
        'unemittable-structured-control',
        `handler-pop at ${pop.pc} has no continuation`,
      )
    return yield {
      start: this.state.targetBlock(next),
      stops: stopIds,
      context: this.exitContext(region, context, context.pad),
    }
  }

  // A finally exit tail from `block` to the jump into the finalizer: the routed return's payload
  // copy, rendered, and the continuation literal.
  readFinallyTail(block, region, context) {
    const fields = this.finallyFields(region)
    const outerRegions = region.outer.regions ?? []
    const statements = []
    let current = block
    let literal = null
    let popped = false
    for (;;) {
      const leaf = current.instruction
      if (popped) this.checkState(current, outerRegions)
      else if (current !== block)
        this.checkState(current, context.regions ?? [])
      this.state.markBlock(current)
      const step = finallyTailStep(leaf.operation, fields)
      if (step === 'pop' && !popped) {
        popped = true
        this.checkPopEdge(current, region)
      } else if (
        leaf.operation.kind === 'assign' &&
        literal === null &&
        !popped &&
        current === block &&
        leaf.operation.destination === region.payload &&
        leaf.operation.value.kind === 'register'
      )
        this.state.renderInstruction(leaf, statements)
      else if (step === 'continuation' && literal === null)
        literal = leaf.operation.value.value
      else if (step === 'step') {
        // A jump step between two steps of the tail.
      } else if (step === 'finalizer' && popped && literal !== null) break
      else
        decline(
          'unemittable-structured-control',
          `${leaf.operation.kind} at ${leaf.pc} breaks the exit tail of FINALLY_SETUP at ${region.setupPc}`,
        )
      current = this.tailNext(current, region)
    }
    return { statements, literal }
  }

  // The one straight-line successor of a tail case.
  tailNext(current, region) {
    const next = this.state.outgoing(current)
    if (
      next.length !== 1 ||
      next[0].kind !==
        (this.state.isJumpStep(current) ? 'branch' : 'fallthrough') ||
      next[0].targetPc === null
    )
      decline(
        'unemittable-structured-control',
        `Exit tail of FINALLY_SETUP at ${region.setupPc} is not straight-line`,
      )
    return this.state.nodeById.get(this.state.targetBlock(next[0]))
  }

  // Whether `block` starts an exit tail of the innermost region.
  startsRegionExit(block, context) {
    const region = context.regions?.at(-1)
    if (!region) return null
    const leaf = block.instruction
    if (leaf.operation.kind === 'handler-pop') return region
    if (
      region.kind === 'finally' &&
      finallyTailStep(leaf.operation, this.finallyFields(region)) ===
        'continuation'
    )
      return region
    // A routed return first saves its value in the payload, then loads the continuation.
    const next = this.soleFallthrough(block)?.instruction
    if (
      region.kind === 'finally' &&
      leaf.operation.kind === 'assign' &&
      leaf.operation.destination === region.payload &&
      leaf.operation.value.kind === 'register' &&
      next &&
      finallyTailStep(next.operation, this.finallyFields(region)) ===
        'continuation'
    )
      return region
    return null
  }
}
