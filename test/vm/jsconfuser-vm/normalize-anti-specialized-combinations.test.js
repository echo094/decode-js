import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseAntiRuntime } from '../../../src/vm/jsconfuser-vm/analyze-anti-runtime.js'
import { diagnoseSpecializedRuntime } from '../../../src/vm/jsconfuser-vm/observe-specialized-runtime.js'
import {
  diagnoseNormalizeAntiSpecializedWordcode,
  diagnoseNormalizeSpecializedWordcode,
} from '../../../src/vm/jsconfuser-vm/normalize-specialized-wordcode.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

function fixture(name, file) {
  return fs.readFileSync(
    new URL(`fixtures/${name}/${file}`, import.meta.url),
    'utf8',
  )
}

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, Buffer, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

const profiles = [
  [
    'anti-specialized-exceptions',
    ['antiInstrumentation', 'specializedOpcodes'],
  ],
  [
    'string-cff-dispatcher-concealed-constants-anti-specialized-exceptions',
    [
      'stringConcealing',
      'controlFlowFlattening',
      'dispatcher',
      'concealConstants',
      'antiInstrumentation',
      'specializedOpcodes',
    ],
  ],
]

test.each(profiles)(
  'normalizes %s with proved anti and specialized handlers',
  (name, options) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const record = JSON.parse(fixture(name, 'qualification.json'))
    const container = diagnoseContainer(encoded).result
    const before = JSON.stringify(container)
    expect(diagnoseAntiRuntime(encoded).ok).toBe(false)
    expect(diagnoseSpecializedRuntime(encoded).ok).toBe(false)
    const normalized = diagnoseNormalizeAntiSpecializedWordcode(
      encoded,
      container,
    )
    expect(normalized.ok).toBe(true)
    expect(JSON.stringify(container)).toBe(before)
    expect(normalized.result.specializedInstructionCount).toBeGreaterThan(0)
    expect(normalized.result.syntheticInstructionCount).toBeGreaterThan(0)
    expect(readWordcode(normalized.result.container)).not.toBeNull()

    const decoded = diagnoseStandalone(encoded)
    expect(decoded.ok).toBe(true)
    const output = parseSuccessfulOutput(decoded.result.output)
    expect(assertNoVmResidue(output).ok).toBe(true)
    expect(
      assertDerivedStateConsistency(output, decoded.result.output).ok,
    ).toBe(true)
    const sourceValue = observe(source)
    expect(sourceValue).toEqual(observe(encoded))
    expect(sourceValue).toEqual(observe(decoded.result.output))
    expect(record.status).toBe('accepted')
    expect(record.effectObservation.observed).toBe(true)
    for (const option of options)
      expect(record.effectObservation.components[option]).toBe(true)
  },
)

test('maps old dispatcher PCs after specialized expansion without anti', () => {
  const name =
    'string-cff-dispatcher-concealed-constants-specialized-arithmetic'
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const record = JSON.parse(fixture(name, 'qualification.json'))
  const container = diagnoseContainer(encoded).result
  const before = JSON.stringify(container)
  const normalized = diagnoseNormalizeSpecializedWordcode(encoded, container)
  expect(normalized.ok).toBe(true)
  expect(JSON.stringify(container)).toBe(before)
  const wordcode = readWordcode(normalized.result.container)
  expect(wordcode).not.toBeNull()
  expect(
    wordcode.instructions.some(({ name: opcode }) => opcode === 'JUMP_REG'),
  ).toBe(false)
  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  const sourceValue = observe(source)
  expect(sourceValue).toEqual(observe(encoded))
  expect(sourceValue).toEqual(observe(decoded.result.output))
  expect(record.status).toBe('accepted')
})

test('declines a changed specialized handler in the anti stack', () => {
  const encoded = fixture('anti-specialized-exceptions', 'encoded.js')
  const specialized = diagnoseSpecializedRuntime(encoded, {
    allowAntiPrefix: true,
  })
  expect(specialized.ok).toBe(true)
  const opcode = specialized.result.specialized[0].opcode
  const changed = encoded.replace(`case ${opcode}:`, `case ${opcode + 500}:`)
  expect(changed).not.toBe(encoded)
  const container = diagnoseContainer(changed).result
  expect(
    diagnoseNormalizeAntiSpecializedWordcode(changed, container),
  ).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'specialized-runtime' },
  })
  expect(diagnoseStandalone(changed).ok).toBe(false)
})
