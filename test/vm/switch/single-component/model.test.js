import { test, expect } from 'vitest'
import { emitVmSwitchProgram } from '../../../../src/vm/switch/to-source.js'
import { runSource, casesOf } from './models.js'

test('code after a return leaves no trace: no block, no function it alone creates, no for-in helper', () => {
  // The compiler's `RESULT = 7; return 7; f = function () { return 1; }; for (k in f);`: the
  // closure and the enumeration after the return are unreachable, and so is the child function.
  const model = casesOf(
    [
      { kind: 'assign', destination: 0, value: { kind: 'literal', value: 7 } },
      { kind: 'global-write', name: 'RESULT', source: 0 },
      { kind: 'return', source: 0 },
      { kind: 'closure', destination: 1, entry: 6, captures: [] },
      { kind: 'for-in-setup', destination: 2, source: 1 },
      { kind: 'return', source: 1 },
    ],
    3,
  )
  model.storage.functions.push({ id: 1, registerCount: 1, captureCount: 0 })
  model.functions.functions.push({
    id: 1,
    startPc: 6,
    regCount: 1,
    paramCount: 0,
    captureCount: 0,
    hasRest: false,
  })
  model.instructionsByFunction.set(1, [
    {
      pc: 6,
      nextPc: 7,
      operation: {
        kind: 'assign',
        destination: 0,
        value: { kind: 'literal', value: 1 },
      },
    },
    { pc: 7, nextPc: 8, operation: { kind: 'return', source: 0 } },
  ])
  model.instructionCount = 8
  const { output, simplification } = emitVmSwitchProgram(model)
  expect(output).not.toMatch(/if \(false\)/)
  expect(output).not.toContain('__recovered_function_1')
  expect(output).not.toContain('__recovered_enumerable_keys')
  expect(output).not.toMatch(/__recovered_r_0_[12]\b/)
  const { summary } = simplification
  expect(summary.provenUnreachable).toBe(5)
  expect(summary.unreachableFunctions).toBe(1)
  expect(
    summary.emitted + summary.safelyEliminated + summary.provenUnreachable,
  ).toBe(model.instructionCount)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(7)
})
