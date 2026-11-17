import * as t from '@babel/types'
import { effectiveStructuredInstructions } from '../values/value-planning.js'
import {
  functionHead,
  functionNode,
  functionRegisterSet,
} from '../model/operations.js'
import { decline, requireValue } from '../model/model.js'
import { EmitState } from './emit-state.js'
import { ConditionalRegions } from './conditional-region.js'
import { SwitchRegions } from './switch-region.js'
import { LoopRegions } from './loop-region.js'
import { TryRegions } from './try-region.js'
import { CONTINUING_EDGES } from '../model/control.js'

/**
 * One structured function's walk over its emission state (`state`). `sequence` writes the statements
 * from a block to a stop, each one `statementAt` finds there; the region renderers (conditionals,
 * switches, loops, tries) are generators that yield each walk they need, `{ start, stops, context }`,
 * and `drive` answers it with `sequence`. No renderer calls back into the walk.
 */
class StructuredFunctionEmitter {
  constructor(state) {
    this.state = state
    this.loops = new LoopRegions(state)
    this.tries = new TryRegions(state)
    this.conditionals = new ConditionalRegions(state)
    this.switches = new SwitchRegions(state)
    state.forInHeads = this.loops.planForInHeads(state.loopRegions)
    state.forInSetups = new Map(
      [...state.forInHeads.values()].map((head) => [head.setupId, head]),
    )
    this.conditionals.writeValues()
  }

  // Runs a region renderer, answering each walk it yields with this function's walk.
  drive(renderer) {
    let step = renderer.next()
    while (!step.done) {
      const { start, stops, context } = step.value
      step = renderer.next(this.sequence(start, stops, context))
    }
    return step.value
  }

  sequence(startBlockId, stopIds, context) {
    const statements = []
    let current = startBlockId
    const visited = new Set()
    while (current !== null && !stopIds.has(current)) {
      if (visited.has(current))
        decline(
          'unemittable-structured-control',
          `Structured path revisits block ${current} without a proved loop`,
        )
      visited.add(current)
      const result = this.statementAt(current, stopIds, context)
      statements.push(...result.statements)
      if (result.terminated)
        return { statements, nextBlockId: result.nextBlockId, terminated: true }
      current = result.nextBlockId
    }
    return { statements, nextBlockId: current, terminated: false }
  }

  // The statement that starts at `current`: a labeled block, a loop, a transfer out of the walk, a
  // switch, a conditional value (written in its use), a conditional, or the block itself.
  statementAt(current, stopIds, context) {
    const { state } = this
    const blockEnd = state.labeledByHead
      .get(current)
      ?.findLast((end) => !context.openBlocks?.includes(end))
    if (blockEnd)
      return {
        statements: [
          this.emitLabeledBlock(current, blockEnd, stopIds, context),
        ],
        nextBlockId: blockEnd,
        terminated: false,
      }
    const loop = state.loopByHeader.get(current)
    if (loop && state.activeLoop(context)?.headerBlockId !== current) {
      // The walk goes on past a loop whatever it reports.
      const { statements, nextBlockId } = this.drive(
        this.loops.emitLoop(loop, context),
      )
      return { statements, nextBlockId, terminated: false }
    }
    const transfer = this.transferAt(current, context)
    if (transfer) return transfer
    const switchRegion = state.switchByHead.get(current)
    if (switchRegion)
      return this.drive(this.switches.render(switchRegion, context))
    const value = state.absorbedByEntry.get(
      state.nodeById.get(current)?.startPc,
    )
    if (value) {
      // A conditional value is written in its use, which comes after its merge.
      for (const pc of value.pcs) state.markBlock(state.nodeForPc(pc))
      return {
        statements: [],
        nextBlockId: state.nodeForPc(value.mergePc).id,
        terminated: false,
      }
    }
    const conditional = state.conditionalByTest.get(current)
    if (conditional)
      return this.drive(this.conditionals.render(conditional, context, stopIds))
    const block = state.nodeById.get(current)
    requireValue(
      block,
      'invalid-structured-control',
      `Structured path refers to missing block ${current}`,
    )
    return this.emitBlock(block, context, stopIds)
  }

  // A `continue` or `break` to `current`, unless `current` is the active loop's own header.
  transferAt(current, context) {
    const { state } = this
    if (state.activeLoop(context)?.headerBlockId === current) return null
    const transfer = state.loopTransfer(context, current)
    if (!transfer) return null
    const transferBlock = state.nodeById.get(current)
    if (state.isJumpStep(transferBlock)) state.markBlock(transferBlock)
    return {
      statements: [state.transferTo(transfer.kind, transfer.loop, context)],
      nextBlockId: transfer.kind === 'continue' ? current : transfer.target,
      terminated: true,
    }
  }

  // A labeled block around what starts at `start`: every jump to its end is a `break`. Its other
  // ends, nearer, are blocks nested inside it.
  emitLabeledBlock(start, end, stopIds, context) {
    const label = `__recovered_block_${this.state.functionId}_${this.state.blockNumber++}`
    const block = { kind: 'block', exitTargets: new Set([end]), label }
    const body = this.sequence(start, new Set([...stopIds, end]), {
      ...context,
      openBlocks: [...(context.openBlocks ?? []), end],
      loops: [...context.loops, block],
      enclosing: [...(context.enclosing ?? context.loops), block],
    })
    return t.labeledStatement(
      t.identifier(label),
      t.blockStatement(body.statements),
    )
  }

  emitBlock(block, context, stopIds) {
    this.tries.checkState(block, context.regions ?? [])
    const { instruction } = block
    const terminal = instruction.operation.kind
    if (terminal === 'catch-setup' || terminal === 'finally-setup')
      return this.drive(this.tries.renderTry(block, context, stopIds))
    const exiting = this.tries.startsRegionExit(block, context)
    if (exiting)
      return this.drive(
        this.tries.renderRegionExit(block, exiting, context, stopIds),
      )
    // A pad re-issues an exit after its finalizer; it is rendered at the exit, before the
    // finalizer runs, so it may only transfer control and read its region's payload.
    if (context.exiting && !['jump', 'return'].includes(terminal))
      decline(
        'unemittable-structured-control',
        `Try region exit at ${block.startPc} is not a transfer`,
      )
    this.tries.checkCarriers(instruction, context)
    this.state.markBlock(block)
    if (instruction.operation.kind === 'jump')
      return this.renderJump(block, context)
    if (['return', 'throw'].includes(instruction.operation.kind))
      return this.renderReturnOrThrow(block, instruction, context)
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
      return this.loops.renderForInNext(block, context)
    if (
      ['catch-setup', 'handler-pop', 'finally-setup'].includes(
        instruction.operation.kind,
      )
    )
      decline(
        'unemittable-structured-control',
        `${instruction.operation.kind} at ${instruction.pc} requires structured exception syntax`,
      )
    return this.renderOrdinary(block, instruction, context)
  }

  renderJump(block, context) {
    const outgoing = this.state.outgoing(block)
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
    const target = this.state.targetBlock(edge)
    const transfer = this.state.loopTransfer(context, target)
    if (transfer?.kind === 'continue')
      return {
        statements: [this.state.transferTo('continue', transfer.loop, context)],
        nextBlockId: target,
        terminated: true,
      }
    if (transfer?.kind === 'break')
      return {
        statements: [this.state.transferTo('break', transfer.loop, context)],
        nextBlockId: transfer.target,
        terminated: true,
      }
    // Any other jump, into a stop or not, is a step of the statement's own flow, as a fallthrough
    // is: the walk continues at its target, and emitting each block once keeps anything shared out.
    return { statements: [], nextBlockId: target, terminated: false }
  }

  renderReturnOrThrow(block, instruction, context) {
    const outgoing = this.state.outgoing(block)
    const edge = outgoing.find(
      ({ kind }) => kind === 'return' || kind === 'throw',
    )
    const handledThrow =
      instruction.operation.kind === 'throw' &&
      outgoing.length === 1 &&
      this.tries.regionProtects(outgoing[0], context)
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
    const source = this.state.operand(
      instruction.pc,
      instruction.operation.source,
    )
    const statement =
      instruction.operation.kind === 'return'
        ? t.returnStatement(source)
        : t.throwStatement(source)
    return { statements: [statement], nextBlockId: null, terminated: true }
  }

  renderOrdinary(block, instruction, context) {
    const outgoing = this.state.outgoing(block)
    const continuing = outgoing.filter(({ kind }) => CONTINUING_EDGES.has(kind))
    const exceptional = outgoing.filter(({ kind }) =>
      ['throw', 'handler', 'finally'].includes(kind),
    )
    if (
      continuing.length !== 1 ||
      continuing[0].targetPc === null ||
      exceptional.some(
        (edge) =>
          !(
            (edge.kind === 'throw' && edge.targetPc === null) ||
            this.tries.regionProtects(edge, context)
          ),
      )
    )
      decline(
        'unemittable-structured-control',
        `${instruction.operation.kind} at ${instruction.pc} has an unstructured successor`,
      )
    // A setup its loop's `for (key in object)` holds is written there.
    const statements = []
    if (!this.state.forInSetups.has(block.id))
      this.state.renderInstruction(instruction, statements)
    return {
      statements,
      nextBlockId: this.state.targetBlock(continuing[0]),
      terminated: false,
    }
  }

  emit(startPc) {
    const { state } = this
    const entry = `${state.functionId}:b@${startPc}`
    const result = this.sequence(entry, new Set(), { loops: [] })
    if (!result.terminated || result.nextBlockId !== null)
      decline(
        'unemittable-structured-control',
        `Structured function ${state.functionId} has no complete natural exit`,
      )
    state.requireReachableCoverage()
    return result.statements
  }
}

export function emitStructuredFunction(
  frame,
  instructions,
  functionRecord,
  regions,
  solved,
) {
  const { functionId } = frame
  const effective = effectiveStructuredInstructions(
    functionId,
    instructions,
    solved,
    regions,
  )
  // Frame setup follows the emitted code: unreachable cases are dropped, so their registers and
  // argument reads are not set up either.
  const reachablePcs = new Set(solved.reachablePcs)
  const reachable = (list) => list.filter(({ pc }) => reachablePcs.has(pc))
  const emittedInstructions = reachable(effective.instructions)
  const emitter = new StructuredFunctionEmitter(
    new EmitState(frame, instructions, regions, effective, solved),
  )
  // A `for (key in object)` reads the setup's object and writes the step's key; its iterator is
  // not written.
  const heads = [...emitter.state.forInHeads.values()]
  const headPcs = new Set(
    heads.flatMap(({ setupPc, stepPc }) => [setupPc, stepPc]),
  )
  const registers = functionRegisterSet([
    ...emittedInstructions.filter(({ pc }) => !headPcs.has(pc)),
    ...emittedInstructions
      .filter(({ pc }) => heads.some(({ setupPc }) => setupPc === pc))
      .map((setup) => ({
        ...setup,
        operation: { ...setup.operation, destination: null },
      })),
  ])
  for (const { keyRegister } of heads) registers.add(keyRegister)
  const head = functionHead(
    frame,
    functionRecord,
    emittedInstructions,
    registers,
    solved.reachingDefinitions,
  )
  return {
    node: functionNode(frame, head, emitter.emit(functionRecord.startPc)),
    copyProofs: effective.copyProofs,
    deadProofs: effective.deadProofs,
    unreachableCount: instructions.length - reachable(instructions).length,
    // A setup no `for (key in object)` holds enumerates through the helper.
    enumerationHelper: emittedInstructions.some(
      ({ pc, operation }) =>
        operation.kind === 'for-in-setup' &&
        !headPcs.has(pc) &&
        !effective.removedPcs.has(pc),
    ),
  }
}
