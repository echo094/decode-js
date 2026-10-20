import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseAntiRuntime } from '../../../src/vm/jsconfuser-vm/analyze-anti-runtime.js'
import { diagnoseSpecializedRuntime } from '../../../src/vm/jsconfuser-vm/observe-specialized-runtime.js'
import { diagnoseMacroRuntime } from '../../../src/vm/jsconfuser-vm/observe-macro-runtime.js'
import { diagnoseNormalizeMacroWordcode } from '../../../src/vm/jsconfuser-vm/normalize-macro-wordcode.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  diagnoseMacroWordStream,
  readWordcode,
} from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
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
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

const sevenOptions = [
  'stringConcealing',
  'controlFlowFlattening',
  'dispatcher',
  'concealConstants',
  'antiInstrumentation',
  'specializedOpcodes',
  'macroOpcodes',
]

const samples = [
  ['anti-macro-exceptions', ['antiInstrumentation', 'macroOpcodes']],
  ['specialized-macro-nested-strings', ['specializedOpcodes', 'macroOpcodes']],
  ['macro-seven-option-exceptions', sevenOptions],
  ['macro-seven-option-repeated-arrays', sevenOptions],
  ['macro-six-option-no-anti-exceptions', null],
]

test.each(samples)(
  'normalizes and decodes %s',
  (name, effectOptions) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const record = JSON.parse(fixture(name, 'qualification.json'))
    const container = diagnoseContainer(encoded).result
    const before = JSON.stringify(container)
    const normalized = diagnoseNormalizeMacroWordcode(encoded, container)
    expect(normalized.ok).toBe(true)
    expect(normalized.result.macroInstructionCount).toBeGreaterThan(0)
    expect(JSON.stringify(container)).toBe(before)
    expect(readWordcode(normalized.result.container)).not.toBeNull()

    const decoded = diagnoseStandalone(encoded)
    expect(decoded.ok).toBe(true)
    const output = parseSuccessfulOutput(decoded.result.output)
    expect(assertNoVmResidue(output).ok).toBe(true)
    expect(
      assertDerivedStateConsistency(output, decoded.result.output).ok,
    ).toBe(true)
    const expected = observe(source)
    expect(observe(encoded)).toEqual(expected)
    expect(observe(decoded.result.output)).toEqual(expected)
    expect(record.status).toBe('accepted')
    if (effectOptions) {
      expect(record.effectObservation.observed).toBe(true)
      for (const option of effectOptions)
        expect(record.effectObservation.components[option]).toBe(true)
    }
  },
)

test('declines a changed macro case in the mixed runtime', () => {
  const encoded = fixture('macro-seven-option-exceptions', 'encoded.js')
  const anti = diagnoseAntiRuntime(encoded, { allowSpecializedTail: true })
  expect(anti.ok).toBe(true)
  const specialized = diagnoseSpecializedRuntime(encoded, {
    allowAntiPrefix: true,
    allowMacroTail: true,
  })
  expect(specialized.ok).toBe(true)
  const macro = diagnoseMacroRuntime(encoded, {
    antiObservation: anti.result,
    specializedObservation: specialized.result,
  })
  expect(macro.ok).toBe(true)
  const opcode = macro.result.macros[0].opcode
  const damaged = encoded.replace(`case ${opcode}:`, `case ${opcode + 500}:`)
  expect(damaged).not.toBe(encoded)
  expect(
    diagnoseNormalizeMacroWordcode(damaged, diagnoseContainer(damaged).result),
  ).toMatchObject({ ok: false, result: null })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})

test('declines a changed specialized prefix before macro expansion', () => {
  const encoded = fixture('macro-seven-option-exceptions', 'encoded.js')
  const specialized = diagnoseSpecializedRuntime(encoded, {
    allowAntiPrefix: true,
    allowMacroTail: true,
  })
  expect(specialized.ok).toBe(true)
  const opcode = specialized.result.specialized[0].opcode
  const damaged = encoded.replace(`case ${opcode}:`, `case ${opcode + 500}:`)
  expect(damaged).not.toBe(encoded)
  expect(
    diagnoseNormalizeMacroWordcode(damaged, diagnoseContainer(damaged).result),
  ).toMatchObject({ ok: false, result: null })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})

test('keeps variable-width array builders inside proved mixed macros', () => {
  const encoded = fixture('macro-seven-option-repeated-arrays', 'encoded.js')
  const anti = diagnoseAntiRuntime(encoded, { allowSpecializedTail: true })
  expect(anti.ok).toBe(true)
  const specialized = diagnoseSpecializedRuntime(encoded, {
    allowAntiPrefix: true,
    allowMacroTail: true,
  })
  expect(specialized.ok).toBe(true)
  const macro = diagnoseMacroRuntime(encoded, {
    antiObservation: anti.result,
    specializedObservation: specialized.result,
  })
  expect(macro.ok).toBe(true)
  const stream = diagnoseMacroWordStream(
    diagnoseContainer(encoded).result,
    macro.result,
    specialized.result,
    anti.result,
  )
  expect(stream.ok).toBe(true)
  expect(
    stream.result.instructions.some(
      (instruction) =>
        instruction.name === 'MACRO' &&
        instruction.steps.some(({ name }) => name === 'BUILD_ARRAY'),
    ),
  ).toBe(true)
})
