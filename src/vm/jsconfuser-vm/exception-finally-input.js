export const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
export const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'
export const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'
export const CFG_SCHEMA = 'jsconfuser-vm-cfg.v1'
export const CALL_FRAME_SCHEMA = 'jsconfuser-vm-call-frames.v1'
export const EXCEPTION_FINALLY_SCHEMA = 'jsconfuser-vm-exception-finally.v1'

export const COMPLETION_KINDS = new Set([
  'return',
  'throw',
  'handler',
  'finally',
])

export class ExceptionFinallyDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ExceptionFinallyDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new ExceptionFinallyDecline(code, message)
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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function sameValue(actual, expected) {
  if (actual === expected) return true
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return (
      actual.length === expected.length &&
      actual.every((value, index) => sameValue(value, expected[index]))
    )
  }
  if (isObject(actual) && isObject(expected)) {
    const actualKeys = Object.keys(actual)
    const expectedKeys = Object.keys(expected)
    return (
      actualKeys.length === expectedKeys.length &&
      expectedKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(actual, key) &&
          sameValue(actual[key], expected[key]),
      )
    )
  }
  return false
}

export function sortedNumbers(values) {
  return [...values].sort((left, right) => left - right)
}

export function register(index) {
  return { kind: 'register', index }
}

export function recordId(type, setupPc) {
  return `${type === 'handler' ? 'try' : 'finally'}@${setupPc}`
}

function recordView(record) {
  if (record.type === 'handler') {
    return {
      type: 'handler',
      setupPc: record.setupPc,
      handlerPc: record.handlerPc,
      exceptionReg: record.exceptionReg,
    }
  }
  return {
    type: 'finally',
    setupPc: record.setupPc,
    finallyPc: record.finallyPc,
    continuationReg: record.continuationReg,
    payloadReg: record.payloadReg,
    throwPadPc: record.throwPadPc,
  }
}

export function stateView(stack, records) {
  const views = stack.map((id) => {
    const record = records.get(id)
    if (!record)
      decline('invalid-handler-state', `Unknown handler record ${id}`)
    return recordView(record)
  })
  return {
    stack: views,
    finallyStack: views.filter(({ type }) => type === 'finally'),
  }
}

export function indexFunctions(functions) {
  return {
    list: functions.functions,
    byId: new Map(functions.functions.map((fn) => [fn.id, fn])),
    ownerByPc: new Map(
      functions.ownership.map(({ pc, functionId }) => [pc, functionId]),
    ),
    labels: functions.labels,
  }
}
