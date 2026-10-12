export const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
export const CFG_SCHEMA = 'jsconfuser-vm-cfg.v1'
export const EXCEPTION_FINALLY_SCHEMA = 'jsconfuser-vm-exception-finally.v1'
export const STRUCTURED_CONTROL_SCHEMA = 'jsconfuser-vm-structured-control.v1'

export class StructuredControlDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StructuredControlDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new StructuredControlDecline(code, message)
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

export function arrayEqual(left, right) {
  return sameValue(left, right)
}
