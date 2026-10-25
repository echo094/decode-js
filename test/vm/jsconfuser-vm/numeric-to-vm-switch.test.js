import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { diagnoseStandaloneInput } from '../../../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { numericToVmSwitch } from '../../../src/vm/jsconfuser-vm/numeric-to-vm-switch.js'

test('numeric frontend removes serialized opcode and operand words at the handoff', () => {
  const path = fileURLToPath(
    new URL('./fixtures/readability/arithmetic/encoded.js', import.meta.url),
  )
  const preflight = diagnoseStandaloneInput(readFileSync(path, 'utf8'))
  expect(preflight.ok).toBe(true)
  const model = numericToVmSwitch(preflight.model)
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
  // Control is the backend's to solve: the handoff carries cases only.
  expect(model).not.toHaveProperty('controlByFunction')
  expect(model).not.toHaveProperty('structuredControl')
})
