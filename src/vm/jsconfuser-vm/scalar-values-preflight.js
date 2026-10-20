import { CANONICAL_OPCODES } from './opcode-table.js'
export const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
export const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'
export const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'
export const CFG_SCHEMA = 'jsconfuser-vm-cfg.v1'
export const SCALAR_VALUES_SCHEMA = 'jsconfuser-vm-scalar-values.v1'

export const I_OPCODE_DEFINITIONS = Object.freeze(
  [
    {
      name: 'LOAD_CONST',
      family: 'load',
      operandForm: 'dst, constant(value)',
      operandKinds: ['register', 'constant-ref'],
      operation: 'load-constant',
      effect: 'register-write',
      resultType: 'constant',
      known: true,
    },
    {
      name: 'LOAD_INT',
      family: 'load',
      operandForm: 'dst, number or label',
      operandKinds: ['register', 'immediate'],
      operation: 'load-integer',
      effect: 'register-write',
      resultType: 'integer',
      known: true,
    },
    {
      name: 'LOAD_GLOBAL',
      family: 'load',
      operandForm: 'dst, constant(name)',
      operandKinds: ['register', 'constant-ref'],
      operation: 'load-global',
      effect: 'global-read',
      resultType: 'dynamic',
      known: false,
    },
    {
      name: 'MOVE',
      family: 'move',
      operandForm: 'dst, src',
      operandKinds: ['register', 'register'],
      operation: 'move',
      effect: 'register-write',
      resultType: 'copy',
      known: false,
    },
    {
      name: 'STORE_GLOBAL',
      family: 'global-mutation',
      operandForm: 'constant(name), src',
      operandKinds: ['constant-ref', 'register'],
      operation: 'store-global',
      effect: 'global-write',
      resultType: 'input',
      known: false,
    },
    {
      name: 'ADD',
      family: 'arithmetic',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'add',
      effect: 'register-write',
      resultType: 'dynamic',
      known: false,
    },
    {
      name: 'SUB',
      family: 'arithmetic',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'subtract',
      effect: 'register-write',
      resultType: 'dynamic',
      known: false,
    },
    {
      name: 'MUL',
      family: 'arithmetic',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'multiply',
      effect: 'register-write',
      resultType: 'dynamic',
      known: false,
    },
    {
      name: 'DIV',
      family: 'arithmetic',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'divide',
      effect: 'register-write',
      resultType: 'dynamic',
      known: false,
    },
    {
      name: 'MOD',
      family: 'arithmetic',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'modulo',
      effect: 'register-write',
      resultType: 'dynamic',
      known: false,
    },
    {
      name: 'EXP',
      family: 'arithmetic',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'exponentiate',
      effect: 'register-write',
      resultType: 'dynamic',
      known: false,
    },
    {
      name: 'BAND',
      family: 'bitwise',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'bitwise-and',
      effect: 'register-write',
      resultType: 'number',
      known: false,
    },
    {
      name: 'BOR',
      family: 'bitwise',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'bitwise-or',
      effect: 'register-write',
      resultType: 'number',
      known: false,
    },
    {
      name: 'BXOR',
      family: 'bitwise',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'bitwise-xor',
      effect: 'register-write',
      resultType: 'number',
      known: false,
    },
    {
      name: 'SHL',
      family: 'bitwise',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'shift-left',
      effect: 'register-write',
      resultType: 'number',
      known: false,
    },
    {
      name: 'SHR',
      family: 'bitwise',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'shift-right',
      effect: 'register-write',
      resultType: 'number',
      known: false,
    },
    {
      name: 'USHR',
      family: 'bitwise',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'unsigned-shift-right',
      effect: 'register-write',
      resultType: 'number',
      known: false,
    },
    {
      name: 'LT',
      family: 'relational',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'less-than',
      effect: 'register-write',
      resultType: 'boolean',
      known: false,
    },
    {
      name: 'GT',
      family: 'relational',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'greater-than',
      effect: 'register-write',
      resultType: 'boolean',
      known: false,
    },
    {
      name: 'LTE',
      family: 'relational',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'less-than-or-equal',
      effect: 'register-write',
      resultType: 'boolean',
      known: false,
    },
    {
      name: 'GTE',
      family: 'relational',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'greater-than-or-equal',
      effect: 'register-write',
      resultType: 'boolean',
      known: false,
    },
    {
      name: 'EQ',
      family: 'equality',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'strict-equal',
      effect: 'register-write',
      resultType: 'boolean',
      known: false,
    },
    {
      name: 'NEQ',
      family: 'equality',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'strict-not-equal',
      effect: 'register-write',
      resultType: 'boolean',
      known: false,
    },
    {
      name: 'LOOSE_EQ',
      family: 'equality',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'loose-equal',
      effect: 'register-write',
      resultType: 'boolean',
      known: false,
    },
    {
      name: 'LOOSE_NEQ',
      family: 'equality',
      operandForm: 'dst, src1, src2',
      operandKinds: ['register', 'register', 'register'],
      operation: 'loose-not-equal',
      effect: 'register-write',
      resultType: 'boolean',
      known: false,
    },
    {
      name: 'UNARY_NEG',
      family: 'unary',
      operandForm: 'dst, src',
      operandKinds: ['register', 'register'],
      operation: 'unary-negate',
      effect: 'register-write',
      resultType: 'number',
      known: false,
    },
    {
      name: 'UNARY_POS',
      family: 'unary',
      operandForm: 'dst, src',
      operandKinds: ['register', 'register'],
      operation: 'unary-positive',
      effect: 'register-write',
      resultType: 'number',
      known: false,
    },
    {
      name: 'UNARY_NOT',
      family: 'unary',
      operandForm: 'dst, src',
      operandKinds: ['register', 'register'],
      operation: 'logical-not',
      effect: 'register-write',
      resultType: 'boolean',
      known: false,
    },
    {
      name: 'UNARY_BITNOT',
      family: 'unary',
      operandForm: 'dst, src',
      operandKinds: ['register', 'register'],
      operation: 'bitwise-not',
      effect: 'register-write',
      resultType: 'number',
      known: false,
    },
    {
      name: 'TYPEOF',
      family: 'conversion',
      operandForm: 'dst, src',
      operandKinds: ['register', 'register'],
      operation: 'typeof',
      effect: 'register-write',
      resultType: 'string',
      known: false,
    },
    {
      name: 'VOID',
      family: 'conversion',
      operandForm: 'dst, src',
      operandKinds: ['register', 'register'],
      operation: 'void',
      effect: 'register-write',
      resultType: 'undefined',
      known: true,
    },
    {
      name: 'TYPEOF_SAFE',
      family: 'conversion',
      operandForm: 'dst, constant(globalName)',
      operandKinds: ['register', 'constant-ref'],
      operation: 'typeof-safe-global',
      effect: 'global-read',
      resultType: 'string',
      known: false,
    },
  ].map((definition) =>
    Object.freeze({
      ...definition,
      opcode: CANONICAL_OPCODES[definition.name],
    }),
  ),
)

export const I_DEFINITION_BY_NAME = new Map(
  I_OPCODE_DEFINITIONS.map((definition) => [definition.name, definition]),
)

export const EXCLUDED_OPCODE_GROUPS = Object.freeze(
  [
    {
      boundary: 'G-closure-state',
      names: ['LOAD_UPVALUE', 'STORE_UPVALUE'],
    },
    { boundary: 'receiver/call-emission', names: ['LOAD_THIS'] },
    {
      boundary: 'J-property-prototype-collection',
      names: [
        'GET_PROP',
        'SET_PROP',
        'DELETE_PROP',
        'IN',
        'INSTANCEOF',
        'BUILD_ARRAY',
        'BUILD_OBJECT',
        'DEFINE_GETTER',
        'DEFINE_SETTER',
        'FOR_IN_SETUP',
        'FOR_IN_NEXT',
      ],
    },
    {
      boundary: 'K-control-flow',
      names: ['JUMP', 'JUMP_IF_FALSE', 'JUMP_IF_TRUE', 'JUMP_REG'],
    },
    {
      boundary: 'L-calls-and-completion',
      names: ['CALL', 'CALL_METHOD', 'NEW', 'RETURN', 'THROW'],
    },
    { boundary: 'M-closures', names: ['MAKE_CLOSURE'] },
    {
      boundary: 'H-handler-finally',
      names: ['TRY_SETUP', 'TRY_END', 'FINALLY_SETUP'],
    },
    { boundary: 'hardening-only', names: ['PATCH'] },
    { boundary: 'debug-statement', names: ['DEBUGGER'] },
  ].map((group) =>
    Object.freeze({ ...group, names: Object.freeze(group.names) }),
  ),
)

export const EXCLUDED_OPCODE_NAMES = new Set(
  EXCLUDED_OPCODE_GROUPS.flatMap(({ names }) => names),
)

export class ScalarValuesDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ScalarValuesDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new ScalarValuesDecline(code, message)
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}
