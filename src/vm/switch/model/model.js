import { declines } from '../../decline.js'

export const VM_SWITCH_SCHEMA = 'decode-js-vm-switch.v1'

// A node (one case) whose operation is an unconditional jump is a step of straight-line flow: it
// runs nothing, so a reader that follows control or compares where flow arrives looks through it
// whether the producer laid the target out next or elsewhere.
export function isJumpStep(node) {
  return node?.instruction.operation.kind === 'jump'
}

// The backend's refusals: a model it cannot recover declines the whole decode.
export const { decline, requireValue } = declines('vm-switch')
