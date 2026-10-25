import fs from 'node:fs'
import { expect, test } from 'vitest'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import { inspectCurrent } from '../../../scripts/qualify-jsconfuser-vm/oracles.mjs'
import {
  timingSourceRoles,
  observeTimingKnown,
} from '../../../scripts/qualify-jsconfuser-vm/timing-observation.mjs'

const reference = fs.readFileSync(
  new URL('fixtures/reference/encoded.js', import.meta.url),
  'utf8',
)
const finalizers = fs.readFileSync(
  new URL('fixtures/runtime-finalizers/baseline.js', import.meta.url),
  'utf8',
)
const timing = (source, value) =>
  source.replace('var TIMING_CHECKS = false;', `var TIMING_CHECKS = ${value};`)

// Timing checks live in the interpreter only: every TIMING_CHECKS value decodes to the program the
// disabled runtime decodes to, so the decoded program carries no timing check.
test('every timing value decodes to the disabled program', () => {
  const disabled = decodeJsconfuserVm(reference)
  expect(disabled.ok).toBe(true)
  for (const value of ['false', '0', '-0', '100', '1000', '-1']) {
    const source = timing(reference, value)
    const result = inspectCurrent(source)
    expect(result.publicRecord.ok).toBe(true)
    expect(result.checks.ok).toBe(true)
    expect(result.inputState).toBe(true)
    expect(result.publicRecord.output).toBe(disabled.output)
  }
})

test('a renamed Upvalue close method decodes and behaves as the source', () => {
  const renamed = finalizers
    .replace('Upvalue.prototype._close =', 'Upvalue.prototype._seal =')
    .replaceAll('uv._close()', 'uv._seal()')
  const current = inspectCurrent(renamed)
  expect(current.container.ok).toBe(true)
  expect(current.publicRecord.ok).toBe(true)
  expect(current.checks.ok).toBe(true)
  expect(current.inputState).toBe(true)
  expect(observeTimingKnown(current.publicRecord.output).behavior).toEqual({
    kind: 'value',
    value: [7, true, 7],
  })
})

test('equal threshold preserves behavior and greater threshold poisons before dispatch', () => {
  const source = timing(reference, '100'),
    roles = timingSourceRoles(source)
  const equal = observeTimingKnown(source, {
    vmName: roles.vmName,
    clock: (index) => index * 100,
  })
  expect(equal.behavior).toEqual(
    observeTimingKnown(reference, { clock: () => 0 }).behavior,
  )
  const greater = observeTimingKnown(source, {
    vmName: roles.vmName,
    clock: (index) => (index === 0 ? 0 : 101),
  })
  expect(greater.behavior).toMatchObject({
    kind: 'error',
    name: 'Error',
    message: 'Unknown opcode: undefined at pc NaN',
  })
  expect(greater.state).toMatchObject({
    wordsZero: true,
    frame: undefined,
    currentFramePayloadCleared: true,
  })
})

test('clock side effects are an explicit native host boundary', () => {
  const decoded = decodeJsconfuserVm(reference)
  expect(decoded.ok).toBe(true)
  const clock = () => {
    throw new Error('host clock failed')
  }
  expect(observeTimingKnown(reference, { clock }).behavior).toMatchObject({
    kind: 'error',
    message: 'host clock failed',
  })
  expect(observeTimingKnown(decoded.output, { clock }).behavior.kind).toBe(
    'value',
  )
  expect(decoded.result.finalJavaScriptSemantics).toBe(false)
})

test('active timing decodes with numeric transport and with a handler table', () => {
  for (const fixture of ['encoded-bytecode-arithmetic', 'handler-table-boot']) {
    const disabled = fs.readFileSync(
      new URL(`fixtures/${fixture}/encoded.js`, import.meta.url),
      'utf8',
    )
    const source = timing(disabled, '100')
    expect(source).toContain('var TIMING_CHECKS = 100;')
    const decoded = decodeJsconfuserVm(source)
    expect(decoded.ok).toBe(true)
    expect(decoded.output).toBe(decodeJsconfuserVm(disabled).output)
  }
})
