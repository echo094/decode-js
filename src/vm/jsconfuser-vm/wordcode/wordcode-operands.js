import { declines } from '../../decline.js'

// The canonical opcodes' operand layouts (read-wordcode): one layout per fixed-width opcode, the
// word widths and code-address offsets derived from it, and the instruction record.

const UINT32_MAX = 0xffffffff

const BINARY_REGISTER_OPCODES = [
  'ADD',
  'SUB',
  'MUL',
  'DIV',
  'MOD',
  'EXP',
  'BAND',
  'BOR',
  'BXOR',
  'SHL',
  'SHR',
  'USHR',
  'LT',
  'GT',
  'LTE',
  'GTE',
  'EQ',
  'NEQ',
  'LOOSE_EQ',
  'LOOSE_NEQ',
  'IN',
  'INSTANCEOF',
]

const UNARY_REGISTER_OPCODES = [
  'UNARY_NEG',
  'UNARY_POS',
  'UNARY_NOT',
  'UNARY_BITNOT',
  'TYPEOF',
  'VOID',
]

const THREE_REGISTER_OPCODES = [
  'GET_PROP',
  'SET_PROP',
  'DELETE_PROP',
  'DEFINE_GETTER',
  'DEFINE_SETTER',
]

const family = (names, layout) => names.map((name) => [name, layout])

// Each fixed-width opcode's operands, in word order. A constant takes two words (pool index, conceal
// key); every other operand one.
export const FIXED_LAYOUTS = Object.freeze({
  LOAD_CONST: ['register', 'constant'],
  LOAD_GLOBAL: ['register', 'constant'],
  STORE_GLOBAL: ['constant', 'register'],
  TYPEOF_SAFE: ['register', 'constant'],
  LOAD_INT: ['register', 'immediate'],
  LOAD_UPVALUE: ['register', 'upvalue'],
  STORE_UPVALUE: ['upvalue', 'register'],
  LOAD_THIS: ['register'],
  MOVE: ['register', 'register'],
  RETURN: ['register'],
  THROW: ['register'],
  JUMP_REG: ['register'],
  FOR_IN_SETUP: ['register', 'register'],
  JUMP: ['label'],
  JUMP_IF_FALSE: ['register', 'label'],
  JUMP_IF_TRUE: ['register', 'label'],
  FOR_IN_NEXT: ['register', 'register', 'label'],
  TRY_SETUP: ['label', 'register'],
  FINALLY_SETUP: ['label', 'register', 'register', 'label'],
  TRY_END: [],
  DEBUGGER: [],
  ...Object.fromEntries([
    ...family(BINARY_REGISTER_OPCODES, ['register', 'register', 'register']),
    ...family(UNARY_REGISTER_OPCODES, ['register', 'register']),
    ...family(THREE_REGISTER_OPCODES, ['register', 'register', 'register']),
  ]),
})

// MAKE_CLOSURE's fixed prefix: destination, entry PC, paramCount, regCount, captureCount, hasRest;
// its capture pairs follow.
const CLOSURE_PREFIX = [
  'register',
  'label',
  'immediate',
  'immediate',
  'immediate',
  'immediate',
]

const OPERAND_WIDTHS = Object.freeze({ constant: 2 })
const operandWidth = (kind) => OPERAND_WIDTHS[kind] ?? 1

export const FIXED_WORD_WIDTHS = Object.freeze(
  Object.fromEntries(
    Object.entries(FIXED_LAYOUTS).map(([name, layout]) => [
      name,
      1 + layout.reduce((sum, kind) => sum + operandWidth(kind), 0),
    ]),
  ),
)

function labelOffsets(layout) {
  const offsets = []
  let at = 1
  for (const kind of layout) {
    if (kind === 'label') offsets.push(at)
    at += operandWidth(kind)
  }
  return offsets
}

// The word offsets (in `words`, the opcode at 0) that hold a code address, by opcode: what a stage
// that moves code rewrites.
export const LABEL_WORD_OFFSETS = Object.freeze(
  Object.fromEntries(
    Object.entries({ ...FIXED_LAYOUTS, MAKE_CLOSURE: CLOSURE_PREFIX })
      .map(([name, layout]) => [name, labelOffsets(layout)])
      .filter(([, offsets]) => offsets.length > 0),
  ),
)

export const { decline, accepted, refused } = declines('wordcode')

export function isWord(value) {
  return Number.isInteger(value) && value >= 0 && value <= UINT32_MAX
}

export function register(index) {
  return { kind: 'register', index }
}

export function immediate(value) {
  return { kind: 'immediate', value }
}

function upvalueIndex(index) {
  return { kind: 'upvalue-index', index }
}

export function labelTarget(value) {
  return { kind: 'label-target', pc: value }
}

function constantRef(index, key) {
  return { kind: 'constant-ref', index, concealKey: key }
}

export function spreadSentinel(value) {
  return { kind: 'spread-sentinel', value }
}

const OPERAND_READERS = Object.freeze({
  register: ([index]) => register(index),
  constant: ([index, key]) => constantRef(index, key),
  immediate: ([value]) => immediate(value),
  upvalue: ([index]) => upvalueIndex(index),
  label: ([pc]) => labelTarget(pc),
})

// The operands of a fixed-width instruction's words, by its layout.
export function fixedOperands(layout, raw) {
  let at = 1
  return layout.map((kind) => {
    const width = operandWidth(kind)
    const operand = OPERAND_READERS[kind](raw.slice(at, at + width))
    at += width
    return operand
  })
}

// `opcode`: the instruction's operation name and its opcode value, `{ name, value }`.
export function makeInstruction(pc, opcode, words, operands, extra = {}) {
  const { name, value } = opcode
  return {
    pc,
    name,
    opcode: { name, value },
    operands,
    words: words.slice(),
    width: words.length,
    nextPc: pc + words.length,
    ...extra,
  }
}

export function checkCount(count, remaining, name, field, pc) {
  if (!Number.isSafeInteger(count) || count < 0) {
    decline('invalid-count', `${name} at ${pc} has an invalid ${field}`)
  }
  if (count > remaining) {
    decline(
      'truncated-instruction',
      `${name} at ${pc} is truncated in its ${field} payload`,
    )
  }
}

export function checkPairCount(count, remaining, name, field, pc) {
  if (!Number.isSafeInteger(count) || count < 0) {
    decline('invalid-count', `${name} at ${pc} has an invalid ${field}`)
  }
  if (count > Math.floor(remaining / 2)) {
    decline(
      'truncated-instruction',
      `${name} at ${pc} is truncated in its ${field} pairs`,
    )
  }
}
