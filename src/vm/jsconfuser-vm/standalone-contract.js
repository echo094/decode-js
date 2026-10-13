export class StandaloneDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StandaloneDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new StandaloneDecline(code, message)
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export function requireValue(value, code, message) {
  if (!value) decline(code, message)
  return value
}
