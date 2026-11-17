import { mayThrow } from '../model/control.js'
import {
  expressionProducer,
  LiteralReads,
  localCaptureRegisterSet,
  operandRead,
  reachingDefinitionUses,
  readRegisters,
} from '../model/operations.js'
import { checkObjectLiterals, objectLiteralUnits } from './object-literals.js'
import { conditionalValues } from './conditional-values.js'
import { CopySimplifier } from './copy-simplification.js'
import { singleUseFolds } from './single-use-folding.js'

// The registers a handler route writes and the try rendering reads natively.
function handlerRegisterSet(instructions) {
  const registers = new Set()
  for (const { operation } of instructions) {
    if (operation.kind === 'catch-setup')
      registers.add(operation.exceptionRegister)
    if (operation.kind === 'finally-setup') {
      registers.add(operation.continuation)
      registers.add(operation.payload)
    }
  }
  return registers
}

function methodCallCandidates(instructions, solved, kept) {
  const byPc = new Map(instructions.map((item) => [item.pc, item]))
  const reachablePcs = new Set(solved.reachablePcs)
  const sameSet = (left, right) =>
    left?.size === right?.size && [...left].every((item) => right.has(item))
  const calls = new Map()
  for (const { pc, operation } of instructions) {
    if (
      !reachablePcs.has(pc) ||
      operation.kind !== 'call' ||
      operation.mode !== 'apply' ||
      operation.receiver.kind !== 'register' ||
      kept.has(operation.receiver.index)
    )
      continue
    const receiver = operation.receiver.index
    const state = solved.reachingDefinitions.get(pc)
    const calleeDefinitions = state?.[operation.callee]
    if (calleeDefinitions?.size !== 1) continue
    const calleePc = Number([...calleeDefinitions][0])
    const read = byPc.get(calleePc)?.operation
    if (
      read?.kind !== 'property-read' ||
      read.object !== receiver ||
      read.key === receiver ||
      operation.arguments.registers.includes(receiver) ||
      !sameSet(
        solved.reachingDefinitions.get(calleePc)?.[receiver],
        state[receiver],
      )
    )
      continue
    calls.set(pc, { receiver, callee: operation.callee, calleePc })
  }
  return calls
}

const pcOf = (id) => Number(id.slice(id.lastIndexOf('@') + 1))

// Each test of each switch region: the region, its case and the case's index.
function switchCases(regions) {
  return regions
    .filter(({ kind }) => kind === 'switch')
    .flatMap((region) =>
      region.cases.map((item, index) => ({ region, item, index })),
    )
}

// The PCs no producer folds into: a switch renders each test's `===` as its case and reads the
// label and discriminant registers itself, so a test chain's tests, its runs and each compare a
// test reads (the head's lies before the region) keep their registers.
function switchTestPcs(regions, instructions, solved) {
  const byPc = new Map(instructions.map((item) => [item.pc, item]))
  const barred = new Set()
  for (const { item } of switchCases(regions)) {
    const test = pcOf(item.testBlockId)
    barred.add(test)
    for (const id of item.runBlockIds) barred.add(pcOf(id))
    const condition = byPc.get(test).operation.condition
    for (const id of solved.reachingDefinitions.get(test)?.[condition] ?? [])
      if (/^\d+$/.test(id)) barred.add(Number(id))
  }
  return barred
}

// What each test of a switch region reads once the switch renders it: the head its discriminant
// and its case value, every later test its case value. The switch compares a label with the
// discriminant itself, so no test reads its compare; value planning sees a test as these reads.
function switchTestReads(regions) {
  return new Map(
    switchCases(regions).map(({ region, item, index }) => [
      pcOf(item.testBlockId),
      index === 0 ? [region.discriminant, item.value] : [item.value],
    ]),
  )
}

// Each conditional region with a merge: test PC -> { mergePc }, a candidate conditional value.
function conditionalMerges(regions) {
  return new Map(
    regions
      .filter(
        ({ kind, mergeBlockId }) => kind === 'conditional' && mergeBlockId,
      )
      .map((region) => [
        pcOf(region.testBlockId),
        { mergePc: pcOf(region.mergeBlockId) },
      ]),
  )
}

// Value planning, over the control solver's facts, in order:
// 1. literal propagation: a read every reaching definition gives one literal reads the literal;
// 2. dead definitions: an assign that cannot throw, whose definition nothing reads any more, is
//    dropped, to a fixed point (not a captured or handler register);
// 3. object literal units (objectLiteralUnits), a spread's call read as `object-spread`;
// 4. copy simplification (CopySimplifier) over what remains, a unit's site producing its object;
// 5. single-use folding (singleUseFolds): a producer moves into its one use as an operand
//    expression, a unit's case taking folds in its literal slots, a conditional value
//    (conditionalValues, over the `regions`' conditionals with a merge) one producer;
// 6. the literal check (checkObjectLiterals): a unit whose parts cannot all move to its site loses
//    the folds of the part that cannot (barred) or is dropped, and 3-5 run again.
// A switch region's tests are PCs nothing folds into (switchTestPcs) and read what the switch
// renders (switchTestReads), so a compare only its test read is unread and frame setup counts the
// discriminant and the case values the switch reads.
export function effectiveStructuredInstructions(
  functionId,
  instructions,
  solved,
  regions,
) {
  return new ValuePlanner(functionId, instructions, solved, regions).plan()
}

/**
 * One function's value planning: the facts every round reads, set once, and the round state the
 * literal checks and method calls settle (`excluded`, `bars`, `methodCalls`). `plan` runs rounds
 * until one settles and returns the effective rows.
 */
class ValuePlanner {
  constructor(functionId, instructions, solved, regions) {
    this.functionId = functionId
    this.solved = solved
    this.barredUses = switchTestPcs(regions, instructions, solved)
    this.conditionals = conditionalMerges(regions)
    this.planned = withSwitchTests(instructions, switchTestReads(regions))
    // Spreads rewrite calls only, so the closure and handler registers hold for every round.
    this.localCaptureRegisters = localCaptureRegisterSet(this.planned)
    this.handlerRegisters = handlerRegisterSet(this.planned)
    this.kept = new Set([
      ...this.localCaptureRegisters,
      ...this.handlerRegisters,
    ])
    this.literals = new LiteralReads(this.planned, solved)
    this.dead = deadDefinitions(this.planned, solved, this.literals, this.kept)
    // Method calls whose callee is a read of the receiver register, both reached by the same
    // definitions of it: once the callee folds, the call is `o[k](args)` and reads the receiver as
    // that read's object. A call whose callee does not fold leaves the set, and planning repeats.
    this.methodCalls = methodCallCandidates(this.planned, solved, this.kept)
    this.excluded = new Set()
    this.bars = new Map()
  }

  plan() {
    const discarded = discardedDefinitions(
      this.planned,
      this.solved,
      this.literals,
      this.kept,
      this.dead,
    )
    let round
    do round = this.round()
    while (this.settle(round))
    const rows = new EffectiveRows(round, this.literals, discarded)
    return {
      copyProofs: round.copyProofs,
      deadProofs: this.deadProofs(round),
      removedPcs: round.removedPcs,
      literals: this.literals,
      effectiveAt: (pc) => rows.at(pc),
      // A read at `pc` folded from its producer: the producer's effective case, or null.
      foldAt: (pc, register) => rows.foldAt(pc, register),
      // Test PC -> { register, pcs, mergePc } of each conditional value written in its use.
      absorbed: round.absorbed,
      instructions: round.instructions
        .filter(({ pc }) => !round.removedPcs.has(pc))
        .map(({ pc }) => rows.at(pc)),
    }
  }

  deadProofs(round) {
    return [...this.dead]
      .sort((left, right) => left - right)
      .map((pc) => ({
        functionId: this.functionId,
        pc,
        destinationRegister: round.instructions.find((item) => item.pc === pc)
          .operation.destination,
        disposition: 'safely-eliminated',
        reason: 'unread-definition-cannot-throw',
      }))
  }

  // Step 3 under the current exclusions: the units, the cases with each spread's call read as
  // `object-spread`, and the cases removed (the dead and each spread's reads).
  units() {
    const units = objectLiteralUnits({
      instructions: this.planned,
      solved: this.solved,
      removed: this.dead,
      literals: this.literals,
      excluded: this.excluded,
      keptRegisters: this.kept,
    })
    const spreads = new Map(
      units.flatMap((unit) =>
        [...unit.spreads].map(([pc, { source }]) => [
          pc,
          { kind: 'object-spread', object: unit.register, source },
        ]),
      ),
    )
    const instructions = this.planned.map((instruction) =>
      spreads.has(instruction.pc)
        ? { ...instruction, operation: spreads.get(instruction.pc) }
        : instruction,
    )
    const spreadReads = units.flatMap((unit) =>
      [...unit.spreads.values()].flatMap(({ removedPcs }) => removedPcs),
    )
    return {
      units,
      instructions,
      removed: new Set([...this.dead, ...spreadReads]),
    }
  }

  // One planning round (steps 3-5) under the current exclusions and bars: object literals, copies,
  // conditional values and single-use folds, and the literal checks' verdicts.
  round() {
    const { units, instructions, removed } = this.units()
    const unitBySite = new Map(units.map((unit) => [unit.site, unit]))
    const copies = new CopySimplifier(instructions, this.solved, {
      removed,
      literals: this.literals,
      unitBySite,
      localCaptureRegisters: this.localCaptureRegisters,
    }).simplify(this.functionId)
    const removedPcs = new Set([...removed, ...copies.coalescedMovePcs])
    const unitCases = new Set(units.flatMap(({ chain }) => chain))
    const values = conditionalValues({
      conditionals: this.conditionals,
      instructions,
      solved: this.solved,
      removed: removedPcs,
      copyPlan: copies.plan,
      literals: this.literals,
      unitCases,
      keptRegisters: this.kept,
    })
    const folding = singleUseFolds({
      instructions,
      solved: this.solved,
      removed: removedPcs,
      copyPlan: copies.plan,
      literals: this.literals,
      localCaptureRegisters: this.localCaptureRegisters,
      handlerRegisters: this.handlerRegisters,
      barredUses: new Set([
        ...this.barredUses,
        ...[...this.bars.values()].flatMap((pcs) => [...pcs]),
      ]),
      methodCalls: this.methodCalls,
      unitCases,
      unitBySite,
      values,
    })
    const { foldedInto, foldsAt } = folding
    // A folded conditional value is written in its use; its cases render there.
    const absorbed = new Map(
      [...values].filter(([testPc]) => foldedInto.has(testPc)),
    )
    const verdicts = checkObjectLiterals({
      units,
      instructions,
      solved: this.solved,
      removedPcs,
      absorbedPcs: new Set(
        [...absorbed.values()].flatMap(({ pcs }) => [...pcs]),
      ),
      literals: this.literals,
      folding,
    })
    return {
      instructions,
      units,
      copyPlan: copies.plan,
      copyProofs: copies.proofs,
      removedPcs,
      foldedInto,
      foldsAt,
      absorbed,
      verdicts,
    }
  }

  // Applies a round's outcome: a method call whose callee did not fold leaves the candidates, a
  // dropped literal is excluded and a barred part's folds are barred. True when planning repeats.
  settle(round) {
    let unfolded = false
    for (const [pc, { callee, calleePc }] of this.methodCalls)
      if (round.foldsAt.get(pc)?.get(callee) !== calleePc) {
        this.methodCalls.delete(pc)
        unfolded = true
      }
    if (!round.verdicts.length && !unfolded) return false
    for (const { unit, verdict, pc } of round.verdicts) {
      if (verdict === 'drop') {
        this.excluded.add(unit.objectPc)
        this.bars.delete(unit.objectPc)
      } else {
        if (!this.bars.has(unit.objectPc))
          this.bars.set(unit.objectPc, new Set())
        this.bars.get(unit.objectPc).add(pc)
      }
    }
    return true
  }
}

// A switch test reads what its switch renders: the discriminant and its case's value.
function withSwitchTests(instructions, switchReads) {
  return instructions.map((instruction) =>
    switchReads.has(instruction.pc)
      ? {
          ...instruction,
          operation: {
            kind: 'switch-test',
            reads: switchReads.get(instruction.pc),
          },
        }
      : instruction,
  )
}

// Reachable assignments nothing reads and that cannot throw, to a fixpoint: dropping one can leave
// the definitions it read unread.
function deadDefinitions(instructions, solved, literals, kept) {
  const reachablePcs = new Set(solved.reachablePcs)
  const droppable = instructions.filter(
    ({ pc, operation }) =>
      reachablePcs.has(pc) &&
      operation.kind === 'assign' &&
      !mayThrow(operation) &&
      !kept.has(operation.destination),
  )
  const dead = new Set()
  for (let changed = true; changed; ) {
    changed = false
    const uses = reachingDefinitionUses(
      instructions,
      solved.reachingDefinitions,
      dead,
      literals,
    )
    for (const { pc } of droppable)
      if (!dead.has(pc) && !uses.has(String(pc))) {
        dead.add(pc)
        changed = true
      }
  }
  return dead
}

// An unread definition that may throw keeps its evaluation and drops its write: it is written
// as its expression statement.
function discardedDefinitions(instructions, solved, literals, kept, dead) {
  const reachablePcs = new Set(solved.reachablePcs)
  const finalUses = reachingDefinitionUses(
    instructions,
    solved.reachingDefinitions,
    dead,
    literals,
  )
  return new Set(
    instructions
      .filter(
        ({ pc, operation }) =>
          reachablePcs.has(pc) &&
          !dead.has(pc) &&
          (expressionProducer(operation) || operation.kind === 'global-read') &&
          mayThrow(operation) &&
          !kept.has(operation.destination) &&
          !finalUses.has(String(pc)),
      )
      .map(({ pc }) => pc),
  )
}

/**
 * Each case as rendering reads it: retargeted, its literal reads and folded reads recorded (a
 * folded read maps to its producer's effective case), and a folded producer marked. A unit's site
 * renders the literal from its parts; its other cases render inside it.
 */
class EffectiveRows {
  constructor(round, literals, discarded) {
    this.round = round
    this.literals = literals
    this.discarded = discarded
    this.byPc = new Map(round.instructions.map((item) => [item.pc, item]))
    this.unitAt = new Map(
      round.units.flatMap((unit) => unit.chain.map((pc) => [pc, unit])),
    )
    // A logical value's left producer writes the value as its arms do.
    this.valueWriters = new Set(
      [...round.absorbed.values()].flatMap(({ writers, logical }) => [
        ...writers,
        ...(logical ? [logical.leftPc] : []),
      ]),
    )
    this.rows = new Map()
  }

  // A folded read: its producer's effective case, or a conditional value's own row.
  producerRow(pc, register) {
    return this.round.absorbed.has(pc)
      ? { pc, operation: { kind: 'conditional-value', destination: register } }
      : this.at(pc)
  }

  foldAt(pc, register) {
    const folds = this.round.foldsAt.get(pc)
    return folds?.has(register)
      ? this.producerRow(folds.get(register), register)
      : null
  }

  at(pc) {
    if (!this.rows.has(pc)) this.rows.set(pc, this.build(pc))
    return this.rows.get(pc)
  }

  build(pc) {
    const { copyPlan, foldsAt, foldedInto } = this.round
    const instruction = this.byPc.get(pc)
    const destination = copyPlan.get(pc)
    let row = withLiteralReads(
      destination === undefined
        ? instruction
        : retargetDestination(instruction, destination),
      this.literals,
    )
    const folds = foldsAt.get(pc)
    if (folds)
      row = {
        ...row,
        foldedReads: new Map(
          [...folds].map(([register, producerPc]) => [
            register,
            this.producerRow(producerPc, register),
          ]),
        ),
      }
    if (foldedInto.has(pc)) row = { ...row, folded: true }
    if (this.discarded.has(pc)) row = { ...row, discarded: true }
    // An arm's last case writes the conditional value, which its use reads as the arm's value.
    if (this.valueWriters.has(pc)) row = { ...row, writesValue: true }
    const unit = this.unitAt.get(pc)
    if (!unit) return row
    row = { ...row, literalObject: unit.register }
    if (pc !== unit.site) return { ...row, folded: true }
    const part = row
    return {
      ...row,
      unit: {
        destination: copyPlan.get(pc) ?? unit.register,
        parts: unit.chain.map((item) => (item === pc ? part : this.at(item))),
      },
    }
  }
}

// The instruction with each register it reads as a literal mapped to that literal, so its
// rendering writes the literal and frame setup does not count the read.
function withLiteralReads(instruction, literals) {
  const literalReads = new Map()
  for (const register of readRegisters(instruction)) {
    if (!operandRead(instruction)) break
    const literal = literals.at(instruction.pc, register)
    if (literal) literalReads.set(register, literal.value)
  }
  return literalReads.size ? { ...instruction, literalReads } : instruction
}

function retargetDestination(instruction, register) {
  return {
    ...instruction,
    operation: { ...instruction.operation, destination: register },
  }
}
