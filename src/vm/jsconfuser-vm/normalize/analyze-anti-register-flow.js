import { declines, deepFreeze } from '../../decline.js'
import { diagnoseAntiWordStream } from '../wordcode/read-wordcode.js'
import { restoreConcealedValue } from './normalize-concealed-constants.js'

const { decline, accepted, refused } = declines('anti-register-flow')

const REAL_ARITIES = Object.freeze({
  ADD: 3,
  SUB: 3,
  MUL: 3,
  DIV: 3,
  MOD: 3,
  EXP: 3,
  BAND: 3,
  BOR: 3,
  BXOR: 3,
  SHL: 3,
  SHR: 3,
  USHR: 3,
  LT: 3,
  GT: 3,
  LTE: 3,
  GTE: 3,
  EQ: 3,
  NEQ: 3,
  LOOSE_EQ: 3,
  LOOSE_NEQ: 3,
  UNARY_NEG: 2,
  UNARY_POS: 2,
  UNARY_NOT: 2,
  UNARY_BITNOT: 2,
  MOVE: 2,
})

// w/r are flowing fake registers; T/F are seeded, never-written anchors.
// c consumes a constant index and conceal key, in that order.
const FAKE_SLOTS = Object.freeze({
  ADD: 'wrr',
  SUB: 'wrr',
  MUL: 'wrr',
  DIV: 'wrr',
  MOD: 'wrr',
  EXP: 'wrr',
  BAND: 'wrr',
  BOR: 'wrr',
  BXOR: 'wrr',
  SHL: 'wrr',
  SHR: 'wrr',
  USHR: 'wrr',
  LT: 'wrr',
  GT: 'wrr',
  LTE: 'wrr',
  GTE: 'wrr',
  EQ: 'wrr',
  NEQ: 'wrr',
  LOOSE_EQ: 'wrr',
  LOOSE_NEQ: 'wrr',
  UNARY_NEG: 'wr',
  UNARY_POS: 'wr',
  UNARY_NOT: 'wr',
  UNARY_BITNOT: 'wr',
  TYPEOF: 'wr',
  MOVE: 'wr',
  LOAD_INT: 'wi',
  LOAD_CONST: 'wc',
  LOAD_GLOBAL: 'wg',
  TYPEOF_SAFE: 'wn',
  JUMP_IF_FALSE: 'Tl',
  JUMP_IF_TRUE: 'Fl',
  BUILD_ARRAY: 'wkr',
  BUILD_OBJECT: 'wkrr',
})

const SAFE_GLOBALS = new Set([
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Math',
  'JSON',
  'Date',
  'RegExp',
  'Error',
  'Function',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'Infinity',
  'NaN',
  'undefined',
])
const MAX_FAKE_INT = 65535
const MAX_MODELS = 4096
const NAME_PATTERN = /^[A-Za-z0-9]{3,10}$/
const SEED_STRING_PATTERN = /^[A-Za-z0-9]{3,8}$/

function constantAt(pool, index, key) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= pool.length)
    return { valid: false }
  try {
    return { valid: true, value: restoreConcealedValue(pool[index], key) }
  } catch {
    return { valid: false }
  }
}

function fakeScalar(value) {
  return (
    (Number.isInteger(value) && value >= 0 && value <= MAX_FAKE_INT) ||
    (typeof value === 'string' && SEED_STRING_PATTERN.test(value))
  )
}

function readPair(words, index, pool) {
  return constantAt(pool, words[index], words[index + 1])
}

// The slots a fake step fills with one word; every other slot is a constant's (index, key) pair.
const WORD_SLOTS = new Set(['w', 'r', 'T', 'F', 'l', 'i', 'k'])

// A one-word slot of a fake step under `model` (`flowing`, `anchors`, `fromOrigin`): a flowing
// register, the truthy or falsy anchor, the step's own fallthrough, a small integer or a kind.
function fakeWordMatches(slot, word, instruction, model) {
  if (slot === 'w' || slot === 'r') return model.flowing.has(word)
  if (slot === 'T' || slot === 'F') return word === model.anchors[slot]
  if (slot === 'l') return model.fromOrigin(word) === instruction.nextPc
  if (slot === 'i') return !(word > MAX_FAKE_INT)
  return !(word > 2)
}

// A constant slot: a fake scalar, a safe global or a name.
function fakeConstantMatches(slot, constant) {
  if (!constant.valid) return false
  if (slot === 'c') return fakeScalar(constant.value)
  if (slot === 'g') return SAFE_GLOBALS.has(constant.value)
  if (slot === 'n')
    return (
      typeof constant.value === 'string' && NAME_PATTERN.test(constant.value)
    )
  return true
}

// A step the fake model writes: its layout's slots fill its words exactly. `model`: the flowing
// registers, the anchors, the constant pool and the origin translation.
function fakeStepMatches(step, instruction, model) {
  const layout = FAKE_SLOTS[step.name]
  if (!layout) return false
  let position = 0
  for (const slot of layout) {
    if (WORD_SLOTS.has(slot)) {
      if (!fakeWordMatches(slot, step.words[position], instruction, model))
        return false
      position += 1
    } else {
      const constant = readPair(step.words, position, model.constants)
      if (!fakeConstantMatches(slot, constant)) return false
      position += 2
    }
  }
  return position === step.words.length
}

function realStepMatches(step, fakeRegisters) {
  return (
    REAL_ARITIES[step.name] === step.words.length &&
    step.words.every((word) => !fakeRegisters.has(word))
  )
}

function registerReadsOrWrites(instruction) {
  const registers = (instruction.operands ?? [])
    .filter((operand) => operand.kind === 'register')
    .map((operand) => operand.index)
  if (instruction.name === 'MAKE_CLOSURE') {
    registers.push(
      ...instruction.captures
        .filter((capture) => capture.isLocal)
        .map((capture) => capture.index),
    )
  }
  return registers
}

function functionIntervals(instructions, wordCount) {
  const boundaries = new Set(instructions.map(({ pc }) => pc))
  const starts = [
    ...new Set([
      0,
      ...instructions
        .filter(({ name }) => name === 'MAKE_CLOSURE')
        .map(({ functionMeta }) => functionMeta.startPc),
    ]),
  ].sort((left, right) => left - right)
  if (starts.some((pc) => !boundaries.has(pc)))
    decline('function-boundary', 'Function entries are not unique boundaries')
  return starts.map((startPc, index) => {
    const endPc = starts[index + 1] ?? wordCount
    const body = instructions.filter(({ pc }) => pc >= startPc && pc < endPc)
    if (
      body.length === 0 ||
      body[0].pc !== startPc ||
      body.at(-1).nextPc !== endPc
    )
      decline('function-boundary', 'Function interval is incomplete')
    for (const instruction of body) {
      if (instruction.name === 'MAKE_CLOSURE') continue
      if (
        instruction.operands?.some(
          (operand) =>
            operand.kind === 'label-target' &&
            (!boundaries.has(operand.pc) ||
              operand.pc < startPc ||
              operand.pc >= endPc),
        )
      ) {
        decline(
          'function-boundary',
          'Direct target crosses a function interval',
        )
      }
    }
    return { startPc, endPc, body }
  })
}

// The seed sets an interval's leading LOAD_CONSTs can form: `count` distinct registers holding fake
// scalars, which no other instruction touches. A PATCH suspect is an undecided selfModifying
// filler: isolation reads past it. Real code never touches a seed register, so a suspect that
// touches one is a decoy (settled here); while the optional seed is undecided, a suspect touching
// only it decides nothing (see recognize).
function seedSets(interval, constants, suspects, hasJump) {
  let prefix = 0
  while (interval.body[prefix]?.name === 'LOAD_CONST') prefix += 1
  const sets = []
  for (const count of hasJump ? [4, 5] : [2, 3]) {
    if (count > prefix) continue
    const seeds = interval.body.slice(0, count).map((instruction) => ({
      register: instruction.words[1],
      constant: readPair(instruction.words, 2, constants),
    }))
    const fakeRegisters = new Set(seeds.map(({ register }) => register))
    if (
      fakeRegisters.size !== count ||
      seeds.some(
        ({ constant }) => !constant.valid || !fakeScalar(constant.value),
      )
    )
      continue
    const touched = interval.body
      .slice(count)
      .some(
        (instruction) =>
          instruction.name !== 'SYNTHETIC' &&
          !suspects.has(instruction.pc) &&
          registerReadsOrWrites(instruction).some((register) =>
            fakeRegisters.has(register),
          ),
      )
    if (!touched) sets.push({ count, seeds, fakeRegisters })
  }
  return sets
}

// The truthy and falsy anchors a fake branch may test: a seed holding a number of at least 1 and
// another holding 0; none without branches.
function anchorPairs(seeds, hasJump) {
  if (!hasJump) return [{ T: null, F: null }]
  return seeds.flatMap((truthy) =>
    seeds
      .filter(
        (falsy) =>
          falsy.register !== truthy.register &&
          typeof truthy.constant.value === 'number' &&
          truthy.constant.value >= 1 &&
          falsy.constant.value === 0,
      )
      .map((falsy) => ({ T: truthy.register, F: falsy.register })),
  )
}

// The step positions of one synthetic instruction that can be its real step: a real step there,
// a fake step everywhere else.
function realPositions(instruction, model, fakeRegisters) {
  const possible = new Set()
  for (const [index, step] of instruction.steps.entries())
    if (
      realStepMatches(step, fakeRegisters) &&
      instruction.steps.every(
        (other, position) =>
          position === index || fakeStepMatches(other, instruction, model),
      )
    )
      possible.add(index)
  return possible
}

// Each synthetic opcode's possible real-step positions, narrowed across its instructions; null
// when one has none.
function opcodeCandidates(synthetic, model, fakeRegisters) {
  const candidates = new Map()
  for (const instruction of synthetic) {
    const opcode = instruction.opcode.value
    const possible = realPositions(instruction, model, fakeRegisters)
    const previous = candidates.get(opcode)
    const narrowed = previous
      ? new Set([...previous].filter((index) => possible.has(index)))
      : possible
    if (narrowed.size === 0) return null
    candidates.set(opcode, narrowed)
  }
  return candidates
}

// Every fake register model of an interval (`{ count, anchors, candidates }`): a seed set, an
// anchor pair and the real-step candidates they leave.
function seedVariants(interval, constants, fromOrigin, suspects) {
  const synthetic = interval.body.filter(({ name }) => name === 'SYNTHETIC')
  if (synthetic.length === 0) return []
  const hasJump = synthetic.some(({ steps }) =>
    steps.some(
      ({ name }) => name === 'JUMP_IF_TRUE' || name === 'JUMP_IF_FALSE',
    ),
  )
  const variants = []
  for (const { count, seeds, fakeRegisters } of seedSets(
    interval,
    constants,
    suspects,
    hasJump,
  ))
    for (const anchors of anchorPairs(seeds, hasJump)) {
      const flowing = new Set(
        [...fakeRegisters].filter(
          (register) => register !== anchors.T && register !== anchors.F,
        ),
      )
      const model = { flowing, anchors, constants, fromOrigin }
      const candidates = opcodeCandidates(synthetic, model, fakeRegisters)
      if (candidates) variants.push({ count, anchors, candidates })
    }
  if (variants.length === 0) {
    decline(
      'register-isolation',
      `No fake register model at ${interval.startPc}`,
    )
  }
  return variants
}

function intersectCandidates(left, right) {
  const merged = new Map(left)
  for (const [opcode, positions] of right) {
    const prior = merged.get(opcode)
    const common = prior
      ? new Set([...prior].filter((position) => positions.has(position)))
      : positions
    if (common.size === 0) return null
    merged.set(opcode, common)
  }
  return merged
}

function modelKey(model) {
  return JSON.stringify(
    [...model.entries()]
      .sort(([left], [right]) => left - right)
      .map(([opcode, positions]) => [opcode, [...positions].sort()]),
  )
}

// The real-step models every fused function agrees on: each function's variants intersected
// with the models so far, kept distinct and within the proof limit.
function solveModels(functions) {
  let solutions = [new Map()]
  for (const fn of functions) {
    const next = solutions.flatMap((solution) =>
      fn.variants
        .map(({ candidates }) => intersectCandidates(solution, candidates))
        .filter(Boolean),
    )
    solutions = [
      ...new Map(next.map((model) => [modelKey(model), model])).values(),
    ]
    if (solutions.length === 0) {
      decline('register-isolation', 'Function models disagree on real steps')
    }
    if (solutions.length > MAX_MODELS) {
      decline('model-limit', 'Synthetic register models exceed the proof limit')
    }
  }
  return solutions
}

// Each synthetic opcode's real step, the one position every model leaves it.
function selectRealSteps(runtimeObservation, solutions) {
  return runtimeObservation.syntheticCases.map((entry) => {
    const positions = new Set(
      solutions.flatMap((solution) => [...(solution.get(entry.opcode) ?? [])]),
    )
    if (positions.size !== 1) {
      decline(
        'ambiguous-real-step',
        `Opcode ${entry.opcode} has no unique real step`,
      )
    }
    const index = [...positions][0]
    return { opcode: entry.opcode, index, name: entry.steps[index].name }
  })
}

// A fused function's seed counts under the selected real steps, its deferred seed, and the decoys
// it settles (added to `decoys`). Seeds below the smallest count are fake in every model; the one
// above it is fake only in the larger model. A suspect touching a fake seed is a decoy. When both
// counts fit and a suspect touches the optional seed, the seed is deferred: kept as code, settled
// later.
function seedCountChoice(
  { startPc, variants, interval },
  selected,
  suspects,
  decoys,
) {
  const counts = [
    ...new Set(
      variants
        .filter(({ candidates }) =>
          [...candidates].every(([opcode, positions]) =>
            positions.has(selected.get(opcode)),
          ),
        )
        .map(({ count }) => count),
    ),
  ].sort()
  const touching = (register) =>
    interval.body.filter(
      (instruction) =>
        suspects.has(instruction.pc) &&
        registerReadsOrWrites(instruction).includes(register),
    )
  const count = Math.max(...counts)
  let deferredSeed = null
  for (const [offset, seed] of interval.body.slice(0, count).entries()) {
    const hits = touching(seed.words[1])
    if (hits.length === 0) continue
    if (offset >= Math.min(...counts)) {
      deferredSeed = seed.pc
      continue
    }
    for (const { pc } of hits) decoys.add(pc)
  }
  return { startPc, counts, deferredSeed }
}

// A fake branch targets its own fallthrough. When an earlier stage moved code, that operand is
// still an origin address, and originPcMap (origin PC -> input PC) translates it.
function recognize(container, runtimeObservation, originPcMap, suspects) {
  const fromOrigin = (pc) => (originPcMap ? originPcMap.get(pc) : pc)
  const scan = diagnoseAntiWordStream(container, runtimeObservation)
  if (!scan.ok) decline(scan.diagnostic.code, scan.diagnostic.message)
  const constants = container.roles?.pool?.values
  if (!Array.isArray(constants)) {
    decline('constant-pool', 'the container has no constant pool')
  }
  const intervals = functionIntervals(
    scan.result.instructions,
    scan.result.wordCount,
  )
  const functions = intervals
    .map((interval) => ({
      startPc: interval.startPc,
      variants: seedVariants(interval, constants, fromOrigin, suspects),
      interval,
    }))
    .filter(({ variants }) => variants.length > 0)
  const solutions = solveModels(functions)
  const realSteps = selectRealSteps(runtimeObservation, solutions)
  const selected = new Map(
    realSteps.map(({ opcode, index }) => [opcode, index]),
  )
  const decoys = new Set()
  const seedCountChoices = functions.map((fn) =>
    seedCountChoice(fn, selected, suspects, decoys),
  )
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-anti-register-flow-observation.v1',
    realSteps,
    functionCount: intervals.length,
    fusedFunctionCount: functions.length,
    seedCountChoices,
    decoys: [...decoys].sort((left, right) => left - right),
  })
}

export function diagnoseAntiRegisterFlow(
  container,
  runtimeObservation,
  { originPcMap = null, suspects = new Set() } = {},
) {
  try {
    return accepted(
      recognize(container, runtimeObservation, originPcMap, suspects),
      { fallback: 'anti-register-flow-error', freeze: true },
    )
  } catch (error) {
    return refused(error, {
      fallback: 'anti-register-flow-error',
      freeze: true,
    })
  }
}
