export const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
export const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'
export const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'
export const CFG_SCHEMA = 'jsconfuser-vm-cfg.v1'
export const CALL_FRAME_SCHEMA = 'jsconfuser-vm-call-frames.v1'
export const CLOSURE_SCHEMA = 'jsconfuser-vm-closure-lifetimes.v1'

export const CALL_NAMES = new Set(['CALL', 'CALL_METHOD', 'NEW'])
export const UPVALUE_NAMES = new Set(['LOAD_UPVALUE', 'STORE_UPVALUE'])

export const REGISTER_RESULT_NAMES = new Set([
  'LOAD_CONST',
  'LOAD_INT',
  'LOAD_GLOBAL',
  'LOAD_UPVALUE',
  'LOAD_THIS',
  'MOVE',
  'GET_PROP',
  'DELETE_PROP',
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
  'UNARY_NEG',
  'UNARY_POS',
  'UNARY_NOT',
  'UNARY_BITNOT',
  'TYPEOF',
  'VOID',
  'TYPEOF_SAFE',
  'CALL',
  'CALL_METHOD',
  'NEW',
  'MAKE_CLOSURE',
  'BUILD_ARRAY',
  'BUILD_OBJECT',
  'FOR_IN_SETUP',
  'FOR_IN_NEXT',
])

export class ClosureLifetimeDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ClosureLifetimeDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new ClosureLifetimeDecline(code, message)
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export function cloneData(value) {
  if (Array.isArray(value)) return value.map((child) => cloneData(child))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneData(child)]),
    )
  }
  return value
}

export function register(index) {
  return { kind: 'register', index }
}

export function destinationFor(instruction) {
  return instruction.destination ?? instruction.operands[0]
}

export function sortedNumbers(values) {
  return [...values].sort((left, right) => left - right)
}

export function sortedStrings(values) {
  return [...values].sort()
}
