import { proveCatchFinallyRegion } from './vm-switch-exception-region.js'
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
  structuredControlEdges,
} from './vm-switch-copy-planning.js'

class StructuredFunctionEmitter {
  constructor(
    functionId,
    instructions,
    functionRecord,
    controlFunction,
    edges,
    functions,
    copyPlan,
    coalescedMovePcs,
  ) {
    this.functionId = functionId
    this.instructions = instructions
    this.functionRecord = functionRecord
    this.controlFunction = controlFunction
    this.blocks = controlFunction.blocks
    this.blockById = new Map(this.blocks.map((block) => [block.id, block]))
    this.edgeById = structuredControlEdges(edges)
    this.functions = functions
    this.copyPlan = copyPlan
    this.coalescedMovePcs = coalescedMovePcs
    this.conditionalByTest = new Map(
      controlFunction.control.regions
        .filter(({ kind }) => kind === 'conditional')
        .map((region) => [region.testBlockId, region]),
    )
    this.loopByHeader = new Map(
      controlFunction.control.regions
        .filter(({ kind }) => kind === 'natural-loop')
        .map((region) => [region.headerBlockId, region]),
    )
    this.emittedBlocks = new Set()
    this.loopNumber = 0
  }

  blockForPc(pc) {
    const block = this.blocks.find(({ leaves }) =>
      leaves.some((leaf) => leaf.pc === pc),
    )
    return requireValue(
      block,
      'invalid-structured-control',
      `Structured control has no block for target ${pc}`,
    )
  }

  outgoing(block) {
    return block.successorEdgeIds.map((edgeId) => this.edgeById.get(edgeId))
  }

  targetBlock(edge) {
    return edge.targetPc === null ? null : this.blockForPc(edge.targetPc).id
  }

  markBlock(block) {
    if (this.emittedBlocks.has(block.id))
      decline(
        'unemittable-structured-control',
        `Structured block ${block.id} would be emitted more than once`,
      )
    this.emittedBlocks.add(block.id)
  }

  activeLoop(context) {
    return context.loops.at(-1) ?? null
  }

  loopTransfer(context, target) {
    for (let index = context.loops.length - 1; index >= 0; index -= 1) {
      const loop = context.loops[index]
      if (target === loop.headerBlockId)
        return { kind: 'continue', loop, target }
      if (loop.exitTargets.has(target)) return { kind: 'break', loop, target }
      if (loop.exitAliases.has(target))
        return {
          kind: 'break',
          loop,
          target: loop.exitAliases.get(target),
        }
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

  renderNonTerminatingLeaves(block, lines) {
    let last = block.leaves.at(-1)
    for (let index = 0; index < block.leaves.length - 1; index += 1) {
      const instruction = block.leaves[index]
      const move = block.leaves[index + 1]
      const destination = this.copyPlan.get(instruction.pc)
      if (
        destination !== undefined &&
        move.operation.kind === 'assign' &&
        move.operation.value.kind === 'register'
      ) {
        this.renderInstruction(
          retargetDestination(instruction, destination),
          lines,
        )
        if (move === last) last = { ...move, coalesced: true }
        index += 1
        continue
      }
      this.renderInstruction(instruction, lines)
    }
    if (this.copyPlan.has(last.pc))
      last = retargetDestination(last, this.copyPlan.get(last.pc))
    if (this.coalescedMovePcs.has(last.pc)) last = { ...last, coalesced: true }
    return last
  }

  renderConditional(region, context, stopIds) {
    const test = this.blockById.get(region.testBlockId)
    requireValue(
      test,
      'invalid-structured-control',
      `Conditional region refers to missing test block ${region.testBlockId}`,
    )
    this.markBlock(test)
    const lines = []
    const instruction = this.renderNonTerminatingLeaves(test, lines)
    if (instruction.operation.kind !== 'branch')
      decline(
        'unemittable-structured-control',
        `Conditional region ${region.testBlockId} has a non-conditional leaf`,
      )
    const branchEdge = this.edgeById.get(region.branchEdgeId)
    const fallthroughEdge = this.edgeById.get(region.fallthroughEdgeId)
    if (
      !branchEdge ||
      !fallthroughEdge ||
      branchEdge.kind !== 'conditional' ||
      fallthroughEdge.kind !== 'fallthrough'
    )
      decline(
        'invalid-structured-control',
        `Conditional region ${region.testBlockId} has stale edge metadata`,
      )
    if (
      region.handlerTargetBlockId &&
      region.handlerTargetBlockId !== context.catchTarget
    )
      decline(
        'unemittable-structured-control',
        `Conditional region ${region.testBlockId} has an unowned handler route`,
      )
    const merge = region.mergeBlockId
    const branch = this.sequence(
      this.targetBlock(branchEdge),
      new Set([...stopIds, merge]),
      merge === null
        ? { ...context, terminalBlocks: new Set(region.branchTerminalBlockIds) }
        : context,
    )
    const fallthrough = this.sequence(
      this.targetBlock(fallthroughEdge),
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
        (loop) =>
          loop.headerBlockId === merge ||
          loop.exitTargets.has(merge) ||
          loop.exitAliases.has(merge),
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

  normalTargets(block) {
    return this.outgoing(block)
      .filter(
        ({ kind, targetPc }) =>
          ['fallthrough', 'branch', 'conditional', 'call'].includes(kind) &&
          targetPc !== null,
      )
      .map((edge) => this.targetBlock(edge))
  }

  findTryEnd(startBlockId) {
    const queue = [{ blockId: startBlockId, distance: 0 }]
    const visited = new Set()
    const candidates = []
    while (queue.length) {
      const { blockId, distance } = queue.shift()
      if (visited.has(blockId)) continue
      visited.add(blockId)
      const block = this.blockById.get(blockId)
      requireValue(
        block,
        'invalid-structured-control',
        `TRY_SETUP body refers to missing block ${blockId}`,
      )
      if (block.leaves.at(-1).operation.kind === 'handler-pop') {
        candidates.push({ blockId, distance })
        continue
      }
      for (const target of this.normalTargets(block))
        queue.push({ blockId: target, distance: distance + 1 })
    }
    if (!candidates.length) return null
    const nearest = Math.min(...candidates.map(({ distance }) => distance))
    const nearestCandidates = candidates.filter(
      ({ distance }) => distance === nearest,
    )
    if (nearestCandidates.length !== 1)
      decline(
        'unemittable-structured-control',
        `TRY_SETUP at ${startBlockId} has ambiguous TRY_END structure`,
      )
    return nearestCandidates[0].blockId
  }

  provesTerminalThrow(startBlockId, handlerId) {
    const visited = new Set()
    let current = startBlockId
    while (current !== null && !visited.has(current)) {
      visited.add(current)
      const block = this.blockById.get(current)
      if (!block) return false
      const outgoing = this.outgoing(block)
      const handlerEdges = outgoing.filter(({ kind }) => kind === 'handler')
      if (
        handlerEdges.some(
          (edge) =>
            edge.targetPc === null || this.targetBlock(edge) !== handlerId,
        ) ||
        outgoing.some(({ kind }) => kind === 'finally' || kind === 'throw')
      )
        return false
      if (block.leaves.at(-1).operation.kind === 'throw')
        return handlerEdges.length === 1 && outgoing.length === 1
      const normal = outgoing.filter(({ kind }) =>
        ['fallthrough', 'call'].includes(kind),
      )
      if (
        normal.length !== 1 ||
        outgoing.length !== normal.length + handlerEdges.length
      )
        return false
      current = this.targetBlock(normal[0])
    }
    return false
  }

  provesLinearTerminalPath(startBlockId) {
    const visited = new Set()
    let current = startBlockId
    while (current !== null && !visited.has(current)) {
      visited.add(current)
      const block = this.blockById.get(current)
      if (!block) return false
      const outgoing = this.outgoing(block)
      const terminal = block.leaves.at(-1).operation.kind
      if (terminal === 'return' || terminal === 'throw')
        return (
          outgoing.length === 1 &&
          outgoing[0].kind === terminal &&
          outgoing[0].targetPc === null
        )
      if (
        outgoing.length !== 1 ||
        !['fallthrough', 'call'].includes(outgoing[0].kind) ||
        outgoing[0].targetPc === null
      )
        return false
      current = this.targetBlock(outgoing[0])
    }
    return false
  }

  renderHandler(handler, exceptionRegister, lines) {
    this.markBlock(handler)
    lines.push('} catch (__recovered_error) {')
    lines.push(
      `  ${registerName(this.functionId, exceptionRegister)} = __recovered_error;`,
    )
    const last = handler.leaves.at(-1)
    for (const instruction of handler.leaves) {
      if (
        instruction === last &&
        ['return', 'throw', 'jump'].includes(instruction.operation.kind)
      )
        break
      this.renderInstruction(instruction, lines)
    }
    if (['return', 'throw'].includes(last.operation.kind)) {
      const source = registerName(this.functionId, last.operation.source)
      lines.push(`${last.operation.kind} ${source};`)
    } else if (last.operation.kind === 'jump') {
      decline(
        'unemittable-structured-control',
        `Handler block ${handler.id} has an unstructured jump`,
      )
    }
    lines.push('}')
  }

  renderTryCatch(block, context) {
    this.markBlock(block)
    const setup = block.leaves.at(-1)
    if (setup.operation.kind !== 'catch-setup')
      decline(
        'unemittable-structured-control',
        `Expected TRY_SETUP at ${block.startPc}`,
      )
    const handler = this.blockForPc(setup.operation.target)
    const exceptionRegister = setup.operation.exceptionRegister
    const bodyStartEdge = this.edgeTo(block, 'fallthrough')
    if (!bodyStartEdge || bodyStartEdge.targetPc === null)
      decline(
        'unemittable-structured-control',
        `TRY_SETUP at ${setup.pc} has no body entry`,
      )
    const tryEndId = this.findTryEnd(this.targetBlock(bodyStartEdge))
    if (tryEndId === null) {
      const bodyStart = this.targetBlock(bodyStartEdge)
      if (!this.provesTerminalThrow(bodyStart, handler.id))
        decline(
          'unemittable-structured-control',
          `TRY_SETUP at ${setup.pc} has no proved terminal throw`,
        )
      const body = this.sequence(bodyStart, new Set(), {
        ...context,
        catchTarget: handler.id,
      })
      if (!body.terminated || body.nextBlockId !== null)
        decline(
          'unemittable-structured-control',
          `TRY_SETUP at ${setup.pc} has an unstructured terminal body`,
        )
      const handlerBody = this.sequence(handler.id, new Set(), context)
      if (!handlerBody.terminated || handlerBody.nextBlockId !== null)
        decline(
          'unemittable-structured-control',
          `TRY_SETUP at ${setup.pc} has an unstructured terminal handler`,
        )
      const lines = ['try {']
      lines.push(...body.lines.map((line) => `  ${line}`))
      lines.push('} catch (__recovered_error) {')
      lines.push(
        `  ${registerName(this.functionId, exceptionRegister)} = __recovered_error;`,
      )
      lines.push(...handlerBody.lines.map((line) => `  ${line}`))
      lines.push('}')
      return { lines, nextBlockId: null, terminated: true }
    }
    const body = this.sequence(
      this.targetBlock(bodyStartEdge),
      new Set([tryEndId]),
      { ...context, catchTarget: handler.id },
    )
    if (body.terminated || body.nextBlockId !== tryEndId)
      decline(
        'unemittable-structured-control',
        `TRY_SETUP at ${setup.pc} has an unstructured body`,
      )
    const tryEnd = this.blockById.get(tryEndId)
    this.markBlock(tryEnd)
    this.renderNonTerminatingLeaves(tryEnd, body.lines)
    if (tryEnd.leaves.at(-1).operation.kind !== 'handler-pop')
      decline(
        'unemittable-structured-control',
        `Expected TRY_END at ${tryEnd.startPc}`,
      )
    const afterTryEdge = this.edgeTo(tryEnd, 'fallthrough')
    if (!afterTryEdge || afterTryEdge.targetPc === null)
      decline(
        'unemittable-structured-control',
        `TRY_END at ${tryEnd.startPc} has no continuation`,
      )
    const normalNext = this.blockForPc(afterTryEdge.targetPc)
    if (
      this.provesLinearTerminalPath(normalNext.id) &&
      this.provesLinearTerminalPath(handler.id)
    ) {
      const normalTail = this.sequence(normalNext.id, new Set(), context)
      const handlerTail = this.sequence(handler.id, new Set(), context)
      if (
        !normalTail.terminated ||
        normalTail.nextBlockId !== null ||
        !handlerTail.terminated ||
        handlerTail.nextBlockId !== null
      )
        decline(
          'unemittable-structured-control',
          `TRY_SETUP at ${setup.pc} has an incomplete terminal handler`,
        )
      const lines = ['try {']
      lines.push(...body.lines.map((line) => `  ${line}`))
      lines.push('} catch (__recovered_error) {')
      lines.push(
        `  ${registerName(this.functionId, exceptionRegister)} = __recovered_error;`,
      )
      lines.push(...handlerTail.lines.map((line) => `  ${line}`))
      lines.push('}')
      // TRY_END removed this handler before the normal tail executes.
      lines.push(...normalTail.lines)
      return { lines, nextBlockId: null, terminated: true }
    }
    const handlerNext = this.blockForPc(handler.leaves.at(-1).nextPc)
    let continuation = normalNext
    const normalTail = []
    if (normalNext.leaves.at(-1).operation.kind === 'jump') {
      const jump = normalNext.leaves.at(-1)
      const target = this.blockForPc(jump.operation.target)
      if (target.id !== handlerNext.id)
        decline(
          'unemittable-structured-control',
          `TRY_END at ${tryEnd.startPc} has a non-shared continuation`,
        )
      this.markBlock(normalNext)
      this.renderNonTerminatingLeaves(normalNext, normalTail)
      continuation = handlerNext
    } else if (normalNext.id !== handlerNext.id) {
      decline(
        'unemittable-structured-control',
        `TRY_SETUP at ${setup.pc} does not rejoin after its handler`,
      )
    }
    const normalFlag = `__recovered_normal_${this.functionId}_${setup.pc}`
    const lines = normalTail.length > 0 ? [`let ${normalFlag} = false;`] : []
    lines.push('try {')
    lines.push(...body.lines.map((line) => `  ${line}`))
    if (normalTail.length > 0) lines.push(`  ${normalFlag} = true;`)
    this.renderHandler(handler, exceptionRegister, lines)
    if (normalTail.length > 0) {
      lines.push(`if (${normalFlag}) {`)
      lines.push(...normalTail.map((line) => `  ${line}`))
      lines.push('}')
    }
    return { lines, nextBlockId: continuation.id, terminated: false }
  }

  renderTryFinally(block) {
    const setup = block.leaves.at(-1)
    const { target, continuation, payload, throwPad } = setup.operation
    const firstEdge = this.outgoing(block)
    if (
      firstEdge.length === 1 &&
      firstEdge[0].kind === 'fallthrough' &&
      firstEdge[0].targetPc !== null &&
      this.blockForPc(firstEdge[0].targetPc).leaves.at(-1).operation.kind ===
        'catch-setup'
    )
      return this.renderTryCatchFinally(block)
    const fail = () =>
      decline(
        'unemittable-structured-control',
        `FINALLY_SETUP at ${setup.pc} has no proved return continuation`,
      )
    const soleEdge = (current, kind) => {
      const edges = this.outgoing(current)
      if (
        edges.length !== 1 ||
        edges[0].kind !== kind ||
        edges[0].targetPc === null
      )
        fail()
      return this.blockForPc(edges[0].targetPc)
    }
    const leaf = (current, kind) => {
      if (
        current.leaves.length !== 1 ||
        current.leaves[0].operation.kind !== kind
      )
        fail()
      return current.leaves[0]
    }
    const bodyStart = soleEdge(block, 'fallthrough')
    const finalizerStart = this.blockForPc(target)
    const throwBlock = this.blockForPc(throwPad)
    const matchesState = (item, active) => {
      const state = item.handlerStateIn
      const stack = state?.stack
      const finalizers = state?.finallyStack
      if (!Array.isArray(stack) || !Array.isArray(finalizers)) return false
      if (!active) return stack.length === 0 && finalizers.length === 0
      if (stack.length !== 1 || finalizers.length !== 1) return false
      return [stack[0], finalizers[0]].every(
        (record) =>
          record.type === 'finally' &&
          record.setupPc === setup.pc &&
          record.finallyPc === target &&
          record.continuationReg === continuation &&
          record.payloadReg === payload &&
          record.throwPadPc === throwPad,
      )
    }
    if (!matchesState(block, false)) fail()
    const body = []
    const visited = new Set()
    let current = bodyStart
    while (current.leaves.at(-1).operation.kind !== 'handler-pop') {
      if (
        visited.has(current.id) ||
        current.leaves.length !== 1 ||
        current.leaves[0].operation.kind !== 'assign'
      )
        fail()
      visited.add(current.id)
      body.push(current)
      current = soleEdge(current, 'fallthrough')
    }
    const pop = current
    leaf(pop, 'handler-pop')
    if (
      !matchesState(pop, true) ||
      body.some((item) => !matchesState(item, true))
    )
      fail()
    const jump = soleEdge(pop, 'fallthrough')
    if (
      !matchesState(jump, false) ||
      leaf(jump, 'jump').operation.target !== target ||
      soleEdge(jump, 'finally').id !== finalizerStart.id
    )
      fail()
    if (body.length < 2) fail()
    const payloadCopy = body.at(-2).leaves[0].operation
    const continuationLoad = body.at(-1).leaves[0].operation
    if (
      payloadCopy.destination !== payload ||
      payloadCopy.value.kind !== 'register' ||
      continuationLoad.destination !== continuation ||
      continuationLoad.value.kind !== 'literal' ||
      !Number.isSafeInteger(continuationLoad.value.value)
    )
      fail()
    const returnBlock = this.blockForPc(continuationLoad.value.value)
    if (
      !matchesState(returnBlock, false) ||
      leaf(returnBlock, 'return').operation.source !== payload ||
      this.outgoing(returnBlock).length !== 1 ||
      this.outgoing(returnBlock)[0].kind !== 'return' ||
      this.outgoing(returnBlock)[0].targetPc !== null
    )
      fail()
    if (
      !matchesState(finalizerStart, false) ||
      !matchesState(throwBlock, false) ||
      leaf(throwBlock, 'throw').operation.source !== payload ||
      throwBlock.leaves[0].reachable
    )
      fail()
    const finalizer = []
    visited.clear()
    current = finalizerStart
    while (current.leaves.at(-1).operation.kind !== 'indirect-jump') {
      if (
        visited.has(current.id) ||
        current.leaves.length !== 1 ||
        !['assign', 'upvalue-read', 'upvalue-write'].includes(
          current.leaves[0].operation.kind,
        )
      )
        fail()
      const operation = current.leaves[0].operation
      if (
        operation.destination === continuation ||
        operation.destination === payload ||
        operation.source === continuation ||
        operation.source === payload ||
        operation.value?.index === continuation ||
        operation.value?.index === payload ||
        operation.value?.left === continuation ||
        operation.value?.left === payload ||
        operation.value?.right === continuation ||
        operation.value?.right === payload
      )
        fail()
      visited.add(current.id)
      finalizer.push(current)
      current = soleEdge(current, 'fallthrough')
    }
    const resume = current
    if (
      !matchesState(resume, false) ||
      leaf(resume, 'indirect-jump').operation.source !== continuation ||
      soleEdge(resume, 'branch').id !== returnBlock.id
    )
      fail()
    if (
      this.outgoing(block).length !== 1 ||
      body.some((item) => !item.leaves[0].reachable) ||
      finalizer.some(
        (item) => !item.leaves[0].reachable || !matchesState(item, false),
      )
    )
      fail()

    for (const item of [
      block,
      ...body,
      pop,
      jump,
      ...finalizer,
      resume,
      returnBlock,
    ])
      this.markBlock(item)
    const lines = ['try {']
    for (const item of body) {
      if (item === body.at(-1)) break
      for (const instruction of item.leaves)
        this.renderInstruction(instruction, lines)
    }
    lines.push(
      `return ${registerName(this.functionId, payloadCopy.value.index)};`,
    )
    lines.push('} finally {')
    for (const item of finalizer) {
      const rendered = []
      for (const instruction of item.leaves)
        this.renderInstruction(instruction, rendered)
      lines.push(...rendered.map((line) => `  ${line}`))
    }
    lines.push('}')
    return { lines, nextBlockId: null, terminated: true }
  }

  renderTryCatchFinally(block) {
    const plan = proveCatchFinallyRegion(this, block)
    for (const item of plan.owned) this.markBlock(item)
    const render = (tree) => {
      const lines = []
      for (const node of tree) {
        if (node.kind === 'return') {
          this.renderInstruction(node.copy.leaves[0], lines)
          lines.push(
            `return ${registerName(this.functionId, node.copy.leaves[0].operation.destination)};`,
          )
          continue
        }
        if (node.kind === 'resume') continue
        const instruction = this.renderNonTerminatingLeaves(node.item, lines)
        if (node.kind === 'branch') {
          const condition = registerName(
            this.functionId,
            instruction.operation.condition,
          )
          const predicate =
            instruction.operation.when === 'false' ? `!${condition}` : condition
          lines.push(`if (${predicate}) {`)
          lines.push(...render(node.branch).map((line) => `  ${line}`))
          lines.push('} else {')
          lines.push(...render(node.fallthrough).map((line) => `  ${line}`))
          lines.push('}')
        } else if (node.kind === 'throw') {
          lines.push(
            `throw ${registerName(this.functionId, instruction.operation.source)};`,
          )
        } else if (node.kind !== 'jump')
          this.renderInstruction(instruction, lines)
      }
      return lines
    }
    const lines = ['try {', '  try {']
    lines.push(...render(plan.body).map((line) => `    ${line}`))
    lines.push('  } catch (__recovered_error) {')
    lines.push(
      `    ${registerName(this.functionId, plan.exceptionRegister)} = __recovered_error;`,
    )
    lines.push(...render(plan.handler).map((line) => `    ${line}`))
    lines.push('  }', '} finally {')
    lines.push(...render(plan.finalizer).map((line) => `  ${line}`))
    lines.push('}')
    return { lines, nextBlockId: null, terminated: true }
  }

  renderForInNext(block, context) {
    const loop = this.activeLoop(context)
    if (!loop)
      decline(
        'unemittable-structured-control',
        `FOR_IN_NEXT at ${block.startPc} is not inside a proved natural loop`,
      )
    const instruction = block.leaves.at(-1)
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
    if (context.terminalBlocks?.has(target))
      return { lines, nextBlockId: target, terminated: false }
    decline(
      'unemittable-structured-control',
      `Unconditional jump at ${block.startPc} targets ${target} outside its proved region`,
    )
  }

  renderReturnOrThrow(block, instruction, lines, context) {
    const outgoing = this.outgoing(block)
    const edge = outgoing.find(
      ({ kind }) => kind === 'return' || kind === 'throw',
    )
    const handledThrow =
      instruction.operation.kind === 'throw' &&
      context.catchTarget &&
      outgoing.length === 1 &&
      outgoing[0].kind === 'handler' &&
      this.targetBlock(outgoing[0]) === context.catchTarget
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
            (edge.kind === 'handler' &&
              context.catchTarget &&
              this.targetBlock(edge) === context.catchTarget)
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
    const terminal = block.leaves.at(-1).operation.kind
    if (terminal === 'catch-setup' || terminal === 'finally-setup') {
      const prelude = []
      this.renderNonTerminatingLeaves(block, prelude)
      const result =
        terminal === 'catch-setup'
          ? this.renderTryCatch(block, context)
          : this.renderTryFinally(block)
      return { ...result, lines: [...prelude, ...result.lines] }
    }
    this.markBlock(block)
    const lines = []
    const instruction = this.renderNonTerminatingLeaves(block, lines)
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

  emitLoop(region, context) {
    const bodyIds = new Set(region.bodyBlockIds)
    const exitEdges = region.exitEdgeIds.map((edgeId) =>
      requireValue(
        this.edgeById.get(edgeId),
        'invalid-structured-control',
        `Natural loop ${region.headerBlockId} refers to missing exit edge`,
      ),
    )
    const rawExitTargets = new Set(
      exitEdges
        .filter((edge) => edge.targetPc !== null)
        .map((edge) => this.targetBlock(edge))
        .filter((target) => !bodyIds.has(target)),
    )
    const parentLoops = context.loops
    const exitTargets = new Set(
      [...rawExitTargets].filter(
        (target) =>
          !parentLoops.some(
            (loop) =>
              loop.exitTargets.has(target) || loop.exitAliases.has(target),
          ),
      ),
    )
    const exitAliases = new Map()
    for (const target of [...exitTargets]) {
      const block = this.blockById.get(target)
      const terminal = block?.leaves.at(-1)
      if (
        block &&
        block.leaves.length === 1 &&
        terminal.operation.kind === 'jump'
      ) {
        const jumpTarget = this.blockForPc(terminal.operation.target).id
        if (!bodyIds.has(jumpTarget) && jumpTarget !== target) {
          exitTargets.delete(target)
          exitTargets.add(jumpTarget)
          exitAliases.set(target, jumpTarget)
        }
      }
    }
    if (exitTargets.size !== 1)
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} has multiple unstructured exits`,
      )
    const label = `__recovered_loop_${this.functionId}_${this.loopNumber++}`
    const active = {
      headerBlockId: region.headerBlockId,
      exitTargets,
      exitAliases,
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
    const lines = [`${label}: while (true) {`]
    lines.push(...body.lines.map((line) => `  ${line}`))
    if (!body.terminated) lines.push(`  break ${label};`)
    lines.push('}')
    return { lines, nextBlockId: [...exitTargets][0], terminated: false }
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
        const transferBlock = this.blockById.get(current)
        if (transferBlock?.leaves.at(-1).operation.kind === 'jump')
          this.markBlock(transferBlock)
        lines.push(`continue ${transfer.loop.label};`)
        return { lines, nextBlockId: current, terminated: true }
      }
      if (transfer?.kind === 'break') {
        const transferBlock = this.blockById.get(current)
        if (transferBlock?.leaves.at(-1).operation.kind === 'jump')
          this.markBlock(transferBlock)
        lines.push(`break ${transfer.loop.label};`)
        return { lines, nextBlockId: transfer.target, terminated: true }
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
      const block = this.blockById.get(current)
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

  emitUnreachableBlocks(lines) {
    for (const block of this.blocks) {
      if (this.emittedBlocks.has(block.id)) continue
      if (block.leaves.some(({ reachable }) => reachable))
        decline(
          'unemittable-structured-control',
          `Reachable structured block ${block.id} was not covered by qualified regions`,
        )
      lines.push('if (false) {')
      for (const instruction of block.leaves) {
        if (
          [
            'jump',
            'branch',
            'indirect-jump',
            'for-in-next',
            'return',
            'throw',
            'catch-setup',
            'handler-pop',
            'finally-setup',
          ].includes(instruction.operation.kind)
        )
          lines.push('  void 0;')
        else {
          const rendered = []
          this.renderInstruction(instruction, rendered)
          lines.push(...rendered.map((line) => `  ${line}`))
        }
      }
      lines.push('}')
      this.emittedBlocks.add(block.id)
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
  controlFunction,
  edges,
  functions,
) {
  const lines = []
  const indent = (line) => `  ${line}`
  const effective = effectiveStructuredInstructions(
    functionId,
    instructions,
    controlFunction,
    edges,
    functionRecord.regCount,
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
    controlFunction,
    edges,
    functions,
    effective.copyPlan,
    effective.coalescedMovePcs,
  ).emit()
  lines.push(...body.map(indent))
  lines.push('}')
  return { lines, copyProofs: effective.copyProofs }
}
