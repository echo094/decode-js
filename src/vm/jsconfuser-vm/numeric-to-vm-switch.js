import { VM_SWITCH_SCHEMA } from '../switch/model/model.js'

const BINARY = Object.freeze({
  ADD: '+',
  SUB: '-',
  MUL: '*',
  DIV: '/',
  MOD: '%',
  EXP: '**',
  BAND: '&',
  BOR: '|',
  BXOR: '^',
  SHL: '<<',
  SHR: '>>',
  USHR: '>>>',
  LT: '<',
  GT: '>',
  LTE: '<=',
  GTE: '>=',
  EQ: '===',
  NEQ: '!==',
  LOOSE_EQ: '==',
  LOOSE_NEQ: '!=',
  IN: 'in',
  INSTANCEOF: 'instanceof',
})
const UNARY = Object.freeze({
  UNARY_NEG: '-',
  UNARY_POS: '+',
  UNARY_NOT: '!',
  UNARY_BITNOT: '~',
})

function reg(operand) {
  return operand.index
}

function index(operand) {
  return operand.index
}

function target(operand) {
  return operand.pc
}

function immediate(operand) {
  return operand.value
}

function constant(operand, values) {
  return values[operand.index]
}

function globalName(operand, values) {
  return constant(operand, values)
}

// A plain CALL is the source's `f(...)`: the interpreter's split between its own closures (called
// with its globals) and host functions (applied to null) is its machinery, and the closure shell
// already maps a null `this` to the globals.
function lowerCall(instruction) {
  const { name, operands } = instruction
  const method = name === 'CALL_METHOD'
  const countOffset = method ? 3 : 2
  const countOperand = operands[countOffset]
  const spread = countOperand.kind === 'spread-sentinel'
  const argumentOperands = operands.slice(countOffset + 1)
  return {
    kind: 'call',
    mode: name === 'NEW' ? 'construct' : 'apply',
    destination: reg(operands[0]),
    receiver: method
      ? { kind: 'register', index: reg(operands[1]) }
      : { kind: 'none' },
    callee: reg(operands[method ? 2 : 1]),
    arguments: {
      kind: spread ? 'array-register' : 'fixed',
      registers: argumentOperands.map(reg),
    },
  }
}

const assign = (destination, value) => ({
  kind: 'assign',
  destination: reg(destination),
  value,
})

// Each opcode's lowering, by name: (operands, constant pool, instruction) -> operation.
const LOWERINGS = Object.freeze({
  LOAD_CONST: (o, values) =>
    assign(o[0], { kind: 'literal', value: constant(o[1], values) }),
  LOAD_INT: (o) => assign(o[0], { kind: 'literal', value: immediate(o[1]) }),
  LOAD_THIS: (o) => assign(o[0], { kind: 'this' }),
  MOVE: (o) => assign(o[0], { kind: 'register', index: reg(o[1]) }),
  LOAD_GLOBAL: (o, values) => ({
    kind: 'global-read',
    destination: reg(o[0]),
    name: globalName(o[1], values),
  }),
  STORE_GLOBAL: (o, values) => ({
    kind: 'global-write',
    name: globalName(o[0], values),
    source: reg(o[1]),
  }),
  TYPEOF_SAFE: (o, values) => ({
    kind: 'safe-typeof',
    destination: reg(o[0]),
    name: globalName(o[1], values),
  }),
  LOAD_UPVALUE: (o) => ({
    kind: 'upvalue-read',
    destination: reg(o[0]),
    index: index(o[1]),
  }),
  STORE_UPVALUE: (o) => ({
    kind: 'upvalue-write',
    index: index(o[0]),
    source: reg(o[1]),
  }),
  GET_PROP: (o) => ({
    kind: 'property-read',
    destination: reg(o[0]),
    object: reg(o[1]),
    key: reg(o[2]),
  }),
  SET_PROP: (o) => ({
    kind: 'property-write',
    object: reg(o[0]),
    key: reg(o[1]),
    value: reg(o[2]),
  }),
  DELETE_PROP: (o) => ({
    kind: 'property-delete',
    destination: reg(o[0]),
    object: reg(o[1]),
    key: reg(o[2]),
  }),
  ...Object.fromEntries(
    Object.entries(BINARY).map(([name, operator]) => [
      name,
      (o) =>
        assign(o[0], {
          kind: 'binary',
          operator,
          left: reg(o[1]),
          right: reg(o[2]),
        }),
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(UNARY).map(([name, operator]) => [
      name,
      (o) => assign(o[0], { kind: 'unary', operator, source: reg(o[1]) }),
    ]),
  ),
  TYPEOF: (o) => assign(o[0], { kind: 'typeof', source: reg(o[1]) }),
  VOID: (o) => assign(o[0], { kind: 'undefined' }),
  JUMP: (o) => ({ kind: 'jump', target: target(o[0]) }),
  JUMP_IF_FALSE: (o) => ({
    kind: 'branch',
    condition: reg(o[0]),
    when: 'false',
    target: target(o[1]),
  }),
  JUMP_IF_TRUE: (o) => ({
    kind: 'branch',
    condition: reg(o[0]),
    when: 'true',
    target: target(o[1]),
  }),
  JUMP_REG: (o) => ({ kind: 'indirect-jump', source: reg(o[0]) }),
  RETURN: (o) => ({ kind: 'return', source: reg(o[0]) }),
  THROW: (o) => ({ kind: 'throw', source: reg(o[0]) }),
  CALL: (o, values, instruction) => lowerCall(instruction),
  CALL_METHOD: (o, values, instruction) => lowerCall(instruction),
  NEW: (o, values, instruction) => lowerCall(instruction),
  MAKE_CLOSURE: (o) => ({
    kind: 'closure',
    destination: reg(o[0]),
    entry: target(o[1]),
    captures: o
      .slice(6)
      .map((capture) => ({ kind: capture.kind, index: capture.index })),
  }),
  BUILD_ARRAY: (o) => ({
    kind: 'array',
    destination: reg(o[0]),
    elements: o.slice(2).map(reg),
  }),
  BUILD_OBJECT: (o) => ({
    kind: 'object',
    destination: reg(o[0]),
    pairs: Array.from({ length: immediate(o[1]) }, (_, i) => ({
      key: reg(o[2 + i * 2]),
      value: reg(o[3 + i * 2]),
    })),
  }),
  DEFINE_GETTER: (o) => accessor('get', o),
  DEFINE_SETTER: (o) => accessor('set', o),
  FOR_IN_SETUP: (o) => ({
    kind: 'for-in-setup',
    destination: reg(o[0]),
    source: reg(o[1]),
  }),
  FOR_IN_NEXT: (o) => ({
    kind: 'for-in-next',
    destination: reg(o[0]),
    iterator: reg(o[1]),
    exit: target(o[2]),
  }),
  TRY_SETUP: (o) => ({
    kind: 'catch-setup',
    target: target(o[0]),
    exceptionRegister: reg(o[1]),
  }),
  TRY_END: () => ({ kind: 'handler-pop' }),
  FINALLY_SETUP: (o) => ({
    kind: 'finally-setup',
    target: target(o[0]),
    continuation: reg(o[1]),
    payload: reg(o[2]),
    throwPad: target(o[3]),
  }),
  DEBUGGER: () => ({ kind: 'debugger' }),
})

function accessor(kind, o) {
  return {
    kind: 'accessor',
    accessor: kind,
    object: reg(o[0]),
    key: reg(o[1]),
    callback: reg(o[2]),
  }
}

function lower(instruction, model) {
  const { name, operands } = instruction
  if (!Object.hasOwn(LOWERINGS, name)) return undefined
  return LOWERINGS[name](operands, model.constants, instruction)
}

export function numericToVmSwitch(model) {
  const lowered = new Map()
  const instructionsByFunction = new Map()
  for (const fn of model.functions.functions) {
    const instructions = model.instructionsByFunction.get(fn.id)
    const cases = instructions.map((instruction) => {
      const result = {
        pc: instruction.pc,
        nextPc: instruction.nextPc,
        operation: lower(instruction, model),
      }
      lowered.set(instruction.pc, result)
      return result
    })
    instructionsByFunction.set(fn.id, cases)
  }
  // The compiler ends a try block with TRY_END; JUMP after_catch right before the catch entry.
  // Its target is where the try statement closed in the source; the model carries it as the
  // catch-setup's layout end, a placement only. The backend applies it only to a try with no
  // reachable end (its block always throws, so that exit is dead code), where the reachable graph
  // cannot tell the catch's code from what follows.
  for (const cases of instructionsByFunction.values()) {
    const byNextPc = new Map(cases.map((item) => [item.nextPc, item]))
    for (const { operation } of cases) {
      if (operation.kind !== 'catch-setup') continue
      const jump = byNextPc.get(operation.target)
      const pop = jump && byNextPc.get(jump.pc)
      if (
        jump?.operation.kind === 'jump' &&
        pop?.operation.kind === 'handler-pop'
      )
        operation.layoutEnd = jump.operation.target
    }
  }
  return {
    schemaVersion: VM_SWITCH_SCHEMA,
    storage: {
      kind: 'register-machine',
      functions: model.functions.functions.map((fn) => ({
        id: fn.id,
        registerCount: fn.regCount,
        captureCount: fn.captureCount,
      })),
    },
    functions: model.functions,
    instructionsByFunction,
    instructionCount: lowered.size,
  }
}
