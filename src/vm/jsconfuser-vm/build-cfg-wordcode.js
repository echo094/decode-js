export const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
export const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'
export const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'
export const CFG_SCHEMA = 'jsconfuser-vm-cfg.v1'

export const REGISTER_DESTINATIONS = new Set([
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

const CONDITIONAL_NAMES = new Set([
  'JUMP_IF_FALSE',
  'JUMP_IF_TRUE',
  'FOR_IN_NEXT',
])

export const TERMINATOR_NAMES = new Set([
  'JUMP',
  'JUMP_REG',
  'RETURN',
  'THROW',
  ...CONDITIONAL_NAMES,
])

export class CfgDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CfgDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new CfgDecline(code, message)
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
