import * as t from '@babel/types'
import { decline } from '../model/model.js'
import { runExpression } from './run-walk.js'

/**
 * Switches in structured emission over one function's emission state (`state`). A switch selects
 * its clause natively: the head's leading operations run before it, each later case's run becomes
 * its label, `(run…, value)`, which native evaluation runs in the chain's order until one matches,
 * and the default is taken when none does. Each clause body is walked, by yielding the walk
 * (`{ start, stops, context }`) and receiving its result, to the next clause's entry (a
 * fallthrough), the end (a break) or a transfer; a body ending anywhere else declines.
 */
export class SwitchRegions {
  constructor(state) {
    this.state = state
  }

  *render(region, context) {
    const { state } = this
    const head = state.nodeById.get(region.testBlockId)
    state.markBlock(head)
    const owner = `Switch ${region.testBlockId}`
    const labels = this.caseLabels(region, owner)
    for (const id of [
      ...region.cases.flatMap(({ stepBlockIds }) => stepBlockIds),
      ...region.defaultStepBlockIds,
    ])
      state.markBlock(state.nodeById.get(id))
    const end = region.continuationBlockId
    const label = `__recovered_switch_${state.functionId}_${state.switchNumber++}`
    const active = {
      kind: 'switch',
      headerBlockId: null,
      continueBlockId: null,
      exitTargets: new Set(end === null ? [] : [end]),
      label,
    }
    const cases = yield* this.clauses(region, active, context, labels, owner)
    const statements = [
      state.labeled(
        active,
        t.switchStatement(
          state.operand(head.startPc, region.discriminant),
          cases,
        ),
      ),
    ]
    return end === null
      ? { statements, nextBlockId: null, terminated: true }
      : { statements, nextBlockId: end, terminated: false }
  }

  // Each case's label: the head's value, every later case's run before its value.
  caseLabels(region, owner) {
    const { state } = this
    return region.cases.map((item, index) => {
      const value = state.operand(
        state.nodeById.get(item.testBlockId).startPc,
        item.value,
      )
      if (index === 0) return value
      const test = state.nodeById.get(item.testBlockId)
      const instructions = []
      for (const id of item.runBlockIds) {
        const node = state.nodeById.get(id)
        state.markBlock(node)
        if (!state.isJumpStep(node)) instructions.push(node.instruction)
      }
      state.markBlock(test)
      return runExpression([
        ...state.runExpressions(owner, instructions),
        value,
      ])
    })
  }

  *clauses(region, active, context, labels, owner) {
    const end = region.continuationBlockId
    const entries = new Set(
      region.clauses.map(({ entryBlockId }) => entryBlockId),
    )
    const cases = []
    for (const [index, clause] of region.clauses.entries()) {
      const consequent = []
      cases.push(
        t.switchCase(
          clause.caseIndex === null ? null : labels[clause.caseIndex],
          consequent,
        ),
      )
      const following = region.clauses[index + 1]?.entryBlockId ?? null
      // Grouped labels share the next clause's body.
      if (following === clause.entryBlockId) continue
      const walk =
        clause.entryBlockId === end
          ? { statements: [], nextBlockId: end, terminated: false }
          : yield {
              start: clause.entryBlockId,
              stops: new Set(
                [...entries, end].filter(
                  (id) => id !== null && id !== clause.entryBlockId,
                ),
              ),
              context: {
                ...context,
                loops: [...context.loops, active],
                enclosing: [...(context.enclosing ?? context.loops), active],
              },
            }
      consequent.push(...walk.statements)
      if (walk.terminated) continue
      if (walk.nextBlockId === end && end !== null) {
        if (following !== null) consequent.push(t.breakStatement())
        continue
      }
      if (walk.nextBlockId !== following)
        decline(
          'unemittable-structured-control',
          `${owner} clause at ${clause.entryBlockId} does not reach the next clause or the end`,
        )
    }
    return cases
  }
}
