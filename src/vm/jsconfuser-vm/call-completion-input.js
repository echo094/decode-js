export const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
export const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'
export const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'
export const CFG_SCHEMA = 'jsconfuser-vm-cfg.v1'
export const CALL_FRAME_SCHEMA = 'jsconfuser-vm-call-frames.v1'
export const CLOSURE_LIFETIME_SCHEMA = 'jsconfuser-vm-closure-lifetimes.v1'
export const CALL_COMPLETION_SCHEMA = 'jsconfuser-vm-call-completion.v1'

const CALL_SPREAD = 65535

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

export const CALL_NAMES = new Set(['CALL', 'CALL_METHOD', 'NEW'])
export const COMPLETION_NAMES = new Set(['RETURN', 'THROW'])
export const RELEVANT_NAMES = new Set([...CALL_NAMES, ...COMPLETION_NAMES])

export const ALL_OPCODE_NAMES = Object.freeze(Object.keys(CANONICAL_OPCODES))
export const OMITTED_OPCODE_GROUPS = Object.freeze([
  {
    boundary: 'non-call-completion',
    names: Object.freeze(
      ALL_OPCODE_NAMES.filter((name) => !RELEVANT_NAMES.has(name)),
    ),
  },
])

export class CallCompletionDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CallCompletionDecline'
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

export function ownerMaps(functions, cfg) {
  const ownerByPc = new Map()
  const functionById = new Map()
  for (const fn of functions.functions) {
    functionById.set(fn.id, fn)
    for (const pc of fn.instructionPcs) {
      ownerByPc.set(pc, fn.id)
    }
  }

  const reachable = new Set()
  for (const fn of cfg.functions) {
    const edgesBySource = new Map()
    for (const edge of fn.edges) {
      const edges = edgesBySource.get(edge.sourcePc) ?? []
      edges.push(edge)
      edgesBySource.set(edge.sourcePc, edges)
    }
    const seen = new Set([fn.startPc])
    const queue = [fn.startPc]
    while (queue.length > 0) {
      const pc = queue.shift()
      for (const edge of edgesBySource.get(pc) ?? []) {
        if (edge.targetPc !== null && !seen.has(edge.targetPc)) {
          seen.add(edge.targetPc)
          queue.push(edge.targetPc)
        }
      }
    }
    for (const pc of seen) reachable.add(`${fn.id}:${pc}`)
  }
  return { ownerByPc, functionById, reachable }
}

export function functionOwner(functionId, functionById) {
  const fn = functionById.get(functionId)

  return {
    functionId: fn.id,
    kind: fn.kind,
    startPc: fn.startPc,
    endPc: fn.endPc,
    parentFunctionId: fn.parentFunctionId,
    regCount: fn.regCount,
    paramCount: fn.paramCount,
    captureCount: fn.captureCount,
    hasRest: fn.hasRest,
  }
}

export function instructionLeaf(instruction, functionId, reachable) {
  return {
    id: `instruction:${functionId}:${instruction.pc}`,
    functionId,
    pc: instruction.pc,
    name: instruction.name,
    opcode: cloneData(instruction.opcode),
    words: [...instruction.words],
    width: instruction.width,
    nextPc: instruction.nextPc,
    operands: cloneData(instruction.operands),
    wordOperands: cloneData(instruction.wordOperands),
    reachable,
    kind: RELEVANT_NAMES.has(instruction.name)
      ? instruction.name.toLowerCase()
      : 'opaque-instruction',
    semanticBoundary: 'later-packet',
  }
}

export function callGrammar(instruction, callSite) {
  const method = instruction.name === 'CALL_METHOD'
  const argcIndex = method ? 4 : 3
  const payloadStart = argcIndex + 1
  const argcWord = instruction.words[argcIndex]
  const spread = callSite.arguments.kind === 'spread'

  const payloadWords = instruction.words.slice(payloadStart)

  return {
    kind: spread ? 'spread' : 'fixed',
    argcWord,
    sentinel: spread ? CALL_SPREAD : null,
    operandOffset: payloadStart,
    payloadWords,
    count: spread ? null : argcWord,
    arrayRegister:
      spread && callSite.arguments.arrayRegister
        ? cloneData(callSite.arguments.arrayRegister)
        : null,
    registers:
      !spread && callSite.arguments.registers
        ? cloneData(callSite.arguments.registers)
        : [],
  }
}
