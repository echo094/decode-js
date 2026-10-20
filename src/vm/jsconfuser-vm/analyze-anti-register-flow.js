import { diagnoseAntiWordStream } from './read-wordcode.js'
import { restoreConcealedValue } from './normalize-concealed-constants.js'

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

class FlowDecline extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function decline(code, message) {
  throw new FlowDecline(code, message)
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

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

function fakeStepMatches(
  step,
  instruction,
  flowing,
  anchors,
  constants,
  fromOrigin,
) {
  const layout = FAKE_SLOTS[step.name]
  if (!layout) return false
  let position = 0
  for (const slot of layout) {
    const word = step.words[position]
    if (slot === 'w' || slot === 'r') {
      if (!flowing.has(word)) return false
      position += 1
    } else if (slot === 'T' || slot === 'F') {
      if (word !== anchors[slot]) return false
      position += 1
    } else if (slot === 'l') {
      if (fromOrigin(word) !== instruction.nextPc) return false
      position += 1
    } else if (slot === 'i') {
      if (word > MAX_FAKE_INT) return false
      position += 1
    } else if (slot === 'k') {
      if (word > 2) return false
      position += 1
    } else {
      const constant = readPair(step.words, position, constants)
      if (!constant.valid) return false
      if (slot === 'c' && !fakeScalar(constant.value)) return false
      if (slot === 'g' && !SAFE_GLOBALS.has(constant.value)) return false
      if (
        slot === 'n' &&
        (typeof constant.value !== 'string' ||
          !NAME_PATTERN.test(constant.value))
      )
        return false
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
  const registers = (instruction.wordOperands ?? [])
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
        instruction.wordOperands?.some(
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

// A PATCH suspect is an undecided selfModifying filler: isolation reads past it. Real code never
// touches a seed register, so a suspect that touches one is a decoy (settled here); while the
// optional seed is undecided, a suspect touching only it decides nothing (see recognize).
function seedVariants(interval, constants, fromOrigin, suspects) {
  const synthetic = interval.body.filter(({ name }) => name === 'SYNTHETIC')
  if (synthetic.length === 0) return []
  const hasJump = synthetic.some(({ steps }) =>
    steps.some(
      ({ name }) => name === 'JUMP_IF_TRUE' || name === 'JUMP_IF_FALSE',
    ),
  )
  let prefix = 0
  while (interval.body[prefix]?.name === 'LOAD_CONST') prefix += 1
  const variants = []
  for (const count of hasJump ? [4, 5] : [2, 3]) {
    if (count > prefix) continue
    const seeds = interval.body.slice(0, count).map((instruction) => ({
      register: instruction.words[1],
      constant: readPair(instruction.words, 2, constants),
    }))
    if (
      new Set(seeds.map(({ register }) => register)).size !== count ||
      seeds.some(
        ({ constant }) => !constant.valid || !fakeScalar(constant.value),
      )
    )
      continue
    const fakeRegisters = new Set(seeds.map(({ register }) => register))
    if (
      interval.body
        .slice(count)
        .some(
          (instruction) =>
            instruction.name !== 'SYNTHETIC' &&
            !suspects.has(instruction.pc) &&
            registerReadsOrWrites(instruction).some((register) =>
              fakeRegisters.has(register),
            ),
        )
    )
      continue
    const anchorPairs = hasJump
      ? seeds.flatMap((truthy) =>
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
      : [{ T: null, F: null }]
    for (const anchors of anchorPairs) {
      const flowing = new Set(
        seeds
          .map(({ register }) => register)
          .filter(
            (register) => register !== anchors.T && register !== anchors.F,
          ),
      )
      const candidates = new Map()
      let valid = true
      for (const instruction of synthetic) {
        const opcode = instruction.opcode.value
        const possible = new Set()
        for (let index = 0; index < instruction.steps.length; index += 1) {
          if (!realStepMatches(instruction.steps[index], fakeRegisters))
            continue
          if (
            instruction.steps.every(
              (step, position) =>
                position === index ||
                fakeStepMatches(
                  step,
                  instruction,
                  flowing,
                  anchors,
                  constants,
                  fromOrigin,
                ),
            )
          )
            possible.add(index)
        }
        const previous = candidates.get(opcode)
        const narrowed = previous
          ? new Set([...previous].filter((index) => possible.has(index)))
          : possible
        if (narrowed.size === 0) {
          valid = false
          break
        }
        candidates.set(opcode, narrowed)
      }
      if (valid) variants.push({ count, anchors, candidates })
    }
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

// A fake branch targets its own fallthrough. When an earlier stage moved code, that operand is
// still a Packet A address, and originPcMap (origin PC -> input PC) translates it.
function recognize(container, runtimeObservation, originPcMap, suspects) {
  const fromOrigin = (pc) => (originPcMap ? originPcMap.get(pc) : pc)
  const scan = diagnoseAntiWordStream(container, runtimeObservation)
  if (!scan.ok) decline(scan.diagnostic.code, scan.diagnostic.message)
  const constants = container.roles?.pool?.values
  if (!Array.isArray(constants)) {
    decline('constant-pool', 'Packet A has no constant pool')
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
  const realSteps = runtimeObservation.syntheticCases.map((entry) => {
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
  const selected = new Map(
    realSteps.map(({ opcode, index }) => [opcode, index]),
  )
  const decoys = new Set()
  const seedCountChoices = functions.map(({ startPc, variants, interval }) => {
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
    // Seeds below the smallest count are fake in every model; the one above it is fake only in
    // the larger model. A suspect touching a fake seed is a decoy. When both counts fit and a
    // suspect touches the optional seed, the seed is deferred: kept as code, settled later.
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
  })
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
    return deepFreeze({
      ok: true,
      result: recognize(container, runtimeObservation, originPcMap, suspects),
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof FlowDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'anti-register-flow-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
