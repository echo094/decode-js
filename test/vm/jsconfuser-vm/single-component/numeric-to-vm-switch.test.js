import { expect, test } from 'vitest'
import { diagnoseStandaloneInput } from '../../../../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { numericToVmSwitch } from '../../../../src/vm/jsconfuser-vm/numeric-to-vm-switch.js'

// A hand-written boot: the VM construction carries the words and the pool, and the start call
// receives it with the root descriptor. The words hold `window.TEST_OUTPUT = 1 + 2`.
const source = `var vm = new VM(
  [4, 1, 2, 2, 0, 0, 0, 3, 1, 0, 0, 4, 2, 0, 0, 5, 3, 0, 11, 6, 4, 5, 9, 2, 3, 6, 0, 2, 4, 0, 45, 2],
  ['window', 'TEST_OUTPUT', 1, 2, undefined],
);
run(vm, new Closure({ startPc: 0, paramCount: 0, regCount: 7 }));`

// The handoff carries operations only: the serialized opcode and operand words stay behind, and
// control is the backend's to solve.
test('the numeric frontend hands over operations without serialized words', () => {
  const preflight = diagnoseStandaloneInput(source)
  expect(preflight.ok, JSON.stringify(preflight.diagnostic)).toBe(true)
  const model = numericToVmSwitch(preflight.model)
  const cases = [...model.instructionsByFunction.values()].flat()
  expect(cases).toHaveLength(9)
  for (const item of cases)
    expect(Object.keys(item).sort()).toEqual(['nextPc', 'operation', 'pc'])
  expect(model).not.toHaveProperty('controlByFunction')
  expect(model).not.toHaveProperty('structuredControl')
})
