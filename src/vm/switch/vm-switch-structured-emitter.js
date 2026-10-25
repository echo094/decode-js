import { parse } from '@babel/parser'
import {
  appendRendered,
  decline,
  effectiveStructuredInstructions,
  emitInstruction,
  functionName,
  functionNeedsArguments,
  functionRegisterSet,
  invertPredicate,
  localCaptureRegisterSet,
  registerName,
  requireValue,
  retargetDestination,
} from './vm-switch-copy-planning.js'
import { isJumpStep } from './vm-switch-model.js'

const RUN_ENDING_KINDS = new Set([
  'jump',
  'branch',
  'for-in-next',
  'indirect-jump',
  'return',
  'throw',
])
const CONTROL_KINDS = new Set([
  ...RUN_ENDING_KINDS,
  'catch-setup',
  'handler-pop',
  'finally-setup',
])

class StructuredFunctionEmitter {
  constructor(
    functionId,
    instructions,
    functionRecord,
    regions,
    functions,
    copyPlan,
    coalescedMovePcs,
    solved,
  ) {
    this.functionId = functionId
    this.instructions = instructions
    this.functionRecord = functionRecord
    // A node is one case, named as the planner names it; its successors are the control
    // solver's edges from its PC.
    this.nodeById = new Map(
      instructions.map((instruction) => {
        const id = `${functionId}:b@${instruction.pc}`
        return [id, { id, startPc: instruction.pc, instruction }]
      }),
    )
    this.functions = functions
    this.copyPlan = copyPlan
    this.coalescedMovePcs = coalescedMovePcs
    this.reachablePcs = new Set(solved.reachablePcs)
    this.stateIn = solved.stateIn
    this.solvedEdgesBySource = Map.groupBy(
      solved.edges,
      (edge) => edge.sourcePc,
    )
    this.conditionalByTest = new Map(
      regions
        .filter(({ kind }) => kind === 'conditional')
        .map((region) => [region.testBlockId, region]),
    )
    this.tryBySetup = new Map(
      regions
        .filter(({ kind }) => kind === 'try')
        .map((region) => [region.setupBlockId, region]),
    )
    this.loopByHeader = new Map(
      regions
        .filter(({ kind }) => kind === 'natural-loop')
        .map((region) => [region.headerBlockId, region]),
    )
    this.switchByHead = new Map(
      regions
        .filter(({ kind }) => kind === 'switch')
        .map((region) => [region.testBlockId, region]),
    )
    this.emittedBlocks = new Set()
    this.loopNumber = 0
    this.switchNumber = 0
  }

  nodeForPc(pc) {
    return requireValue(
      this.nodeById.get(`${this.functionId}:b@${pc}`),
      'invalid-structured-control',
      `Structured control has no block for target ${pc}`,
    )
  }

  outgoing(node) {
    return this.solvedEdgesBySource.get(node.startPc) ?? []
  }

  targetBlock(edge) {
    return edge.targetPc === null ? null : this.nodeForPc(edge.targetPc).id
  }

  // A jump step runs nothing; readers that follow control look through it.
  isJumpStep(node) {
    return isJumpStep(node)
  }

  markBlock(block) {
    if (this.emittedBlocks.has(block.id))
      decline(
        'unemittable-structured-control',
        `Structured block ${block.id} would be emitted more than once`,
      )
    this.emittedBlocks.add(block.id)
  }

  // context.loops holds every breakable statement; a switch is one, but never a loop.
  activeLoop(context) {
    return context.loops.findLast(({ kind }) => kind !== 'switch') ?? null
  }

  loopTransfer(context, target) {
    for (let index = context.loops.length - 1; index >= 0; index -= 1) {
      const loop = context.loops[index]
      if (target === loop.headerBlockId || target === loop.continueBlockId)
        return { kind: 'continue', loop, target }
      if (loop.exitTargets.has(target)) return { kind: 'break', loop, target }
    }
    return null
  }

  edgeTo(block, kind) {
    return this.outgoing(block).find(({ kind: edgeKind }) => edgeKind === kind)
  }

  renderInstruction(instruction, lines) {
    if (instruction.coalesced || this.coalescedMovePcs.has(instruction.pc))
      return
    if (this.copyPlan.has(instruction.pc))
      instruction = retargetDestination(
        instruction,
        this.copyPlan.get(instruction.pc),
      )
    appendRendered(
      lines,
      emitInstruction(
        this.functionId,
        instruction,
        this.functions,
        'structured',
      ),
    )
  }

  renderConditional(region, context, stopIds) {
    const test = this.nodeById.get(region.testBlockId)
    requireValue(
      test,
      'invalid-structured-control',
      `Conditional region refers to missing test block ${region.testBlockId}`,
    )
    this.markBlock(test)
    const lines = []
    const { instruction } = test
    if (instruction.operation.kind !== 'branch')
      decline(
        'unemittable-structured-control',
        `Conditional region ${region.testBlockId} has a non-conditional leaf`,
      )
    if (
      (region.regionExitBlockIds ?? []).some(
        (entryId) =>
          !(context.regions ?? []).some((item) => item.entryId === entryId),
      )
    )
      decline(
        'unemittable-structured-control',
        `Conditional region ${region.testBlockId} has an unowned handler route`,
      )
    // Every exit tail of a finally region jumps to its finalizer entry, so emitStructuredControl places the merge
    // of a conditional whose arms leave the region there; for the region rule those arms meet at
    // the statement's normal completion instead, and when the region has none they do not meet.
    const finallyRegion = context.regions?.find(
      (item) => item.kind === 'finally' && item.entryId === region.mergeBlockId,
    )
    const merge = !finallyRegion ? region.mergeBlockId : finallyRegion.normalEnd
    // An arm whose jump steps lead straight to the merge starts there, as the planner closes
    // it: the steps run nothing. A back edge is a continue, never such a step.
    const armStart = (pc) => {
      const start = this.nodeForPc(pc).id
      const steps = []
      let id = start
      while (this.isJumpStep(this.nodeById.get(id)) && !steps.includes(id)) {
        const next = this.outgoing(this.nodeById.get(id))
        if (next.length !== 1 || next[0].targetPc === null) break
        if (
          this.loopTransfer(context, this.targetBlock(next[0]))?.kind ===
          'continue'
        )
          break
        steps.push(id)
        id = this.targetBlock(next[0])
      }
      if (id !== merge) return start
      for (const step of steps) this.markBlock(this.nodeById.get(step))
      return id
    }
    const branch = this.sequence(
      armStart(region.branchTargetPc),
      new Set([...stopIds, merge]),
      merge === null
        ? { ...context, terminalBlocks: new Set(region.branchTerminalBlockIds) }
        : context,
    )
    const fallthrough = this.sequence(
      armStart(region.fallthroughTargetPc),
      new Set([...stopIds, merge]),
      merge === null
        ? {
            ...context,
            terminalBlocks: new Set(region.fallthroughTerminalBlockIds),
          }
        : context,
    )
    const nonTerminated = [branch, fallthrough].filter(
      (path) => !path.terminated,
    )
    const nextIds = new Set(nonTerminated.map(({ nextBlockId }) => nextBlockId))
    const mergeIsStructuredStop =
      merge === null ||
      stopIds.has(merge) ||
      context.loops.some(
        (loop) => loop.headerBlockId === merge || loop.exitTargets.has(merge),
      )
    if (
      (nextIds.size > 1 &&
        ![...nextIds].every((nextBlockId) => nextBlockId === merge)) ||
      (nextIds.size === 1 &&
        ![...nextIds].every(
          (nextBlockId) => nextBlockId === merge || stopIds.has(nextBlockId),
        )) ||
      (!nonTerminated.length && !mergeIsStructuredStop)
    )
      decline(
        'unemittable-structured-control',
        `Conditional region ${region.testBlockId} does not reconverge at ${merge}`,
      )
    const condition = registerName(
      this.functionId,
      instruction.operation.condition,
    )
    const predicate =
      instruction.operation.when === 'false' ? `!${condition}` : condition
    if (branch.lines.length === 0 && fallthrough.lines.length === 0) {
      // Both paths only reconverge; the condition has no recovered body.
    } else if (branch.lines.length === 0) {
      lines.push(`if (${invertPredicate(predicate)}) {`)
      lines.push(...fallthrough.lines.map((line) => `  ${line}`))
      lines.push('}')
    } else if (fallthrough.lines.length === 0) {
      lines.push(`if (${predicate}) {`)
      lines.push(...branch.lines.map((line) => `  ${line}`))
      lines.push('}')
    } else {
      lines.push(`if (${predicate}) {`)
      lines.push(...branch.lines.map((line) => `  ${line}`))
      lines.push('} else {')
      lines.push(...fallthrough.lines.map((line) => `  ${line}`))
      lines.push('}')
    }
    if (!nonTerminated.length)
      return {
        lines,
        nextBlockId: merge,
        terminated: true,
      }
    return {
      lines,
      nextBlockId: [...nextIds][0],
      terminated: false,
    }
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
      this.targetBlock(edge) === protector.entryId
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
    const stack = this.stateIn.get(block.startPc)
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
    const edges = this.outgoing(block)
    if (
      edges.length !== 1 ||
      edges[0].kind !== 'fallthrough' ||
      edges[0].targetPc === null
    )
      return null
    let next = this.nodeById.get(this.targetBlock(edges[0]))
    const seen = new Set()
    while (this.isJumpStep(next) && !seen.has(next.id)) {
      seen.add(next.id)
      const [edge] = this.outgoing(next)
      if (edge?.targetPc == null) break
      next = this.nodeById.get(this.targetBlock(edge))
    }
    return next
  }

  renderTry(block, context, stopIds) {
    this.markBlock(block)
    const setup = block.instruction
    const { kind, target } = setup.operation
    const entry = this.nodeForPc(target)
    const bodyEdge = this.edgeTo(block, 'fallthrough')
    if (!bodyEdge || bodyEdge.targetPc === null)
      decline(
        'unemittable-structured-control',
        `${kind} at ${setup.pc} has no body entry`,
      )
    const region = {
      kind: kind === 'catch-setup' ? 'catch' : 'finally',
      setupPc: setup.pc,
      entryId: entry.id,
      outer: context,
    }
    const carriers = [setup.operation.continuation, setup.operation.payload]
    if (
      region.kind === 'finally' &&
      carriers.some((register) =>
        localCaptureRegisterSet(this.instructions).has(register),
      )
    )
      decline(
        'unemittable-structured-control',
        `FINALLY_SETUP at ${setup.pc} has captured completion registers`,
      )
    const exitTargets = new Set()
    if (region.kind === 'catch') {
      // The statement continues where the planner's row ends it: its normal end, or, when the
      // block never completes normally, the frontend's layout end (where the source closed the
      // statement); with neither, the catch keeps the code only it reaches.
      const row = requireValue(
        this.tryBySetup.get(block.id),
        'unemittable-structured-control',
        `TRY_SETUP at ${setup.pc} has no planned try statement`,
      )
      const end = row.continuationBlockId ?? row.layoutEndBlockId
      if (end) exitTargets.add(end)
    } else {
      region.continuation = setup.operation.continuation
      region.payload = setup.operation.payload
      // The statement completes normally where its try row ends it; every other exit tail names
      // a pad that re-issues an exit after the finalizer.
      const row = requireValue(
        this.tryBySetup.get(block.id),
        'unemittable-structured-control',
        `FINALLY_SETUP at ${setup.pc} has no planned try statement`,
      )
      region.normalEnd = row.continuationBlockId
      if (region.normalEnd) exitTargets.add(region.normalEnd)
    }
    const stops = new Set([...stopIds, ...exitTargets])
    const body = this.sequence(this.targetBlock(bodyEdge), stops, {
      ...context,
      regions: [...(context.regions ?? []), region],
    })
    if (!body.terminated && !exitTargets.has(body.nextBlockId))
      decline(
        'unemittable-structured-control',
        `${kind} at ${setup.pc} body leaves its region unstructured`,
      )
    let after = body.terminated ? null : body.nextBlockId
    const lines = ['try {', ...body.lines.map((line) => `  ${line}`)]
    if (region.kind === 'catch') {
      const handler = this.sequence(entry.id, stops, context)
      if (!handler.terminated) {
        if (
          !exitTargets.has(handler.nextBlockId) ||
          (after !== null && handler.nextBlockId !== after)
        )
          decline(
            'unemittable-structured-control',
            `TRY_SETUP at ${setup.pc} catch does not rejoin its body`,
          )
        after = handler.nextBlockId
      }
      lines.push('} catch (__recovered_error) {')
      lines.push(
        `  ${registerName(this.functionId, setup.operation.exceptionRegister)} = __recovered_error;`,
      )
      lines.push(...handler.lines.map((line) => `  ${line}`))
    } else {
      const resume = this.instructions.find(
        (item) =>
          item.operation.kind === 'indirect-jump' &&
          item.operation.source === region.continuation &&
          this.reachesFrom(entry.id, this.nodeForPc(item.pc).id),
      )
      if (!resume)
        decline(
          'unemittable-structured-control',
          `FINALLY_SETUP at ${setup.pc} has no finalizer resume`,
        )
      const resumeBlock = this.nodeForPc(resume.pc)
      const finalizer = this.sequence(entry.id, new Set([resumeBlock.id]), {
        ...context,
        barred: [...(context.barred ?? []), ...carriers],
      })
      if (!finalizer.terminated && finalizer.nextBlockId !== resumeBlock.id)
        decline(
          'unemittable-structured-control',
          `FINALLY_SETUP at ${setup.pc} finalizer does not reach its resume`,
        )
      if (finalizer.terminated) after = null
      else {
        this.markBlock(resumeBlock)
        // The throw pad only rethrows the pending exception after the finalizer, which
        // native try/finally already does.
        const throwPad = this.nodeForPc(setup.operation.throwPad)
        const { operation: pad } = throwPad.instruction
        if (pad.kind !== 'throw' || pad.source !== region.payload)
          decline(
            'unemittable-structured-control',
            `FINALLY_SETUP at ${setup.pc} has no payload throw pad`,
          )
        this.markBlock(throwPad)
      }
      lines.push('} finally {')
      lines.push(...finalizer.lines.map((line) => `  ${line}`))
    }
    lines.push('}')
    return after !== null
      ? { lines, nextBlockId: after, terminated: false }
      : { lines, nextBlockId: null, terminated: true }
  }

  // Whether `to` is reachable from `from` along normal edges.
  reachesFrom(from, to) {
    const seen = new Set()
    const queue = [from]
    while (queue.length) {
      const id = queue.shift()
      if (id === to) return true
      if (seen.has(id)) continue
      seen.add(id)
      for (const edge of this.outgoing(this.nodeById.get(id)))
        if (
          edge.targetPc !== null &&
          ['fallthrough', 'call', 'branch', 'conditional'].includes(edge.kind)
        )
          queue.push(this.targetBlock(edge))
    }
    return false
  }

  // An exit tail of the innermost region, starting at `block`. A catch region's tail is its
  // handler-pop; what follows belongs to the enclosing context. A finally region's tail is
  // `continuation = literal` and handler-pop in either order, then the jump to the finalizer;
  // the normal literal completes the statement, any other names a pad that re-issues the exit
  // in the enclosing context, so the pad is walked here, in place.
  renderRegionExit(block, region, context, stopIds) {
    const lines = []
    // What follows this region's pop runs in the enclosing context; inside a pad it is still
    // that pad.
    // What follows a pop is no longer protected, yet it is rendered inside the native try
    // block, so it may only transfer control (the compiler's unwind: further pops, routing,
    // jumps, returns); inside a pad it is still that pad.
    const outer = {
      ...region.outer,
      exiting: true,
      ...(context.pad ? { pad: context.pad } : {}),
    }
    const outerRegions = region.outer.regions ?? []
    const checkPopEdge = (pop) => {
      const after = this.solvedEdgesBySource
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
    const state = this.stateIn.get(block.startPc)
    if (region.kind === 'catch') {
      const pop = block.instruction
      if (
        pop.operation.kind !== 'handler-pop' ||
        (state && state.at(-1)?.setupPc !== region.setupPc)
      )
        decline(
          'unemittable-structured-control',
          `handler-pop at ${pop.pc} does not close TRY_SETUP at ${region.setupPc}`,
        )
      this.markBlock(block)
      checkPopEdge(block)
      const next = this.edgeTo(block, 'fallthrough')
      if (!next || next.targetPc === null)
        decline(
          'unemittable-structured-control',
          `handler-pop at ${pop.pc} has no continuation`,
        )
      const rest = this.sequence(this.targetBlock(next), stopIds, outer)
      return { ...rest, lines: [...lines, ...rest.lines] }
    }
    let current = block
    let literal = null
    let popped = false
    for (;;) {
      const leaf = current.instruction
      if (popped) this.checkState(current, outerRegions)
      else if (current !== block)
        this.checkState(current, context.regions ?? [])
      this.markBlock(current)
      if (leaf.operation.kind === 'handler-pop' && !popped) {
        popped = true
        checkPopEdge(current)
      } else if (
        leaf.operation.kind === 'assign' &&
        literal === null &&
        !popped &&
        current === block &&
        leaf.operation.destination === region.payload &&
        leaf.operation.value.kind === 'register'
      )
        this.renderInstruction(leaf, lines)
      else if (
        leaf.operation.kind === 'assign' &&
        literal === null &&
        leaf.operation.destination === region.continuation &&
        leaf.operation.value.kind === 'literal'
      )
        literal = leaf.operation.value.value
      else if (
        this.isJumpStep(current) &&
        this.nodeForPc(leaf.operation.target).id !== region.entryId
      ) {
        // A jump step between two steps of the tail.
      } else if (
        leaf.operation.kind === 'jump' &&
        popped &&
        literal !== null &&
        this.nodeForPc(leaf.operation.target).id === region.entryId
      )
        break
      else
        decline(
          'unemittable-structured-control',
          `${leaf.operation.kind} at ${leaf.pc} breaks the exit tail of FINALLY_SETUP at ${region.setupPc}`,
        )
      const next = this.outgoing(current)
      if (
        next.length !== 1 ||
        next[0].kind !==
          (this.isJumpStep(current) ? 'branch' : 'fallthrough') ||
        next[0].targetPc === null
      )
        decline(
          'unemittable-structured-control',
          `Exit tail of FINALLY_SETUP at ${region.setupPc} is not straight-line`,
        )
      current = this.nodeById.get(this.targetBlock(next[0]))
    }
    if (this.nodeForPc(literal).id === region.normalEnd)
      return {
        lines,
        nextBlockId: this.nodeForPc(literal).id,
        terminated: false,
      }
    const pad = this.sequence(this.nodeForPc(literal).id, stopIds, {
      ...region.outer,
      pad: region,
      exiting: true,
    })
    return { ...pad, lines: [...lines, ...pad.lines] }
  }

  // Whether `block` starts an exit tail of the innermost region.
  startsRegionExit(block, context) {
    const region = context.regions?.at(-1)
    if (!region) return null
    const leaf = block.instruction
    if (leaf.operation.kind === 'handler-pop') return region
    if (
      region.kind === 'finally' &&
      leaf.operation.kind === 'assign' &&
      leaf.operation.destination === region.continuation &&
      leaf.operation.value.kind === 'literal'
    )
      return region
    // A routed return first saves its value in the payload, then loads the continuation.
    const next = this.soleFallthrough(block)?.instruction
    if (
      region.kind === 'finally' &&
      leaf.operation.kind === 'assign' &&
      leaf.operation.destination === region.payload &&
      leaf.operation.value.kind === 'register' &&
      next?.operation.kind === 'assign' &&
      next.operation.destination === region.continuation &&
      next.operation.value.kind === 'literal'
    )
      return region
    return null
  }

  renderForInNext(block, context) {
    const loop = this.activeLoop(context)
    if (!loop)
      decline(
        'unemittable-structured-control',
        `FOR_IN_NEXT at ${block.startPc} is not inside a proved natural loop`,
      )
    const { instruction } = block
    const outgoing = this.outgoing(block)
    const branch = outgoing.find((edge) => edge.kind === 'branch')
    const fallthrough = outgoing.find((edge) => edge.kind === 'fallthrough')
    if (!branch || !fallthrough || branch.targetPc === null)
      decline(
        'unemittable-structured-control',
        `FOR_IN_NEXT at ${instruction.pc} has no natural loop exit`,
      )
    const exit = this.targetBlock(branch)
    if (!loop.exitTargets.has(exit))
      decline(
        'unemittable-structured-control',
        `FOR_IN_NEXT at ${instruction.pc} exits outside the proved loop`,
      )
    const iterator = registerName(
      this.functionId,
      instruction.operation.iterator,
    )
    const destination = registerName(
      this.functionId,
      instruction.operation.destination,
    )
    const lines = [
      `if (${iterator}.index >= ${iterator}.keys.length) break ${loop.label};`,
      `${destination} = ${iterator}.keys[${iterator}.index++];`,
    ]
    return {
      lines,
      nextBlockId: this.targetBlock(fallthrough),
      terminated: false,
    }
  }

  renderJump(block, context, stopIds, lines) {
    const outgoing = this.outgoing(block)
    const edge = outgoing.find(({ kind }) => kind === 'branch')
    if (
      !edge ||
      edge.targetPc === null ||
      outgoing.some(({ kind }) => kind === 'finally')
    )
      decline(
        'unemittable-structured-control',
        `Unconditional jump at ${block.startPc} is not a direct structured edge`,
      )
    const target = this.targetBlock(edge)
    const transfer = this.loopTransfer(context, target)
    if (transfer?.kind === 'continue') {
      lines.push(`continue ${transfer.loop.label};`)
      return { lines, nextBlockId: target, terminated: true }
    }
    if (transfer?.kind === 'break') {
      lines.push(`break ${transfer.loop.label};`)
      return { lines, nextBlockId: transfer.target, terminated: true }
    }
    if (stopIds.has(target))
      return { lines, nextBlockId: target, terminated: false }
    // Any other jump is a step of the statement's own flow, as a fallthrough is: the walk
    // continues at its target, and emitting each block once keeps anything shared out.
    return { lines, nextBlockId: target, terminated: false }
  }

  renderReturnOrThrow(block, instruction, lines, context) {
    const outgoing = this.outgoing(block)
    const edge = outgoing.find(
      ({ kind }) => kind === 'return' || kind === 'throw',
    )
    const handledThrow =
      instruction.operation.kind === 'throw' &&
      outgoing.length === 1 &&
      this.regionProtects(outgoing[0], context)
    if (
      !handledThrow &&
      (!edge ||
        edge.targetPc !== null ||
        outgoing.some(({ kind }) => kind === 'finally' || kind === 'handler'))
    )
      decline(
        'unemittable-structured-control',
        `${instruction.operation.kind} at ${instruction.pc} has an unstructured completion route`,
      )
    if (
      context.pad &&
      (instruction.operation.kind !== 'return' ||
        instruction.operation.source !== context.pad.payload)
    )
      decline(
        'unemittable-structured-control',
        `Try region return payload at ${instruction.pc} is not the pending payload`,
      )
    const source = registerName(this.functionId, instruction.operation.source)
    lines.push(`${instruction.operation.kind} ${source};`)
    return { lines, nextBlockId: null, terminated: true }
  }

  renderOrdinary(block, instruction, lines, context) {
    const outgoing = this.outgoing(block)
    const normal = outgoing.filter(
      ({ kind }) => kind === 'fallthrough' || kind === 'call',
    )
    const exceptional = outgoing.filter(({ kind }) =>
      ['throw', 'handler', 'finally'].includes(kind),
    )
    if (
      normal.length !== 1 ||
      normal[0].targetPc === null ||
      exceptional.some(
        (edge) =>
          !(
            (edge.kind === 'throw' && edge.targetPc === null) ||
            this.regionProtects(edge, context)
          ),
      )
    )
      decline(
        'unemittable-structured-control',
        `${instruction.operation.kind} at ${instruction.pc} has an unstructured successor`,
      )
    this.renderInstruction(instruction, lines)
    return {
      lines,
      nextBlockId: this.targetBlock(normal[0]),
      terminated: false,
    }
  }

  emitBlock(block, context, stopIds) {
    this.checkState(block, context.regions ?? [])
    const { instruction } = block
    const terminal = instruction.operation.kind
    if (terminal === 'catch-setup' || terminal === 'finally-setup')
      return this.renderTry(block, context, stopIds)
    const exiting = this.startsRegionExit(block, context)
    if (exiting) return this.renderRegionExit(block, exiting, context, stopIds)
    // A pad re-issues an exit after its finalizer; it is rendered at the exit, before the
    // finalizer runs, so it may only transfer control and read its region's payload.
    if (context.exiting && !['jump', 'return'].includes(terminal))
      decline(
        'unemittable-structured-control',
        `Try region exit at ${block.startPc} is not a transfer`,
      )
    this.checkCarriers(instruction, context)
    this.markBlock(block)
    const lines = []
    if (instruction.operation.kind === 'jump')
      return this.renderJump(block, context, stopIds, lines)
    if (['return', 'throw'].includes(instruction.operation.kind))
      return this.renderReturnOrThrow(block, instruction, lines, context)
    if (instruction.operation.kind === 'branch')
      decline(
        'unemittable-structured-control',
        `Conditional block ${block.id} has no qualified conditional region`,
      )
    if (instruction.operation.kind === 'indirect-jump')
      decline(
        'unemittable-structured-control',
        `JUMP_REG at ${instruction.pc} lacks a natural structured representation`,
      )
    if (instruction.operation.kind === 'for-in-next')
      return this.renderForInNext(block, context)
    if (
      ['catch-setup', 'handler-pop', 'finally-setup'].includes(
        instruction.operation.kind,
      )
    )
      decline(
        'unemittable-structured-control',
        `${instruction.operation.kind} at ${instruction.pc} requires structured exception syntax`,
      )
    return this.renderOrdinary(block, instruction, lines, context)
  }

  // A loop ends where its planned statement region continues; every other exit of the region is a
  // transfer (break, continue, return or throw) its own block renders.
  emitLoop(region, context) {
    if (region.continuationBlockId === null)
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} has no continuation`,
      )
    const parentLoops = context.loops
    const exitTargets = new Set(
      [region.continuationBlockId].filter(
        (target) => !parentLoops.some((loop) => loop.exitTargets.has(target)),
      ),
    )
    if (exitTargets.size !== 1)
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} continues at an enclosing loop's exit`,
      )
    const label = `__recovered_loop_${this.functionId}_${this.loopNumber++}`
    const active = {
      headerBlockId: region.headerBlockId,
      continueBlockId: region.continueBlockId ?? null,
      exitTargets,
      label,
    }
    const body = this.sequence(region.headerBlockId, exitTargets, {
      ...context,
      loops: [...context.loops, active],
    })
    if (!body.terminated && !exitTargets.has(body.nextBlockId))
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} did not reach its proved exit`,
      )
    if (region.testBlockIds) {
      // The body's own end reaches the test as do-while's native flow does.
      const bodyLines =
        body.lines.at(-1) === `continue ${label};`
          ? body.lines.slice(0, -1)
          : body.lines
      const lines = [`${label}: do {`, ...bodyLines.map((line) => `  ${line}`)]
      if (!body.terminated) lines.push(`  break ${label};`)
      lines.push(`} while (${this.renderTest(region)});`)
      return { lines, nextBlockId: [...exitTargets][0], terminated: false }
    }
    const lines = [
      active.continueBlockId === null
        ? `${label}: while (true) {`
        : `${label}: for (; ; ${this.renderUpdate(region)}) {`,
    ]
    lines.push(...body.lines.map((line) => `  ${line}`))
    if (!body.terminated) lines.push(`  break ${label};`)
    lines.push('}')
    return { lines, nextBlockId: [...exitTargets][0], terminated: false }
  }

  // A switch selects its clause natively: the head's leading operations run before it, each later
  // case's run becomes its label, `(run…, value)`, which native evaluation runs in the chain's
  // order until one matches, and the default is taken when none does. Each clause body is walked
  // to the next clause's entry (a fallthrough), the end (a break) or a transfer; a body ending
  // anywhere else declines.
  emitSwitch(region, context) {
    const head = this.nodeById.get(region.testBlockId)
    this.markBlock(head)
    const lines = []
    const owner = `Switch ${region.testBlockId}`
    const labels = region.cases.map((item, index) => {
      const value = registerName(this.functionId, item.value)
      if (index === 0) return value
      const test = this.nodeById.get(item.testBlockId)
      const instructions = []
      for (const id of item.runBlockIds) {
        const node = this.nodeById.get(id)
        this.markBlock(node)
        if (!this.isJumpStep(node)) instructions.push(node.instruction)
      }
      this.markBlock(test)
      const parts = this.runExpressions(owner, instructions)
      return parts.length ? `(${[...parts, value].join(', ')})` : value
    })
    for (const id of [
      ...region.cases.flatMap(({ stepBlockIds }) => stepBlockIds),
      ...region.defaultStepBlockIds,
    ])
      this.markBlock(this.nodeById.get(id))
    const end = region.continuationBlockId
    const label = `__recovered_switch_${this.functionId}_${this.switchNumber++}`
    const active = {
      kind: 'switch',
      headerBlockId: null,
      continueBlockId: null,
      exitTargets: new Set(end === null ? [] : [end]),
      label,
    }
    const entries = new Set(
      region.clauses.map(({ entryBlockId }) => entryBlockId),
    )
    const body = []
    region.clauses.forEach((clause, index) => {
      body.push(
        clause.caseIndex === null
          ? 'default:'
          : `case ${labels[clause.caseIndex]}:`,
      )
      const following = region.clauses[index + 1]?.entryBlockId ?? null
      // Grouped labels share the next clause's body.
      if (following === clause.entryBlockId) return
      const last = following === null
      const walk =
        clause.entryBlockId === end
          ? { lines: [], nextBlockId: end, terminated: false }
          : this.sequence(
              clause.entryBlockId,
              new Set(
                [...entries, end].filter(
                  (id) => id !== null && id !== clause.entryBlockId,
                ),
              ),
              { ...context, loops: [...context.loops, active] },
            )
      body.push(...walk.lines.map((line) => `  ${line}`))
      if (walk.terminated) return
      if (walk.nextBlockId === end && end !== null) {
        if (!last) body.push(`  break ${label};`)
        return
      }
      if (walk.nextBlockId !== following)
        decline(
          'unemittable-structured-control',
          `${owner} clause at ${clause.entryBlockId} does not reach the next clause or the end`,
        )
    })
    lines.push(
      `${label}: switch (${registerName(this.functionId, region.discriminant)}) {`,
      ...body.map((line) => `  ${line}`),
      '}',
    )
    return end === null
      ? { lines, nextBlockId: null, terminated: true }
      : { lines, nextBlockId: end, terminated: false }
  }

  // Rendered instructions as expressions; a statement cannot stand in a loop clause or a case
  // label. `owner` names the statement for the refusal.
  runExpressions(owner, instructions) {
    const lines = []
    for (const instruction of instructions)
      this.renderInstruction(instruction, lines)
    return lines.map((line) => {
      const [statement, ...rest] = parse(line, {
        allowReturnOutsideFunction: true,
      }).program.body
      if (statement?.type !== 'ExpressionStatement' || rest.length)
        decline(
          'unemittable-structured-control',
          `${owner} clause is not an expression`,
        )
      return line.slice(statement.expression.start, statement.expression.end)
    })
  }

  // The run a loop's continue enters, as the clause a native continue runs: one comma expression
  // from the continue target to `stop`, a conditional inside it (planned to close inside the
  // run) written as `test ? (…) : (…)`. A for's update runs to the back edge's jump; a do-while's
  // test to its own branch, whose condition the caller adds.
  renderRun(region, runIds, stop) {
    const updateIds = new Set(runIds)
    const fail = (reason) =>
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} continue run ${reason}`,
      )
    const expressions = (instructions) =>
      this.runExpressions(`Natural loop ${region.headerBlockId}`, instructions)
    const walk = (start, stop) => {
      const parts = []
      let current = start
      while (current !== stop) {
        if (!updateIds.has(current)) fail(`leaves its run at ${current}`)
        const block = this.nodeById.get(current)
        this.markBlock(block)
        const leaf = block.instruction
        const conditional = this.conditionalByTest.get(current)
        if (conditional) {
          const condition = registerName(
            this.functionId,
            leaf.operation.condition,
          )
          const predicate =
            leaf.operation.when === 'false' ? `!${condition}` : condition
          const arm = (pc) =>
            walk(this.nodeForPc(pc).id, conditional.mergeBlockId).join(', ') ||
            'void 0'
          parts.push(
            `${predicate} ? (${arm(conditional.branchTargetPc)}) : (${arm(conditional.fallthroughTargetPc)})`,
          )
          current = conditional.mergeBlockId
          continue
        }
        const next = this.outgoing(block).filter(
          ({ kind, targetPc }) =>
            targetPc !== null &&
            ['fallthrough', 'call', 'branch'].includes(kind),
        )
        if (next.length !== 1) fail(`has no single next step at ${current}`)
        if (!this.isJumpStep(block)) parts.push(...expressions([leaf]))
        current = this.targetBlock(next[0])
      }
      return parts
    }
    return walk(region.continueBlockId, stop)
  }

  // A for's update clause.
  renderUpdate(region) {
    const parts = this.renderRun(
      region,
      region.updateBlockIds,
      region.headerBlockId,
    )
    if (region.updateBlockIds.some((id) => !this.emittedBlocks.has(id)))
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} update does not end at its back edge`,
      )
    return parts.join(', ')
  }

  // A do-while's test clause: the run up to its branch, then the condition under which the
  // branch goes back to the header.
  renderTest(region) {
    const [test, latch] = region.testBlockIds.slice(-2)
    const parts = this.renderRun(region, region.testBlockIds, test)
    const testBlock = this.nodeById.get(test)
    const latchBlock = this.nodeById.get(latch)
    const branch = testBlock.instruction
    const conditional = this.conditionalByTest.get(test)
    const jump = latchBlock.instruction
    if (
      !conditional ||
      jump.operation.kind !== 'jump' ||
      this.nodeForPc(jump.operation.target).id !== region.headerBlockId
    )
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} test does not end at its back edge`,
      )
    this.markBlock(testBlock)
    this.markBlock(latchBlock)
    const condition = registerName(this.functionId, branch.operation.condition)
    const predicate =
      branch.operation.when === 'false' ? `!${condition}` : condition
    const backOnBranch = this.nodeForPc(conditional.branchTargetPc).id === latch
    parts.push(backOnBranch ? predicate : invertPredicate(predicate))
    return parts.length > 1 ? `(${parts.join(', ')})` : parts[0]
  }

  sequence(startBlockId, stopIds, context) {
    const lines = []
    let current = startBlockId
    const visited = new Set()
    while (current !== null && !stopIds.has(current)) {
      if (visited.has(current))
        decline(
          'unemittable-structured-control',
          `Structured path revisits block ${current} without a proved loop`,
        )
      visited.add(current)
      const loop = this.loopByHeader.get(current)
      if (loop && this.activeLoop(context)?.headerBlockId !== current) {
        const result = this.emitLoop(loop, context)
        lines.push(...result.lines)
        current = result.nextBlockId
        continue
      }
      const transfer =
        this.activeLoop(context)?.headerBlockId === current
          ? null
          : this.loopTransfer(context, current)
      if (transfer?.kind === 'continue') {
        const transferBlock = this.nodeById.get(current)
        if (this.isJumpStep(transferBlock)) this.markBlock(transferBlock)
        lines.push(`continue ${transfer.loop.label};`)
        return { lines, nextBlockId: current, terminated: true }
      }
      if (transfer?.kind === 'break') {
        const transferBlock = this.nodeById.get(current)
        if (this.isJumpStep(transferBlock)) this.markBlock(transferBlock)
        lines.push(`break ${transfer.loop.label};`)
        return { lines, nextBlockId: transfer.target, terminated: true }
      }
      const switchRegion = this.switchByHead.get(current)
      if (switchRegion) {
        const result = this.emitSwitch(switchRegion, context)
        lines.push(...result.lines)
        if (result.terminated)
          return { lines, nextBlockId: result.nextBlockId, terminated: true }
        current = result.nextBlockId
        continue
      }
      const conditional = this.conditionalByTest.get(current)
      if (conditional) {
        const result = this.renderConditional(conditional, context, stopIds)
        lines.push(...result.lines)
        if (result.terminated)
          return { lines, nextBlockId: result.nextBlockId, terminated: true }
        current = result.nextBlockId
        continue
      }
      const block = this.nodeById.get(current)
      requireValue(
        block,
        'invalid-structured-control',
        `Structured path refers to missing block ${current}`,
      )
      const result = this.emitBlock(block, context, stopIds)
      lines.push(...result.lines)
      if (result.terminated)
        return { lines, nextBlockId: result.nextBlockId, terminated: true }
      current = result.nextBlockId
    }
    return { lines, nextBlockId: current, terminated: false }
  }

  // Cases the walk did not emit are unreachable (a reachable one declines). They are rendered in
  // runs, each in its own `if (false)`: a run ends after an operation that does not fall
  // through, and a setup's handler, finalizer or throw pad starts one.
  emitUnreachableBlocks(lines) {
    const cases = [...this.instructions].sort(
      (left, right) => left.pc - right.pc,
    )
    const entries = new Set(
      cases.flatMap(({ operation }) =>
        operation.kind === 'catch-setup'
          ? [operation.target]
          : operation.kind === 'finally-setup'
            ? [operation.target, operation.throwPad]
            : [],
      ),
    )
    const runs = []
    let run = null
    for (const instruction of cases) {
      const id = `${this.functionId}:b@${instruction.pc}`
      if (this.emittedBlocks.has(id)) {
        run = null
        continue
      }
      if (this.reachablePcs.has(instruction.pc))
        decline(
          'unemittable-structured-control',
          `Reachable structured block ${id} was not covered by qualified regions`,
        )
      if (!run || entries.has(instruction.pc)) {
        run = []
        runs.push(run)
      }
      run.push(instruction)
      if (RUN_ENDING_KINDS.has(instruction.operation.kind)) run = null
    }
    for (const instructions of runs) {
      lines.push('if (false) {')
      for (const instruction of instructions) {
        if (CONTROL_KINDS.has(instruction.operation.kind))
          lines.push('  void 0;')
        else {
          const rendered = []
          this.renderInstruction(instruction, rendered)
          lines.push(...rendered.map((line) => `  ${line}`))
        }
      }
      lines.push('}')
      for (const { pc } of instructions)
        this.emittedBlocks.add(`${this.functionId}:b@${pc}`)
    }
  }

  emit() {
    const entry = `${this.functionId}:b@${this.functionRecord.startPc}`
    const result = this.sequence(entry, new Set(), { loops: [] })
    if (!result.terminated || result.nextBlockId !== null)
      decline(
        'unemittable-structured-control',
        `Structured function ${this.functionId} has no complete natural exit`,
      )
    this.emitUnreachableBlocks(result.lines)
    return result.lines
  }
}

export function emitStructuredFunction(
  functionId,
  instructions,
  functionRecord,
  regions,
  functions,
  solved,
) {
  const lines = []
  const indent = (line) => `  ${line}`
  const effective = effectiveStructuredInstructions(
    functionId,
    instructions,
    solved,
  )
  const registers = functionRegisterSet(effective.instructions)
  const localCaptureRegisters = localCaptureRegisterSet(instructions)
  const needsCaptures = functionRecord.captureCount > 0
  const needsArguments = functionNeedsArguments(
    effective.instructions,
    functionRecord,
  )
  const parameters = []
  if (needsCaptures) parameters.push('__recovered_captures')
  if (needsArguments) parameters.push('...__recovered_args')
  lines.push(`function ${functionName(functionId)}(${parameters.join(', ')}) {`)
  if (localCaptureRegisters.size > 0)
    lines.push(indent(`const __recovered_cells_${functionId} = [];`))
  if (registers.size > 0)
    lines.push(
      indent(
        `let ${[...registers]
          .sort((left, right) => left - right)
          .map((register) => registerName(functionId, register))
          .join(', ')};`,
      ),
    )
  if (functionId !== 0) {
    if (needsArguments && functionRecord.hasRest) {
      const restRegister = functionRecord.paramCount - 1
      for (let register = 0; register < restRegister; register++) {
        if (!registers.has(register)) continue
        lines.push(
          indent(
            `${registerName(functionId, register)} = __recovered_args[${register}];`,
          ),
        )
      }
      if (registers.has(restRegister))
        lines.push(
          indent(
            `${registerName(functionId, restRegister)} = __recovered_args.slice(${restRegister});`,
          ),
        )
    } else if (needsArguments) {
      for (let register = 0; register < functionRecord.paramCount; register++) {
        if (!registers.has(register)) continue
        lines.push(
          indent(
            `${registerName(functionId, register)} = __recovered_args[${register}];`,
          ),
        )
      }
    }
    if (
      needsArguments &&
      functionRecord.paramCount < functionRecord.regCount &&
      registers.has(functionRecord.paramCount)
    )
      lines.push(
        indent(
          `${registerName(functionId, functionRecord.paramCount)} = __recovered_args;`,
        ),
      )
  }
  const body = new StructuredFunctionEmitter(
    functionId,
    instructions,
    functionRecord,
    regions,
    functions,
    effective.copyPlan,
    effective.coalescedMovePcs,
    solved,
  ).emit()
  lines.push(...body.map(indent))
  lines.push('}')
  return { lines, copyProofs: effective.copyProofs }
}
