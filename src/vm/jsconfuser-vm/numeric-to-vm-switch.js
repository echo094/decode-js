import { VM_SWITCH_SCHEMA } from '../switch/vm-switch-model.js'

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

function lower(instruction, model) {
  const { name, operands: o } = instruction
  const values = model.constants
  if (name === 'LOAD_CONST')
    return {
      kind: 'assign',
      destination: reg(o[0]),
      value: { kind: 'literal', value: constant(o[1], values) },
    }
  if (name === 'LOAD_INT')
    return {
      kind: 'assign',
      destination: reg(o[0]),
      value: { kind: 'literal', value: immediate(o[1]) },
    }
  if (name === 'LOAD_THIS')
    return { kind: 'assign', destination: reg(o[0]), value: { kind: 'this' } }
  if (name === 'MOVE')
    return {
      kind: 'assign',
      destination: reg(o[0]),
      value: { kind: 'register', index: reg(o[1]) },
    }
  if (name === 'LOAD_GLOBAL')
    return {
      kind: 'global-read',
      destination: reg(o[0]),
      name: globalName(o[1], values),
    }
  if (name === 'STORE_GLOBAL')
    return {
      kind: 'global-write',
      name: globalName(o[0], values),
      source: reg(o[1]),
    }
  if (name === 'TYPEOF_SAFE')
    return {
      kind: 'safe-typeof',
      destination: reg(o[0]),
      name: globalName(o[1], values),
    }
  if (name === 'LOAD_UPVALUE')
    return {
      kind: 'upvalue-read',
      destination: reg(o[0]),
      index: index(o[1]),
    }
  if (name === 'STORE_UPVALUE')
    return {
      kind: 'upvalue-write',
      index: index(o[0]),
      source: reg(o[1]),
    }
  if (name === 'GET_PROP')
    return {
      kind: 'property-read',
      destination: reg(o[0]),
      object: reg(o[1]),
      key: reg(o[2]),
    }
  if (name === 'SET_PROP')
    return {
      kind: 'property-write',
      object: reg(o[0]),
      key: reg(o[1]),
      value: reg(o[2]),
    }
  if (name === 'DELETE_PROP')
    return {
      kind: 'property-delete',
      destination: reg(o[0]),
      object: reg(o[1]),
      key: reg(o[2]),
    }
  if (BINARY[name])
    return {
      kind: 'assign',
      destination: reg(o[0]),
      value: {
        kind: 'binary',
        operator: BINARY[name],
        left: reg(o[1]),
        right: reg(o[2]),
      },
    }
  if (UNARY[name])
    return {
      kind: 'assign',
      destination: reg(o[0]),
      value: { kind: 'unary', operator: UNARY[name], source: reg(o[1]) },
    }
  if (name === 'TYPEOF')
    return {
      kind: 'assign',
      destination: reg(o[0]),
      value: { kind: 'typeof', source: reg(o[1]) },
    }
  if (name === 'VOID')
    return {
      kind: 'assign',
      destination: reg(o[0]),
      value: { kind: 'undefined' },
    }
  if (name === 'JUMP') return { kind: 'jump', target: target(o[0]) }
  if (name === 'JUMP_IF_FALSE' || name === 'JUMP_IF_TRUE')
    return {
      kind: 'branch',
      condition: reg(o[0]),
      when: name === 'JUMP_IF_FALSE' ? 'false' : 'true',
      target: target(o[1]),
    }
  if (name === 'JUMP_REG') return { kind: 'indirect-jump', source: reg(o[0]) }
  if (name === 'RETURN') return { kind: 'return', source: reg(o[0]) }
  if (name === 'THROW') return { kind: 'throw', source: reg(o[0]) }
  if (name === 'CALL' || name === 'CALL_METHOD' || name === 'NEW')
    return lowerCall(instruction)
  if (name === 'MAKE_CLOSURE')
    return {
      kind: 'closure',
      destination: reg(o[0]),
      entry: target(o[1]),
      captures: o
        .slice(6)
        .map((capture) => ({ kind: capture.kind, index: capture.index })),
    }
  if (name === 'BUILD_ARRAY')
    return {
      kind: 'array',
      destination: reg(o[0]),
      elements: o.slice(2).map(reg),
    }
  if (name === 'BUILD_OBJECT')
    return {
      kind: 'object',
      destination: reg(o[0]),
      pairs: Array.from({ length: immediate(o[1]) }, (_, i) => ({
        key: reg(o[2 + i * 2]),
        value: reg(o[3 + i * 2]),
      })),
    }
  if (name === 'DEFINE_GETTER' || name === 'DEFINE_SETTER')
    return {
      kind: 'accessor',
      accessor: name === 'DEFINE_GETTER' ? 'get' : 'set',
      object: reg(o[0]),
      key: reg(o[1]),
      callback: reg(o[2]),
    }
  if (name === 'FOR_IN_SETUP')
    return { kind: 'for-in-setup', destination: reg(o[0]), source: reg(o[1]) }
  if (name === 'FOR_IN_NEXT')
    return {
      kind: 'for-in-next',
      destination: reg(o[0]),
      iterator: reg(o[1]),
      exit: target(o[2]),
    }
  if (name === 'TRY_SETUP')
    return {
      kind: 'catch-setup',
      target: target(o[0]),
      exceptionRegister: reg(o[1]),
    }
  if (name === 'TRY_END') return { kind: 'handler-pop' }
  if (name === 'FINALLY_SETUP')
    return {
      kind: 'finally-setup',
      target: target(o[0]),
      continuation: reg(o[1]),
      payload: reg(o[2]),
      throwPad: target(o[3]),
    }
  if (name === 'DEBUGGER') return { kind: 'debugger' }
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
