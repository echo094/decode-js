import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseAntiRuntime } from '../../../src/vm/jsconfuser-vm/analyze-anti-runtime.js'
import { diagnoseNormalizeAntiWordcode } from '../../../src/vm/jsconfuser-vm/normalize-anti-wordcode.js'
import { diagnoseNormalizeStringConcealing } from '../../../src/vm/jsconfuser-vm/normalize-string-concealing.js'
import { diagnoseNormalizeCffWordcode } from '../../../src/vm/jsconfuser-vm/normalize-cff-wordcode.js'
import {
  diagnoseAntiWordStream,
  readWordcode,
} from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
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
  ['string-concealing-anti-instrumentation-nested', ['stringConcealing']],
  ['cff-anti-instrumentation-exceptions', ['controlFlowFlattening']],
  ['dispatcher-anti-instrumentation-switch', ['dispatcher']],
  [
    'string-cff-dispatcher-concealed-constants-anti-instrumentation-exceptions',
    [
      'stringConcealing',
      'controlFlowFlattening',
      'dispatcher',
      'concealConstants',
    ],
  ],
]

test.each(profiles)(
  'normalizes %s through anti and the qualified stack',
  (name, enabled) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const record = JSON.parse(fixture(name, 'qualification.json'))
    const container = diagnoseContainer(encoded).result
    const before = JSON.stringify(container)
    const anti = diagnoseNormalizeAntiWordcode(encoded, container)
    expect(anti.ok).toBe(true)
    expect(JSON.stringify(container)).toBe(before)
    const wordcode = readWordcode(anti.result.container)
    expect(wordcode).not.toBeNull()
    const references = validateReferences(anti.result.container, wordcode)
    expect(references).not.toBeNull()
    if (enabled.length === 1 && enabled[0] === 'stringConcealing') {
      expect(wordcode.instructions[0].name).toBe('MAKE_CLOSURE')
      expect(
        diagnoseNormalizeStringConcealing(
          anti.result.container,
          wordcode,
          references,
        ).ok,
      ).toBe(true)
    }
    if (enabled.length === 1 && enabled[0] === 'controlFlowFlattening') {
      const functions = partitionFunctions(
        anti.result.container,
        wordcode,
        references,
      )
      expect(functions).not.toBeNull()
      expect(
        diagnoseNormalizeCffWordcode(anti.result.container, wordcode, functions)
          .ok,
      ).toBe(true)
    }
    if (enabled.length === 1 && enabled[0] === 'dispatcher') {
      expect(
        wordcode.instructions.some(({ name: opcode }) => opcode === 'JUMP_REG'),
      ).toBe(false)
    }

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
    expect(record.effectObservation.observed).toBe(true)
    for (const option of [...enabled, 'antiInstrumentation'])
      expect(record.effectObservation.components[option]).toBe(true)
  },
)

test('declines an encoded dispatcher target without an old PC boundary', () => {
  const encoded = fixture(
    'dispatcher-anti-instrumentation-switch',
    'encoded.js',
  )
  const container = diagnoseContainer(encoded).result
  const runtime = diagnoseAntiRuntime(encoded).result
  const stream = diagnoseAntiWordStream(container, runtime).result
  const endpoint = stream.instructions.find(({ pc }) => pc === 147)
  expect(endpoint).toMatchObject({ name: 'LOAD_INT' })
  const changed = structuredClone(container)
  changed.roles.words.values[endpoint.pc + 2] += 1
  expect(diagnoseNormalizeAntiWordcode(encoded, changed)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'dispatcher-target' },
  })
})

test('declines a direct branch into the middle of removed fake seeds', () => {
  const encoded = fixture('cff-anti-instrumentation-exceptions', 'encoded.js')
  const container = diagnoseContainer(encoded).result
  const runtime = diagnoseAntiRuntime(encoded).result
  const stream = diagnoseAntiWordStream(container, runtime).result
  const jump = stream.instructions.find(({ pc }) => pc === 196)
  expect(jump).toMatchObject({ name: 'JUMP' })
  const changed = structuredClone(container)
  changed.roles.words.values[jump.pc + 1] = 99
  expect(diagnoseNormalizeAntiWordcode(encoded, changed)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'anti-seed-proof' },
  })
})
