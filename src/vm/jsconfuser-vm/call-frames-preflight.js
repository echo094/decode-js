export const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
export const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'
export const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'
export const CFG_SCHEMA = 'jsconfuser-vm-cfg.v1'

export const CALL_NAMES = new Set(['CALL', 'CALL_METHOD', 'NEW'])

export const REGISTER_DESTINATION_NAMES = new Set([
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

export class CallFrameDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CallFrameDecline'
    this.code = code
  }
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

export function indexReferences(references) {
  return {
    frame: references.frame,
    descriptors: references.frame.descriptors,
    descriptorsByStart: new Map(
      references.frame.descriptors.map((descriptor) => [
        descriptor.startPc,
        descriptor,
      ]),
    ),
  }
}

export function indexFunctions(functionsResult) {
  const functions = functionsResult.functions
  return {
    functions,
    functionById: new Map(functions.map((fn) => [fn.id, fn])),
    ownerByPc: new Map(
      functionsResult.ownership.map(({ pc, functionId }) => [pc, functionId]),
    ),
    closureSitesByPc: new Map(
      functions
        .flatMap((fn) => fn.closureSites)
        .map((site) => [site.creationPc, site]),
    ),
  }
}
