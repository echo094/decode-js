export const VM_SWITCH_SCHEMA = 'decode-js-vm-switch.v1'

// A node (one case) whose operation is an unconditional jump is a step of straight-line flow: it
// runs nothing, so a reader that follows control or compares where flow arrives looks through it
// whether the producer laid the target out next or elsewhere (vm-switch-boundary.md, section 1).
export function isJumpStep(node) {
  return node?.instruction.operation.kind === 'jump'
}

export class VmSwitchDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'VmSwitchDecline'
    this.code = code
  }
}
