import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseAntiRuntime } from '../../../src/vm/jsconfuser-vm/analyze-anti-runtime.js'
import { diagnoseSpecializedRuntime } from '../../../src/vm/jsconfuser-vm/observe-specialized-runtime.js'
import { diagnoseMacroRuntime } from '../../../src/vm/jsconfuser-vm/observe-macro-runtime.js'
import { diagnoseAliasedRuntime } from '../../../src/vm/jsconfuser-vm/observe-aliased-runtime.js'
import { diagnoseNormalizeAliasedWordcode } from '../../../src/vm/jsconfuser-vm/normalize-aliased-wordcode.js'
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
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

const samples = [
  ['macro-alias-exceptions', ['macroOpcodes', 'aliasedOpcodes']],
  [
    'eight-option-alias-exceptions',
    [
      'stringConcealing',
      'controlFlowFlattening',
      'dispatcher',
      'concealConstants',
      'antiInstrumentation',
      'specializedOpcodes',
      'macroOpcodes',
      'aliasedOpcodes',
    ],
  ],
  [
    'shuffled-alias-stack-exceptions',
    [
      'stringConcealing',
      'controlFlowFlattening',
      'dispatcher',
      'concealConstants',
      'antiInstrumentation',
      'specializedOpcodes',
      'macroOpcodes',
      'aliasedOpcodes',
      'shuffleOpcodes',
    ],
  ],
]

test.each(samples)(
  'normalizes and decodes %s',
  (name, options) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const record = JSON.parse(fixture(name, 'qualification.json'))
    const container = diagnoseContainer(encoded).result
    const before = JSON.stringify(container)
    const normalized = diagnoseNormalizeAliasedWordcode(encoded, container, {
      allowObservedPrefix: true,
    })
    expect(normalized.ok).toBe(true)
    expect(normalized.result.aliasedInstructionCount).toBeGreaterThan(0)
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
    expect(record.effectObservation.observed).toBe(true)
    for (const option of options)
      expect(record.effectObservation.components[option]).toBe(true)
  },
)

test('declines a changed alias body after a proved macro prefix', () => {
  const encoded = fixture('macro-alias-exceptions', 'encoded.js')
  const macro = diagnoseMacroRuntime(encoded, { allowAliasTail: true })
  expect(macro.ok).toBe(true)
  const alias = diagnoseAliasedRuntime(encoded, {
    macroObservation: macro.result,
  })
  expect(alias.ok).toBe(true)
  const opcode = alias.result.aliases[0].opcode
  expect(opcode).toBe(macro.result.macros.at(-1).opcode + 1)
  const damaged = encoded.replace(
    'regs[fp + SLOTS.PC] = _operands[0];',
    'regs[fp + SLOTS.PC] = _operands[0] + 1;',
  )
  expect(damaged).not.toBe(encoded)
  expect(
    diagnoseNormalizeAliasedWordcode(
      damaged,
      diagnoseContainer(damaged).result,
      { allowObservedPrefix: true },
    ),
  ).toMatchObject({ ok: false, result: null })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})

test('declines a changed macro body before alias projection', () => {
  const encoded = fixture('macro-alias-exceptions', 'encoded.js')
  const damaged = encoded.replace(
    /(case 61:[\s\S]*?)ReferenceError/,
    '$1TypeError',
  )
  expect(damaged).not.toBe(encoded)
  expect(
    diagnoseNormalizeAliasedWordcode(
      damaged,
      diagnoseContainer(damaged).result,
      { allowObservedPrefix: true },
    ),
  ).toMatchObject({ ok: false, result: null })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})

test('keeps anti, specialized, macro, and alias opcode ranges distinct', () => {
  const encoded = fixture('eight-option-alias-exceptions', 'encoded.js')
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
    allowAliasTail: true,
  })
  expect(macro.ok).toBe(true)
  const alias = diagnoseAliasedRuntime(encoded, {
    antiObservation: anti.result,
    specializedObservation: specialized.result,
    macroObservation: macro.result,
  })
  expect(alias.ok).toBe(true)
  const ranges = [
    anti.result.syntheticCases,
    specialized.result.specialized,
    macro.result.macros,
    alias.result.aliases,
  ]
  expect(ranges.every((range) => range.length > 0)).toBe(true)
  expect(ranges.flat().map(({ opcode }) => opcode)).toEqual(
    Array.from({ length: ranges.flat().length }, (_, index) => 61 + index),
  )
})

test('stops anti classification before a one-step alias handler', () => {
  const source = fixture('anti-alias-exceptions', 'source.js')
  const encoded = fixture('anti-alias-exceptions', 'encoded.js')
  const record = JSON.parse(
    fixture('anti-alias-exceptions', 'qualification.json'),
  )
  const anti = diagnoseAntiRuntime(encoded, { allowSpecializedTail: true })
  expect(anti.ok).toBe(true)
  expect(
    anti.result.syntheticCases.every(({ steps }) => steps.length >= 3),
  ).toBe(true)
  const aliases = diagnoseAliasedRuntime(encoded, {
    antiObservation: anti.result,
  })
  expect(aliases.ok).toBe(true)
  expect(aliases.result.aliases.length).toBeGreaterThan(0)
  expect(aliases.result.aliases[0].opcode).toBe(
    anti.result.syntheticCases.at(-1).opcode + 1,
  )
  const normalized = diagnoseNormalizeAliasedWordcode(
    encoded,
    diagnoseContainer(encoded).result,
    { allowObservedPrefix: true },
  )
  expect(normalized.ok).toBe(true)
  expect(normalized.result.aliasedInstructionCount).toBeGreaterThan(0)
  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(observe(encoded)).toEqual(observe(source))
  expect(observe(decoded.result.output)).toEqual(observe(source))
  expect(record.effectObservation).toMatchObject({
    observed: true,
    components: { antiInstrumentation: true, aliasedOpcodes: true },
  })
})

test('retained shuffled runtime moves numeric cases out of opcode order', () => {
  const encoded = fixture('shuffled-alias-stack-exceptions', 'encoded.js')
  const numericCases = [...encoded.matchAll(/\bcase (\d+):/g)].map((match) =>
    Number(match[1]),
  )
  expect(numericCases.length).toBeGreaterThan(1)
  expect(numericCases).not.toEqual(
    numericCases.slice().sort((left, right) => left - right),
  )
})
