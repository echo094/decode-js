import * as t from '@babel/types'
import { UNCONDITIONAL_EDGES } from '../model/control.js'
import { literalNode } from '../model/operations.js'

// One expression for a run's parts: the part alone, or their comma sequence.
export function runExpression(parts) {
  return parts.length > 1 ? t.sequenceExpression(parts) : parts[0]
}

/**
 * The blocks of a run (`runIds`) from a start to a stop as comma-expression parts, over one
 * function's emission state: a planned conditional as `test ? (…) : (…)`, a conditional value
 * skipped to its merge (it is written in its use). The walk fails when the run leaves `runIds`, has
 * no single next step or holds a statement. Nothing is marked.
 */
class RunWalk {
  constructor(state, runIds) {
    this.state = state
    this.ids = new Set(runIds)
    this.blocks = []
  }

  walk(from, until) {
    const parts = []
    let current = from
    while (current !== until) {
      if (!this.ids.has(current) || this.blocks.includes(current))
        return { failure: `continue run leaves its run at ${current}` }
      const block = this.state.nodeById.get(current)
      this.blocks.push(current)
      const step = this.step(block)
      if (step.failure) return step
      parts.push(...step.parts)
      current = step.next
    }
    return { parts }
  }

  // One block's parts and the block after it.
  step(block) {
    const value = this.state.absorbedByEntry.get(block.startPc)
    if (value) return this.valueStep(value)
    const conditional = this.state.conditionalByTest.get(block.id)
    if (conditional) return this.conditionalStep(block, conditional)
    return this.caseStep(block)
  }

  // A conditional value is written in its use, which comes after its merge.
  valueStep(value) {
    for (const pc of value.pcs) {
      const id = this.state.nodeForPc(pc).id
      if (!this.blocks.includes(id)) this.blocks.push(id)
    }
    return { parts: [], next: this.state.nodeForPc(value.mergePc).id }
  }

  conditionalStep(block, conditional) {
    const predicate = this.state.predicateOf(block.instruction)
    const arms = []
    for (const pc of [
      conditional.branchTargetPc,
      conditional.fallthroughTargetPc,
    ]) {
      const arm = this.walk(
        this.state.nodeForPc(pc).id,
        conditional.mergeBlockId,
      )
      if (arm.failure) return arm
      arms.push(
        arm.parts.length ? runExpression(arm.parts) : literalNode(undefined),
      )
    }
    return {
      parts: [t.conditionalExpression(predicate, arms[0], arms[1])],
      next: conditional.mergeBlockId,
    }
  }

  caseStep(block) {
    const next = this.state
      .outgoing(block)
      .filter(
        ({ kind, targetPc }) =>
          targetPc !== null && UNCONDITIONAL_EDGES.has(kind),
      )
    if (next.length !== 1)
      return { failure: `continue run has no single next step at ${block.id}` }
    const parts = []
    if (!this.state.isJumpStep(block)) {
      const expressions = this.state.expressionsOf([block.instruction])
      if (!expressions)
        return { failure: 'continue run clause is not an expression' }
      parts.push(...expressions)
    }
    return { parts, next: this.state.targetBlock(next[0]) }
  }
}

// The run's parts and the blocks it passed, `{ parts, blocks }`, or `{ failure }`.
export function walkRun(state, runIds, start, stop) {
  const run = new RunWalk(state, runIds)
  const result = run.walk(start, stop)
  return result.failure ? result : { parts: result.parts, blocks: run.blocks }
}
