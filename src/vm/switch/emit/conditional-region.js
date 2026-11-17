import * as t from '@babel/types'
import { decline, requireValue } from '../model/model.js'
import { registerName } from '../model/operations.js'
import { valueExpression } from './render.js'
import { runExpression, walkRun } from './run-walk.js'

/**
 * Conditionals in structured emission over one function's emission state (`state`). `render` writes
 * a conditional region as an `if`, walking each arm by yielding the walk it needs
 * (`{ start, stops, context }`) and receiving its result. `writeValues` writes each conditional
 * value's expression into the frame before the function is walked.
 */
export class ConditionalRegions {
  constructor(state) {
    this.state = state
  }

  *render(region, context, stopIds) {
    const test = this.checkedTest(region)
    const merge = this.conditionalMerge(region, context)
    const branch = yield {
      start: this.armStart(region.branchTargetPc, merge, context),
      stops: new Set([...stopIds, merge]),
      context,
    }
    const fallthrough = yield {
      start: this.armStart(region.fallthroughTargetPc, merge, context),
      stops: new Set([...stopIds, merge]),
      context,
    }
    const open = [branch, fallthrough].filter((path) => !path.terminated)
    const nextIds = new Set(open.map(({ nextBlockId }) => nextBlockId))
    const closes =
      open.length > 0 || this.isStructuredStop(merge, stopIds, context)
    if (!this.reconverges(merge, stopIds, nextIds, closes))
      decline(
        'unemittable-structured-control',
        `Conditional region ${region.testBlockId} does not reconverge at ${merge}`,
      )
    const statements = this.writeIf(test.instruction, branch, fallthrough)
    if (!open.length)
      return { statements, nextBlockId: merge, terminated: true }
    return { statements, nextBlockId: [...nextIds][0], terminated: false }
  }

  // The region's test block, marked; a conditional's test ends in a branch.
  checkedTest(region) {
    const test = this.state.nodeById.get(region.testBlockId)
    requireValue(
      test,
      'invalid-structured-control',
      `Conditional region refers to missing test block ${region.testBlockId}`,
    )
    this.state.markBlock(test)
    if (test.instruction.operation.kind !== 'branch')
      decline(
        'unemittable-structured-control',
        `Conditional region ${region.testBlockId} has a non-conditional leaf`,
      )
    return test
  }

  // Every exit tail of a finally region jumps to its finalizer entry, so the planner places the merge
  // of a conditional whose arms leave the region there; for the region rule those arms meet at the
  // statement's normal completion instead, and when the region has none they do not meet.
  conditionalMerge(region, context) {
    const finallyRegion = context.regions?.find(
      (item) => item.kind === 'finally' && item.entryId === region.mergeBlockId,
    )
    return !finallyRegion ? region.mergeBlockId : finallyRegion.normalEnd
  }

  // An arm whose jump steps lead straight to the merge starts there, as the planner closes it: the
  // steps run nothing, and are marked. A back edge is a continue, never such a step.
  armStart(pc, merge, context) {
    const { state } = this
    const start = state.nodeForPc(pc).id
    const steps = []
    let id = start
    while (state.isJumpStep(state.nodeById.get(id)) && !steps.includes(id)) {
      const next = state.outgoing(state.nodeById.get(id))
      if (next.length !== 1 || next[0].targetPc === null) break
      if (
        state.loopTransfer(context, state.targetBlock(next[0]))?.kind ===
        'continue'
      )
        break
      steps.push(id)
      id = state.targetBlock(next[0])
    }
    if (id !== merge) return start
    for (const step of steps) state.markBlock(state.nodeById.get(step))
    return id
  }

  isStructuredStop(merge, stopIds, context) {
    return (
      merge === null ||
      stopIds.has(merge) ||
      context.loops.some(
        (loop) => loop.headerBlockId === merge || loop.exitTargets.has(merge),
      )
    )
  }

  // The arms that go on meet at the merge, or one goes on into a stop; arms that all end close only
  // at a stop the walk holds (`closes`).
  reconverges(merge, stopIds, nextIds, closes) {
    return !(
      (nextIds.size > 1 &&
        ![...nextIds].every((nextBlockId) => nextBlockId === merge)) ||
      (nextIds.size === 1 &&
        ![...nextIds].every(
          (nextBlockId) => nextBlockId === merge || stopIds.has(nextBlockId),
        )) ||
      !closes
    )
  }

  writeIf(leaf, branch, fallthrough) {
    const { state } = this
    const block = (arm) => t.blockStatement(arm.statements)
    if (branch.statements.length === 0 && fallthrough.statements.length === 0)
      // Both paths only reconverge; a folded condition still evaluates.
      return state.folded(leaf.pc, leaf.operation.condition)
        ? [
            t.expressionStatement(
              state.operand(leaf.pc, leaf.operation.condition),
            ),
          ]
        : []
    if (branch.statements.length === 0)
      return [t.ifStatement(state.inversePredicateOf(leaf), block(fallthrough))]
    if (fallthrough.statements.length === 0)
      return [t.ifStatement(state.predicateOf(leaf), block(branch))]
    // Arm order is spelling: the arm the positive test selects is written first, so a
    // jump-if-false reads `if (c) { fallthrough } else { branch }`.
    const negated = leaf.operation.when === 'false'
    const [first, second] = negated
      ? [fallthrough, branch]
      : [branch, fallthrough]
    return [
      t.ifStatement(
        negated ? state.inversePredicateOf(leaf) : state.predicateOf(leaf),
        block(first),
        block(second),
      ),
    ]
  }

  // Each absorbed conditional value's expression by its test PC, every value its expression reads
  // written before it: a value whose use is one of the cases the expression renders (`rendersCases`).
  writeValues() {
    const { conditionalValues } = this.state.frame
    const values = [...this.state.effective.absorbed]
    const visiting = new Set()
    const write = (testPc, value) => {
      if (conditionalValues.has(testPc) || visiting.has(testPc)) return
      visiting.add(testPc)
      const rendered = this.rendersCases(value)
      for (const [innerPc, inner] of values)
        if (innerPc !== testPc && rendered.has(inner.usePc))
          write(innerPc, inner)
      conditionalValues.set(testPc, this.conditionalValue(testPc))
    }
    for (const [testPc, value] of values) write(testPc, value)
  }

  // The cases a conditional value's expression renders: its own, a logical value's left producer, and
  // every producer folded into those.
  rendersCases(value) {
    const cases = new Set()
    const work = [
      ...value.pcs,
      ...(value.logical ? [value.logical.leftPc] : []),
    ]
    while (work.length) {
      const pc = work.pop()
      if (cases.has(pc)) continue
      cases.add(pc)
      const folds = this.state.effective.effectiveAt(pc)?.foldedReads
      for (const producer of folds?.values() ?? []) work.push(producer.pc)
    }
    return cases
  }

  // A conditional value as one expression, `test ? X : Y`: each arm's run as the run walk writes
  // it, its last part the write of the value, read as the arm's value.
  conditionalValue(testPc) {
    const { state } = this
    const value = state.effective.absorbed.get(testPc)
    const test = state.nodeForPc(testPc)
    const region = state.conditionalByTest.get(test.id)
    const ids = [...value.pcs].map((pc) => state.nodeForPc(pc).id)
    const register = registerName(state.functionId, value.register)
    const writesValue = (part) =>
      part?.type === 'AssignmentExpression' &&
      part.operator === '=' &&
      part.left.type === 'Identifier' &&
      part.left.name === register
    const arm = (pc) => {
      const walk = walkRun(
        state,
        ids,
        state.nodeForPc(pc).id,
        region.mergeBlockId,
      )
      const last = walk.parts?.at(-1)
      if (walk.failure || !writesValue(last))
        decline(
          'unemittable-structured-control',
          `Conditional value at ${testPc} has an arm that is not one expression`,
        )
      return runExpression([...walk.parts.slice(0, -1), last.right])
    }
    // A logical value: its left producer's value, the operator, its one arm; the test is the
    // operator's own.
    if (value.logical)
      return t.logicalExpression(
        value.logical.operator,
        valueExpression(
          state.frame,
          state.effective.effectiveAt(value.logical.leftPc),
        ),
        arm(value.logical.armPc),
      )
    const arms = [region.branchTargetPc, region.fallthroughTargetPc].map(arm)
    // The arm the positive test selects is written first, as `writeIf` writes it.
    return test.instruction.operation.when === 'false'
      ? t.conditionalExpression(
          state.inversePredicateOf(test.instruction),
          arms[1],
          arms[0],
        )
      : t.conditionalExpression(
          state.predicateOf(test.instruction),
          arms[0],
          arms[1],
        )
  }
}
