import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateVmSwitchModel } from '../../../src/vm/switch/vm-switch-model.js'
import { diagnoseStandaloneInput } from '../../../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { numericToVmSwitch } from '../../../src/vm/jsconfuser-vm/numeric-to-vm-switch.js'

test('numeric frontend removes serialized opcode and operand words at the handoff', () => {
  const path = fileURLToPath(
    new URL('./fixtures/readability/arithmetic/encoded.js', import.meta.url),
  )
  const preflight = diagnoseStandaloneInput(readFileSync(path, 'utf8'))
  expect(preflight.ok).toBe(true)
  const model = numericToVmSwitch(preflight.model)
  expect(validateVmSwitchModel(model)).toBe(model)
  expect(model.code.kind).toBe('numeric-u32')
  for (const cases of model.instructionsByFunction.values()) {
    for (const item of cases) {
      expect(item).toHaveProperty('operation')
      expect(item).not.toHaveProperty('name')
      expect(item).not.toHaveProperty('opcode')
      expect(item).not.toHaveProperty('operands')
      expect(item).not.toHaveProperty('wordOperands')
      expect(item).not.toHaveProperty('words')
    }
  }
  for (const control of model.controlByFunction.values())
    for (const block of control.blocks)
      for (const leaf of block.leaves) {
        expect(leaf).not.toHaveProperty('name')
        expect(leaf).not.toHaveProperty('opcode')
        expect(leaf).not.toHaveProperty('wordOperands')
      }
})
