export const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
export const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'
export const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'
export const CFG_SCHEMA = 'jsconfuser-vm-cfg.v1'
export const CALL_FRAME_SCHEMA = 'jsconfuser-vm-call-frames.v1'
export const PROPERTY_COLLECTION_SCHEMA =
  'jsconfuser-vm-property-collections.v1'

const CANONICAL_OPCODES = Object.freeze({
  LOAD_CONST: 0,
  LOAD_INT: 1,
  LOAD_GLOBAL: 2,
  LOAD_UPVALUE: 3,
  LOAD_THIS: 4,
  MOVE: 5,
  STORE_GLOBAL: 6,
  STORE_UPVALUE: 7,
  GET_PROP: 8,
  SET_PROP: 9,
  DELETE_PROP: 10,
  ADD: 11,
  SUB: 12,
  MUL: 13,
  DIV: 14,
  MOD: 15,
  EXP: 60,
  BAND: 16,
  BOR: 17,
  BXOR: 18,
  SHL: 19,
  SHR: 20,
  USHR: 21,
  LT: 22,
  GT: 23,
  LTE: 24,
  GTE: 25,
  EQ: 26,
  NEQ: 27,
  LOOSE_EQ: 28,
  LOOSE_NEQ: 29,
  IN: 30,
  INSTANCEOF: 31,
  UNARY_NEG: 32,
  UNARY_POS: 33,
  UNARY_NOT: 34,
  UNARY_BITNOT: 35,
  TYPEOF: 36,
  VOID: 37,
  TYPEOF_SAFE: 38,
  JUMP: 39,
  JUMP_IF_FALSE: 40,
  JUMP_IF_TRUE: 41,
  CALL: 42,
  CALL_METHOD: 43,
  NEW: 44,
  RETURN: 45,
  THROW: 46,
  MAKE_CLOSURE: 47,
  BUILD_ARRAY: 48,
  BUILD_OBJECT: 49,
  DEFINE_GETTER: 50,
  DEFINE_SETTER: 51,
  FOR_IN_SETUP: 52,
  FOR_IN_NEXT: 53,
  TRY_SETUP: 54,
  TRY_END: 55,
  PATCH: 56,
  DEBUGGER: 57,
  JUMP_REG: 58,
  FINALLY_SETUP: 59,
})

export const J_OPCODE_DEFINITIONS = Object.freeze(
  [
    {
      name: 'GET_PROP',
      family: 'property',
      operandForm: 'dst, obj, key',
      operation: 'get-property',
      effect: 'property-read',
      resultType: 'dynamic',
      known: false,
      evaluationRoles: ['object', 'key'],
    },
    {
      name: 'SET_PROP',
      family: 'property',
      operandForm: 'obj, key, val',
      operation: 'set-property',
      effect: 'property-write',
      resultType: 'no-register-result',
      known: false,
      evaluationRoles: ['object', 'key', 'value'],
    },
    {
      name: 'DELETE_PROP',
      family: 'property',
      operandForm: 'dst, obj, key',
      operation: 'delete-property',
      effect: 'property-delete',
      resultType: 'boolean',
      known: false,
      evaluationRoles: ['object', 'key'],
    },
    {
      name: 'IN',
      family: 'membership',
      operandForm: 'dst, src1, src2',
      operation: 'membership-test',
      effect: 'property-membership-read',
      resultType: 'boolean',
      known: false,
      evaluationRoles: ['propertyKey', 'object'],
    },
    {
      name: 'INSTANCEOF',
      family: 'prototype-relation',
      operandForm: 'dst, src1, src2',
      operation: 'instanceof-test',
      effect: 'prototype-relation-read',
      resultType: 'boolean',
      known: false,
      evaluationRoles: ['instance', 'constructor'],
    },
    {
      name: 'BUILD_ARRAY',
      family: 'collection',
      operandForm: 'dst, count, elemRegs',
      operation: 'build-array',
      effect: 'array-construction',
      resultType: 'array',
      known: false,
      evaluationRoles: ['elements'],
    },
    {
      name: 'BUILD_OBJECT',
      family: 'collection',
      operandForm: 'dst, pairCount, key/value regs',
      operation: 'build-object',
      effect: 'object-construction',
      resultType: 'object',
      known: false,
      evaluationRoles: ['pairs'],
    },
    {
      name: 'DEFINE_GETTER',
      family: 'accessor',
      operandForm: 'obj, key, fn',
      operation: 'define-getter',
      effect: 'accessor-definition',
      resultType: 'no-register-result',
      known: false,
      evaluationRoles: ['object', 'key', 'function'],
    },
    {
      name: 'DEFINE_SETTER',
      family: 'accessor',
      operandForm: 'obj, key, fn',
      operation: 'define-setter',
      effect: 'accessor-definition',
      resultType: 'no-register-result',
      known: false,
      evaluationRoles: ['object', 'key', 'function'],
    },
    {
      name: 'FOR_IN_SETUP',
      family: 'enumeration',
      operandForm: 'dst, src',
      operation: 'for-in-setup',
      effect: 'iterator-creation',
      resultType: 'iterator',
      known: false,
      evaluationRoles: ['source'],
    },
    {
      name: 'FOR_IN_NEXT',
      family: 'enumeration',
      operandForm: 'dst, iter, label(exit)',
      operation: 'for-in-next',
      effect: 'iterator-step',
      resultType: 'property-key-or-exit',
      known: false,
      evaluationRoles: ['iterator', 'exit'],
    },
  ].map((definition) =>
    Object.freeze({
      ...definition,
      opcode: CANONICAL_OPCODES[definition.name],
    }),
  ),
)

export const J_DEFINITION_BY_NAME = new Map(
  J_OPCODE_DEFINITIONS.map((definition) => [definition.name, definition]),
)

export const EXCLUDED_OPCODE_GROUPS = Object.freeze(
  [
    {
      boundary: 'receiver/L-scope',
      names: ['LOAD_THIS'],
    },
    {
      boundary: 'upvalue-closure-state',
      names: ['LOAD_UPVALUE', 'STORE_UPVALUE'],
    },
    {
      boundary: 'I-scalar-value',
      names: [
        'LOAD_CONST',
        'LOAD_INT',
        'LOAD_GLOBAL',
        'MOVE',
        'STORE_GLOBAL',
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
        'UNARY_NEG',
        'UNARY_POS',
        'UNARY_NOT',
        'UNARY_BITNOT',
        'TYPEOF',
        'VOID',
        'TYPEOF_SAFE',
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
    {
      boundary: 'M-closures',
      names: ['MAKE_CLOSURE'],
    },
    {
      boundary: 'H-handler-finally',
      names: ['TRY_SETUP', 'TRY_END', 'FINALLY_SETUP'],
    },
    {
      boundary: 'hardening-only',
      names: ['PATCH'],
    },
    {
      boundary: 'debug-statement',
      names: ['DEBUGGER'],
    },
  ].map((group) =>
    Object.freeze({ ...group, names: Object.freeze(group.names) }),
  ),
)

export const EXCLUDED_OPCODE_NAMES = new Set(
  EXCLUDED_OPCODE_GROUPS.flatMap(({ names }) => names),
)

export class PropertyCollectionsDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PropertyCollectionsDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new PropertyCollectionsDecline(code, message)
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

function copyOperand(operand) {
  return { ...operand }
}

export function reachablePcs(cfg) {
  const reachable = new Map()
  for (const fn of cfg.functions) {
    const edgesBySource = new Map()
    for (const edge of fn.edges) {
      const edges = edgesBySource.get(edge.sourcePc) ?? []
      edges.push(edge)
      edgesBySource.set(edge.sourcePc, edges)
    }
    const seen = new Set([fn.startPc])
    const queue = [fn.startPc]
    while (queue.length) {
      const pc = queue.shift()
      for (const edge of edgesBySource.get(pc) ?? []) {
        if (edge.targetPc !== null && !seen.has(edge.targetPc)) {
          seen.add(edge.targetPc)
          queue.push(edge.targetPc)
        }
      }
    }
    for (const pc of seen) reachable.set(`${fn.id}:${pc}`, true)
  }
  return reachable
}

export function ownerByPc(functions) {
  return new Map(
    functions.ownership.map(({ pc, functionId }) => [String(pc), functionId]),
  )
}

export function operationOperands(instruction) {
  return instruction.operands.map(copyOperand)
}

export function destinationFor(name, operands) {
  if (['SET_PROP', 'DEFINE_GETTER', 'DEFINE_SETTER'].includes(name)) return null
  return register(operands[0].index, `${name} destination`)
}

export function inputIndexes(name, operands) {
  if (name === 'GET_PROP' || name === 'DELETE_PROP') return [1, 2]
  if (
    name === 'SET_PROP' ||
    name === 'DEFINE_GETTER' ||
    name === 'DEFINE_SETTER'
  ) {
    return [0, 1, 2]
  }
  if (name === 'IN' || name === 'INSTANCEOF') return [1, 2]
  if (name === 'BUILD_ARRAY')
    return Array.from({ length: operands.length - 2 }, (_, index) => index + 2)
  if (name === 'BUILD_OBJECT')
    return Array.from({ length: operands.length - 2 }, (_, index) => index + 2)
  if (name === 'FOR_IN_SETUP') return [1]
  if (name === 'FOR_IN_NEXT') return [1]
  return []
}

function roleValue(role, operand, operandIndex) {
  return { role, operand: operandIndex, register: { ...operand } }
}

export function operandRoles(name, operands) {
  if (name === 'GET_PROP' || name === 'DELETE_PROP') {
    return {
      object: roleValue('object', operands[1], 1),
      key: roleValue('key', operands[2], 2),
      result: roleValue('result', operands[0], 0),
    }
  }
  if (name === 'SET_PROP') {
    return {
      object: roleValue('object', operands[0], 0),
      key: roleValue('key', operands[1], 1),
      value: roleValue('value', operands[2], 2),
    }
  }
  if (name === 'IN') {
    return {
      propertyKey: roleValue('propertyKey', operands[1], 1),
      object: roleValue('object', operands[2], 2),
      result: roleValue('result', operands[0], 0),
    }
  }
  if (name === 'INSTANCEOF') {
    return {
      instance: roleValue('instance', operands[1], 1),
      constructor: roleValue('constructor', operands[2], 2),
      result: roleValue('result', operands[0], 0),
    }
  }
  if (name === 'BUILD_ARRAY') {
    return {
      result: roleValue('result', operands[0], 0),
      elements: operands
        .slice(2)
        .map((operand, index) =>
          roleValue(`element[${index}]`, operand, index + 2),
        ),
    }
  }
  if (name === 'BUILD_OBJECT') {
    return {
      result: roleValue('result', operands[0], 0),
      pairs: Array.from({ length: operands[1].value }, (_, pairIndex) => ({
        pairIndex,
        key: roleValue('key', operands[2 + pairIndex * 2], 2 + pairIndex * 2),
        value: roleValue(
          'value',
          operands[3 + pairIndex * 2],
          3 + pairIndex * 2,
        ),
      })),
    }
  }
  if (name === 'DEFINE_GETTER' || name === 'DEFINE_SETTER') {
    return {
      object: roleValue('object', operands[0], 0),
      key: roleValue('key', operands[1], 1),
      accessorFunction: roleValue('function', operands[2], 2),
    }
  }
  if (name === 'FOR_IN_SETUP') {
    return {
      iterator: roleValue('iterator', operands[0], 0),
      source: roleValue('source', operands[1], 1),
    }
  }
  return {
    key: roleValue('key', operands[0], 0),
    iterator: roleValue('iterator', operands[1], 1),
    exit: { role: 'exit', operand: 2, targetPc: operands[2].pc },
  }
}

export function evaluationOrder(name, operands) {
  const roles =
    name === 'BUILD_ARRAY'
      ? operands.slice(2).map((_, index) => `element[${index}]`)
      : name === 'BUILD_OBJECT'
        ? Array.from({ length: operands[1].value }, (_, index) => [
            `pair[${index}].key`,
            `pair[${index}].value`,
          ]).flat()
        : name === 'FOR_IN_NEXT'
          ? ['iterator', 'exit']
          : J_DEFINITION_BY_NAME.get(name).evaluationRoles
  const roleMap = operandRoles(name, operands)
  const registerForRole = (role) => {
    if (role.startsWith('element[')) {
      return roleMap.elements[Number(role.slice(8, -1))].register
    }
    const pairMatch = role.match(/^pair\[(\d+)\]\.(key|value)$/)
    if (pairMatch) {
      const pair = roleMap.pairs[Number(pairMatch[1])]
      return pair[pairMatch[2]].register
    }
    if (role === 'exit') return null
    return roleMap[role]?.register ?? null
  }
  return {
    kind: 'left-to-right-register-read',
    roles,
    steps: roles.map((role, index) => ({
      order: index,
      role,
      register: registerForRole(role),
    })),
    caveat:
      'This is compiler/runtime operand-read order; dynamic coercion, getters, proxies, and prototype lookup are not evaluated here.',
  }
}
