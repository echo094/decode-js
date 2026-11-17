import * as t from '@babel/types'
import { decline } from '../model/model.js'
import { operationReads, registerName } from '../model/operations.js'
import { runExpression, walkRun } from './run-walk.js'

// A for-in iterator's field, `iterator.keys` or `iterator.index`.
const iteratorField = (iterator, field) =>
  t.memberExpression(t.identifier(iterator), t.identifier(field))

// `key = iterator.keys[iterator.index++];`, the step's read of the next key.
const nextKey = (key, iterator) =>
  t.expressionStatement(
    t.assignmentExpression(
      '=',
      t.identifier(key),
      t.memberExpression(
        iteratorField(iterator, 'keys'),
        t.updateExpression('++', iteratorField(iterator, 'index')),
        true,
      ),
    ),
  )

// `iterator.index` against `iterator.keys.length`.
const keysLeft = (iterator, operator) =>
  t.binaryExpression(
    operator,
    iteratorField(iterator, 'index'),
    t.memberExpression(iteratorField(iterator, 'keys'), t.identifier('length')),
  )

/**
 * Loop regions in structured emission over one function's emission state (`state`): a loop's head
 * test, its update and its for-in step, and the loop statement they form. `emitLoop` walks the
 * loop's body by yielding each walk it needs (`{ start, stops, context }`) and receiving its result.
 */
export class LoopRegions {
  constructor(state) {
    this.state = state
  }

  renderForInNext(block, context) {
    const loop = this.state.activeLoop(context)
    if (!loop)
      decline(
        'unemittable-structured-control',
        `FOR_IN_NEXT at ${block.startPc} is not inside a proved natural loop`,
      )
    const { instruction } = block
    const outgoing = this.state.outgoing(block)
    const branch = outgoing.find((edge) => edge.kind === 'branch')
    const fallthrough = outgoing.find((edge) => edge.kind === 'fallthrough')
    if (!branch || !fallthrough || branch.targetPc === null)
      decline(
        'unemittable-structured-control',
        `FOR_IN_NEXT at ${instruction.pc} has no natural loop exit`,
      )
    const exit = this.state.targetBlock(branch)
    if (!loop.exitTargets.has(exit))
      decline(
        'unemittable-structured-control',
        `FOR_IN_NEXT at ${instruction.pc} exits outside the proved loop`,
      )
    const iterator = registerName(
      this.state.functionId,
      instruction.operation.iterator,
    )
    // The key register copy simplification may have retargeted.
    const destination = registerName(
      this.state.functionId,
      this.state.effective.effectiveAt(instruction.pc).operation.destination,
    )
    const statements = [
      t.ifStatement(
        keysLeft(iterator, '>='),
        this.state.transferTo('break', loop, context),
      ),
      nextKey(destination, iterator),
    ]
    return {
      statements,
      nextBlockId: this.state.targetBlock(fallthrough),
      terminated: false,
    }
  }

  // A loop ends where its planned statement region continues; every other exit of the region is a
  // transfer (break, continue, return or throw) its own block renders. The loop is written by its
  // test: a bottom exit test, a head exit test, or none (its body walked whole).
  *emitLoop(region, context) {
    const loop = this.openLoop(region, context)
    const headTest = region.testBlockIds
      ? null
      : this.loopHeadTest(region, loop.end)
    if (headTest?.bottom)
      return yield* this.emitBottomTested(region, loop, headTest)
    if (headTest) return yield* this.emitHeadTested(region, loop, headTest)
    return yield* this.emitBodyLoop(region, loop)
  }

  // The loop's statement: its one exit target (`end`), its label, the loop record (`active`) and
  // the context its body is walked in (`inner`).
  openLoop(region, context) {
    if (region.continuationBlockId === null)
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} has no continuation`,
      )
    const parentLoops = context.loops
    const exitTargets = new Set(
      [region.continuationBlockId].filter(
        (target) =>
          !parentLoops.some(
            (loop) => loop.kind !== 'block' && loop.exitTargets.has(target),
          ),
      ),
    )
    if (exitTargets.size !== 1)
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} continues at an enclosing loop's exit`,
      )
    const label = `__recovered_loop_${this.state.functionId}_${this.state.loopNumber++}`
    const active = {
      headerBlockId: region.headerBlockId,
      continueBlockId: region.continueBlockId ?? null,
      exitTargets,
      label,
    }
    const inner = {
      ...context,
      loops: [...context.loops, active],
      enclosing: [...(context.enclosing ?? context.loops), active],
    }
    const [end] = exitTargets
    return { active, inner, exitTargets, end }
  }

  // A do-while: the body runs to its test, whose back arm is the loop's own flow.
  *emitBottomTested(region, { active, inner, exitTargets, end }, headTest) {
    const body = yield {
      start: region.headerBlockId,
      stops: new Set([...exitTargets, headTest.testId]),
      context: inner,
    }
    if (!body.terminated && body.nextBlockId === headTest.testId) {
      this.markHeadTest(headTest)
      return {
        statements: [
          this.state.labeled(
            active,
            t.doWhileStatement(
              headTest.condition,
              t.blockStatement(body.statements),
            ),
          ),
        ],
        nextBlockId: end,
        terminated: false,
      }
    }
    // Otherwise the test is written where the body reaches it, as any conditional.
    const rest = body.terminated
      ? body
      : yield { start: body.nextBlockId, stops: exitTargets, context: inner }
    return this.whileTrue(active, inner, region, {
      ...rest,
      statements: [...body.statements, ...rest.statements],
    })
  }

  // A test in the header's run leads the loop: `while (run…, test)`, or `for (; …; update)` when a
  // continue enters an update; its exit arm runs nothing, and the body's last `continue` is the
  // back edge the native loop takes. A for-in step's key read opens the body, unless the loop is
  // the source's `for (key in object)`.
  *emitHeadTested(region, { active, inner, exitTargets, end }, headTest) {
    const forIn = this.state.forInHeads.get(region.headerBlockId)
    this.markHeadTest(headTest)
    const body = yield {
      start: headTest.bodyId,
      stops: exitTargets,
      context: inner,
    }
    if (!body.terminated && !exitTargets.has(body.nextBlockId))
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} did not reach its proved exit`,
      )
    const statements = [
      ...(forIn ? [] : (headTest.bodyStatements ?? [])),
      ...this.state.withoutBackEdge(body.statements),
    ]
    if (!body.terminated)
      statements.push(this.state.transferTo('break', active, inner))
    const loop = this.headLoop(
      region,
      forIn,
      headTest,
      t.blockStatement(statements),
    )
    return {
      statements: [this.state.labeled(active, loop)],
      nextBlockId: end,
      terminated: false,
    }
  }

  // The statement a head test leads: the source's `for (key in object)`, a `while`, or a `for` whose
  // update a continue enters.
  headLoop(region, forIn, headTest, block) {
    if (forIn)
      return t.forInStatement(
        t.identifier(forIn.key),
        t.cloneNode(forIn.object),
        block,
      )
    if (region.continueBlockId == null)
      return t.whileStatement(headTest.condition, block)
    return t.forStatement(
      null,
      headTest.condition,
      this.renderUpdate(region),
      block,
    )
  }

  // A loop with no leading test: its body walked from the header to the exit, then a do-while over
  // the planned test, or `while (true)`.
  *emitBodyLoop(region, { active, inner, exitTargets, end }) {
    const body = yield {
      start: region.headerBlockId,
      stops: exitTargets,
      context: inner,
    }
    if (!body.terminated && !exitTargets.has(body.nextBlockId))
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} did not reach its proved exit`,
      )
    if (!region.testBlockIds) return this.whileTrue(active, inner, region, body)
    // The body's own end reaches the test as do-while's native flow does.
    const statements = this.state.withoutBackEdge(body.statements)
    if (!body.terminated)
      statements.push(this.state.transferTo('break', active, inner))
    const loop = t.doWhileStatement(
      this.renderTest(region),
      t.blockStatement(statements),
    )
    return {
      statements: [this.state.labeled(active, loop)],
      nextBlockId: end,
      terminated: false,
    }
  }

  // A loop whose test stays in its body: `while (true)`, or `for (; ; update)` with a continue
  // target, its body ending in `break` where it runs out.
  whileTrue(active, inner, region, body) {
    const statements = [...body.statements]
    if (!body.terminated)
      statements.push(this.state.transferTo('break', active, inner))
    const block = t.blockStatement(statements)
    const loop =
      region.continueBlockId == null
        ? t.whileStatement(t.booleanLiteral(true), block)
        : t.forStatement(null, null, this.renderUpdate(region), block)
    const end = region.continuationBlockId
    return {
      statements: [this.state.labeled(active, loop)],
      nextBlockId: end,
      terminated: false,
    }
  }

  // The loop's planned exit test, when it can lead the loop: its conditional closes at the loop's
  // end (a for-in step has none; its branch is its exit), one arm leads there through jump steps
  // alone (it runs nothing), and, for a test in the header's run, that run is one comma
  // expression; for a bottom test the other arm is the back edge.
  // `{ testId, bottom, condition, bodyId, bodyStatements, blocks }`, nothing marked; null otherwise.
  loopHeadTest(region, end) {
    const testId = region.exitTestBlockId
    if (!testId) return null
    const { instruction } = this.state.nodeById.get(testId)
    const targets = this.exitTestTargets(testId, instruction, end)
    if (!targets) return null
    const [branch, fallthrough] = targets.map((pc) =>
      this.jumpStepsFrom(pc, end, region.headerBlockId),
    )
    const exitOnBranch = branch.id === end
    if (exitOnBranch === (fallthrough.id === end)) return null
    const [exit, stay] = exitOnBranch
      ? [branch, fallthrough]
      : [fallthrough, branch]
    const staying = this.stayingTest(instruction, exitOnBranch, region)
    if (!staying) return null
    if (region.exitTestAtBottom) {
      if (stay.id !== region.headerBlockId) return null
      return {
        testId,
        bottom: true,
        condition: staying.condition,
        blocks: [testId, ...exit.steps, ...stay.steps],
      }
    }
    const run =
      testId === region.headerBlockId
        ? { parts: [], blocks: [] }
        : walkRun(
            this.state,
            region.exitTestRunBlockIds ?? [],
            region.headerBlockId,
            testId,
          )
    if (run.failure) return null
    return {
      testId,
      bottom: false,
      condition: runExpression([...run.parts, staying.condition]),
      bodyId: stay.start,
      bodyStatements: staying.bodyStatements,
      blocks: [...run.blocks, testId, ...exit.steps],
    }
  }

  // The exit test's arm targets, `[branchPc, fallthroughPc]`: a for-in step's two edges, or the
  // arms of a conditional that closes at the loop's end; null otherwise.
  exitTestTargets(testId, instruction, end) {
    if (instruction.operation.kind === 'for-in-next') {
      const node = this.state.nodeById.get(testId)
      const branchEdge = this.state.edgeTo(node, 'branch')
      const fallthroughEdge = this.state.edgeTo(node, 'fallthrough')
      if (
        !branchEdge ||
        !fallthroughEdge ||
        branchEdge.targetPc === null ||
        fallthroughEdge.targetPc === null
      )
        return null
      return [branchEdge.targetPc, fallthroughEdge.targetPc]
    }
    const conditional = this.state.conditionalByTest.get(testId)
    if (!conditional || conditional.mergeBlockId !== end) return null
    return [conditional.branchTargetPc, conditional.fallthroughTargetPc]
  }

  // An arm from `pc` through jump steps, up to the loop's end or header: `{ start, id, steps }`,
  // `id` the block it reaches.
  jumpStepsFrom(pc, end, headerId) {
    const steps = []
    let id = this.state.nodeForPc(pc).id
    while (
      this.state.isJumpStep(this.state.nodeById.get(id)) &&
      id !== end &&
      id !== headerId &&
      !steps.includes(id)
    ) {
      const next = this.state.outgoing(this.state.nodeById.get(id))
      if (next.length !== 1 || next[0].targetPc === null) break
      steps.push(id)
      id = this.state.targetBlock(next[0])
    }
    return { start: this.state.nodeForPc(pc).id, id, steps }
  }

  // The condition under which the loop stays, and the statements that open its body, `{ condition,
  // bodyStatements }`; null for a for-in step that cannot lead the loop.
  stayingTest(instruction, exitOnBranch, region) {
    if (instruction.operation.kind !== 'for-in-next')
      // The branch target's arm runs when the predicate holds.
      return {
        condition: exitOnBranch
          ? this.state.inversePredicateOf(instruction)
          : this.state.predicateOf(instruction),
        bodyStatements: [],
      }
    // The step leaves by its branch once the keys run out and otherwise reads the next key. The
    // iterator is the setup's `{ keys, index }`, an array and an integer only steps advance, so
    // the negated `index >= keys.length` is `index < keys.length`.
    if (!exitOnBranch || region.exitTestAtBottom) return null
    const iterator = registerName(
      this.state.functionId,
      instruction.operation.iterator,
    )
    const destination = registerName(
      this.state.functionId,
      instruction.operation.destination,
    )
    return {
      condition: keysLeft(iterator, '<'),
      bodyStatements: [nextKey(destination, iterator)],
    }
  }

  // `headerBlockId -> { setupId, setupPc, stepPc, keyRegister, key, object }` for every loop that
  // is the source's `for (key in object)` (`forInHead`), nothing marked.
  planForInHeads(loops) {
    const heads = new Map()
    for (const region of loops) {
      const head = this.forInHead(region)
      if (head) heads.set(region.headerBlockId, head)
    }
    return heads
  }

  // A for-in loop that is the compiler's unit is the source's `for (key in object)`: its step is
  // the header and leads the loop with no run before it and no update, its one entry from outside
  // is its setup through jump steps at most, and the setup's iterator reaches that step alone. The
  // encoder writes the setup and the step only for a for-in statement, so native enumeration is
  // the source's own. Null otherwise.
  forInHead(region) {
    const step = this.state.nodeById.get(region.headerBlockId)?.instruction
    if (
      step?.operation.kind !== 'for-in-next' ||
      region.exitTestBlockId !== region.headerBlockId ||
      region.testBlockIds ||
      region.continueBlockId != null
    )
      return null
    const headTest = this.loopHeadTest(region, region.continuationBlockId)
    if (!headTest || headTest.bottom) return null
    const setup = this.forInSetup(step, new Set(region.bodyBlockIds))
    if (
      setup?.operation.kind !== 'for-in-setup' ||
      setup.operation.destination !== step.operation.iterator ||
      this.state.effective.removedPcs.has(setup.pc) ||
      !this.iteratorReachesStepAlone(setup, step)
    )
      return null
    // The key register copy simplification may have retargeted.
    const keyRegister = this.state.effective.effectiveAt(step.pc).operation
      .destination
    return {
      setupId: this.blockAt(setup.pc),
      setupPc: setup.pc,
      stepPc: step.pc,
      keyRegister,
      key: registerName(this.state.functionId, keyRegister),
      object: this.state.operand(setup.pc, setup.operation.source),
    }
  }

  blockAt(pc) {
    return `${this.state.functionId}:b@${pc}`
  }

  // The instruction that enters the step from outside the loop (`members`): its one entry, back
  // through jump steps, when it falls through into them; null otherwise.
  forInSetup(step, members) {
    let entering = (this.state.solvedEdgesByTarget.get(step.pc) ?? []).filter(
      ({ sourcePc }) => !members.has(this.blockAt(sourcePc)),
    )
    const seen = new Set()
    while (entering.length === 1 && !seen.has(entering[0].sourcePc)) {
      const source = this.state.nodeById.get(this.blockAt(entering[0].sourcePc))
      seen.add(source.startPc)
      if (!this.state.isJumpStep(source))
        return entering[0].kind === 'fallthrough' ? source.instruction : null
      entering = this.state.solvedEdgesByTarget.get(source.startPc) ?? []
    }
    return null
  }

  // The setup's iterator is the step's only definition, and no other read takes it.
  iteratorReachesStepAlone(setup, step) {
    const { iterator } = step.operation
    const definition = String(setup.pc)
    const reaching = (pc) =>
      this.state.reachingDefinitions.get(pc)?.[iterator] ?? new Set()
    const stepReaching = reaching(step.pc)
    if (stepReaching.size !== 1 || !stepReaching.has(definition)) return false
    return !this.state.instructions.some(
      ({ pc, operation }) =>
        pc !== step.pc &&
        this.state.reachablePcs.has(pc) &&
        operationReads(operation).includes(iterator) &&
        reaching(pc).has(definition),
    )
  }

  markHeadTest(headTest) {
    for (const id of headTest.blocks)
      this.state.markBlock(this.state.nodeById.get(id))
  }

  // A for's update clause.
  renderUpdate(region) {
    const parts = this.renderRun(
      region,
      region.updateBlockIds,
      region.headerBlockId,
    )
    if (region.updateBlockIds.some((id) => !this.state.emittedBlocks.has(id)))
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} update does not end at its back edge`,
      )
    return parts.length ? runExpression(parts) : null
  }

  // A do-while's test clause: the run up to its branch, then the condition under which the
  // branch goes back to the header.
  renderTest(region) {
    const [test, latch] = region.testBlockIds.slice(-2)
    const parts = this.renderRun(region, region.testBlockIds, test)
    const testBlock = this.state.nodeById.get(test)
    const latchBlock = this.state.nodeById.get(latch)
    const branch = testBlock.instruction
    const conditional = this.state.conditionalByTest.get(test)
    const jump = latchBlock.instruction
    if (
      !conditional ||
      jump.operation.kind !== 'jump' ||
      this.state.nodeForPc(jump.operation.target).id !== region.headerBlockId
    )
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} test does not end at its back edge`,
      )
    this.state.markBlock(testBlock)
    this.state.markBlock(latchBlock)
    const backOnBranch =
      this.state.nodeForPc(conditional.branchTargetPc).id === latch
    parts.push(
      backOnBranch
        ? this.state.predicateOf(branch)
        : this.state.inversePredicateOf(branch),
    )
    return runExpression(parts)
  }

  // The run a loop's continue enters, as the clause a native continue runs: one comma expression
  // from the continue target to `stop`, a conditional inside it (planned to close inside the
  // run) written as `test ? (…) : (…)`. A for's update runs to the back edge's jump; a do-while's
  // test to its own branch, whose condition the caller adds.
  renderRun(region, runIds, stop) {
    const walk = walkRun(this.state, runIds, region.continueBlockId, stop)
    if (walk.failure)
      decline(
        'unemittable-structured-control',
        `Natural loop ${region.headerBlockId} ${walk.failure}`,
      )
    for (const id of walk.blocks)
      this.state.markBlock(this.state.nodeById.get(id))
    return walk.parts
  }
}
