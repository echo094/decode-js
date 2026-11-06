export const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'

export class PartitionDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PartitionDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new PartitionDecline(code, message)
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export function indexFrame(references) {
  const descriptors = [
    ...new Map(
      references.frame.descriptors.map((descriptor) => [
        descriptor.startPc,
        descriptor,
      ]),
    ).values(),
  ]
  return {
    frame: references.frame,
    descriptors,
    descriptorsByStart: new Map(
      descriptors.map((descriptor) => [descriptor.startPc, descriptor]),
    ),
    labelReferences: references.labels.references,
  }
}
