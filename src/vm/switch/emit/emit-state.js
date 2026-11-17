import * as t from '@babel/types'
import { emitInstruction, valueExpression } from './render.js'
import { literalNode, registerName } from '../model/operations.js'
import { decline, isJumpStep, requireValue } from '../model/model.js'

// Each region of a kind by the block that heads it.
function regionsBy(regions, kind, key, value = (region) => region) {
  return new Map(
    regions
      .filter((region) => region.kind === kind)
      .map((region) => [region[key], value(region)]),
  )
}

/**
 * One structured function's emission state, shared by the walk and every region renderer: its cases
 * as nodes, the solver's edges, the planned regions by head, the value planner's result, the blocks
 * emitted so far and the label counters, with the questions every renderer asks of them (node and
 * edge lookup, operands, marking, transfers and labels). It calls no renderer.
 */
export class EmitState {
  constructor(frame, instructions, regions, effective, solved) {
    const { functionId } = frame
    // A conditional value is written where it is read, from its arms; the expressions are written
    // before the walk and the renderer reads them from the frame.
    this.frame = { ...frame, conditionalValues: new Map() }
    this.functionId = functionId
    this.instructions = instructions
    // A node is one case, named as the planner names it; its successors are the control
    // solver's edges from its PC.
    this.nodeById = new Map(
      instructions.map((instruction) => {
        const id = `${functionId}:b@${instruction.pc}`
        return [id, { id, startPc: instruction.pc, instruction }]
      }),
    )
    this.effective = effective
    // An absorbed conditional value by the case a walk meets first: its test, or a logical
    // value's left producer.
    this.absorbedByEntry = new Map(
      [...effective.absorbed.values()].map((value) => [value.entryPc, value]),
    )
    this.reachablePcs = new Set(solved.reachablePcs)
    this.stateIn = solved.stateIn
    this.solvedEdgesBySource = Map.groupBy(
      solved.edges,
      (edge) => edge.sourcePc,
    )
    this.solvedEdgesByTarget = Map.groupBy(
      solved.edges.filter(({ targetPc }) => targetPc !== null),
      (edge) => edge.targetPc,
    )
    this.reachingDefinitions = solved.reachingDefinitions
    this.conditionalByTest = regionsBy(regions, 'conditional', 'testBlockId')
    this.tryBySetup = regionsBy(regions, 'try', 'setupBlockId')
    this.loopByHeader = regionsBy(regions, 'natural-loop', 'headerBlockId')
    this.loopRegions = regions.filter(({ kind }) => kind === 'natural-loop')
    this.switchByHead = regionsBy(regions, 'switch', 'testBlockId')
    this.labeledByHead = regionsBy(
      regions,
      'labeled-block',
      'headBlockId',
      (region) => region.endBlockIds,
    )
    // The for-in heads the loop renderer plans (`forInHeads`, by header; `forInSetups`, by setup).
    this.forInHeads = new Map()
    this.forInSetups = new Map()
    this.emittedBlocks = new Set()
    this.loopNumber = 0
    this.switchNumber = 0
    this.blockNumber = 0
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

  // A jump step renders nothing, so two routes may share one; what it leads to is marked itself.
  markBlock(block) {
    if (this.emittedBlocks.has(block.id) && !this.isJumpStep(block))
      decline(
        'unemittable-structured-control',
        `Structured block ${block.id} would be emitted more than once`,
      )
    this.emittedBlocks.add(block.id)
  }

  // context.loops holds every breakable statement; a switch or a labeled block is one, but never
  // a loop.
  activeLoop(context) {
    return (
      context.loops.findLast(
        ({ kind }) => kind !== 'switch' && kind !== 'block',
      ) ?? null
    )
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

  // A `break` or `continue` to `target`. One that reaches its target unlabeled (a `continue` to the
  // innermost loop, a `break` to the innermost loop or switch) names nothing; any other names
  // `target`, counted so a loop or switch writes its label only when some transfer names it.
  // Innermost is where the statement stands: `context.enclosing`, the breakable statements written
  // around it, which an exit tail walked in its region's outer context still sits inside.
  transferTo(kind, target, context) {
    const enclosing = context.enclosing ?? context.loops
    const innermost = enclosing.findLast(({ kind: statement }) =>
      kind === 'continue'
        ? statement !== 'switch' && statement !== 'block'
        : statement !== 'block',
    )
    const transfer =
      kind === 'continue' ? t.continueStatement : t.breakStatement
    if (innermost === target) return transfer()
    target.references = (target.references ?? 0) + 1
    return transfer(t.identifier(target.label))
  }

  // The body's last `continue`, to its own loop, the innermost there, is the back edge the native
  // loop takes.
  withoutBackEdge(statements) {
    const last = statements.at(-1)
    return last?.type === 'ContinueStatement' && !last.label
      ? statements.slice(0, -1)
      : statements
  }

  // A loop or switch statement, under its label only when a transfer names it.
  labeled(active, statement) {
    return active.references
      ? t.labeledStatement(t.identifier(active.label), statement)
      : statement
  }

  edgeTo(block, kind) {
    return this.outgoing(block).find(({ kind: edgeKind }) => edgeKind === kind)
  }

  // A register read at `pc`: the literal every definition reaching it holds, the expression of
  // the producer folded into it, or the register.
  operand(pc, register) {
    const literal = this.effective.literals.at(pc, register)
    if (literal) return literalNode(literal.value)
    const producer = this.effective.foldAt(pc, register)
    if (producer) return valueExpression(this.frame, producer)
    return t.identifier(registerName(this.functionId, register))
  }

  // Whether the read at `pc` is a folded producer's expression.
  folded(pc, register) {
    return this.effective.foldAt(pc, register) !== null
  }

  // A removed case renders nothing, and a folded producer renders inside its use.
  renderInstruction(instruction, statements) {
    if (this.effective.removedPcs.has(instruction.pc)) return
    instruction = this.effective.effectiveAt(instruction.pc)
    if (instruction.folded) return
    statements.push(...emitInstruction(this.frame, instruction, 'structured'))
  }

  // Rendered instructions as expressions; a statement cannot stand in a loop clause or a case
  // label. `owner` names the statement for the refusal.
  runExpressions(owner, instructions) {
    const parts = this.expressionsOf(instructions)
    if (!parts)
      decline(
        'unemittable-structured-control',
        `${owner} clause is not an expression`,
      )
    return parts
  }

  // The rendered instructions as expressions, or null when one renders as another statement.
  expressionsOf(instructions) {
    const statements = []
    for (const instruction of instructions)
      this.renderInstruction(instruction, statements)
    if (statements.some(({ type }) => type !== 'ExpressionStatement'))
      return null
    return statements.map(({ expression }) => expression)
  }

  // The walk emits every reachable case; a reachable case it left out declines. Unreachable cases
  // are dropped: no path runs them, so they are not part of the recovered program.
  requireReachableCoverage() {
    for (const { pc } of this.instructions) {
      const id = `${this.functionId}:b@${pc}`
      if (this.reachablePcs.has(pc) && !this.emittedBlocks.has(id))
        decline(
          'unemittable-structured-control',
          `Reachable structured block ${id} was not covered by qualified regions`,
        )
    }
  }

  // A branch's test as written: its condition, negated for a jump-if-false.
  predicateOf(leaf) {
    const condition = this.operand(leaf.pc, leaf.operation.condition)
    return leaf.operation.when === 'false'
      ? t.unaryExpression('!', condition)
      : condition
  }

  // The test under which a branch falls through: its condition, negated for a jump-if-true.
  inversePredicateOf(leaf) {
    const condition = this.operand(leaf.pc, leaf.operation.condition)
    return leaf.operation.when === 'false'
      ? condition
      : t.unaryExpression('!', condition)
  }
}
