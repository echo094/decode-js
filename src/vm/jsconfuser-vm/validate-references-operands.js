export const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'

export const CANONICAL_SLOTS = Object.freeze({
  PC: 0,
  CALLER: 1,
  RET_DST: 2,
  THIS: 3,
  CLOSURE: 4,
  HANDLERS: 5,
  FRAME_SIZE: 6,
  REG_BASE: 7,
})

export class ReferenceDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ReferenceDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new ReferenceDecline(code, message)
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export function containerData(container) {
  return {
    pool: container.roles.pool.values,
    words: container.roles.words.values,
    scalars: Object.fromEntries(
      Object.entries(container.roles.scalars).map(([name, role]) => [
        name,
        role.value,
      ]),
    ),
  }
}
