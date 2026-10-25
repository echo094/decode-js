import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { diagnoseNormalizeStringConcealing } from '../../../src/vm/jsconfuser-vm/normalize-string-concealing.js'
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
    { window, Buffer, atob, performance: { now: () => 0 } },
    { timeout: 1000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

function withWords(encoded, words) {
  const original = encoded.match(/var BYTECODE = \[[\s\S]*?\];/)?.[0]
  expect(original).toBeDefined()
  return encoded.replace(original, `var BYTECODE = [${words.join(',')}];`)
}

function analysesOf(encoded) {
  const container = diagnoseContainer(encoded).result
  const wordcode = readWordcode(container)
  const references = validateReferences(container, wordcode)
  return { container, wordcode, references }
}

test.each([
  'string-concealing-switch',
  'string-concealing-methods',
  'string-concealing-exceptions',
  'string-concealing-closures',
  'string-concealing-nested',
])('statically restores the shared bank in %s', (name) => {
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const qualification = JSON.parse(fixture(name, 'qualification.json'))
  const { container, wordcode, references } = analysesOf(encoded)
  const original = JSON.stringify(container)
  const normalized = diagnoseNormalizeStringConcealing(
    container,
    wordcode,
    references,
  )
  expect(normalized.ok).toBe(true)
  expect(JSON.stringify(container)).toBe(original)
  expect(normalized.result.decodedCount).toBeGreaterThan(0)
  const next = normalized.result.container
  const nextWordcode = readWordcode(next)
  expect(
    partitionFunctions(
      next,
      nextWordcode,
      validateReferences(next, nextWordcode),
    ),
  ).not.toBeNull()
  expect(nextWordcode.wordCount).toBeLessThan(wordcode.wordCount)

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(encoded)).toEqual(observe(source))
  expect(observe(decoded.result.output)).toEqual(observe(source))
  expect(qualification.effectObservation).toEqual({
    axis: 'serialized-bytecode',
    observed: true,
  })
})

test('declines a changed decode helper body atomically', () => {
  const encoded = fixture('string-concealing-switch', 'encoded.js')
  const { container, wordcode } = analysesOf(encoded)
  const changed = container.roles.words.values.slice()
  const helper = wordcode.instructions.find(
    (item) => item.pc > 300 && item.name === 'USHR',
  )
  changed[helper.pc] = container.roles.op.values.BXOR
  const damaged = withWords(encoded, changed)
  const next = analysesOf(damaged)
  expect(
    diagnoseNormalizeStringConcealing(
      next.container,
      next.wordcode,
      next.references,
    ).ok,
  ).toBe(false)
  expect(diagnoseStandalone(damaged)).toMatchObject({ ok: false, result: null })
})

test('declines a noncanonical bank and a changed threaded capture', () => {
  const encoded = fixture('string-concealing-switch', 'encoded.js')
  const damagedBank = encoded.replace(
    /(var CONSTANTS = \[\/\* 0 \*\/")([^"]+)/,
    '$1!',
  )
  expect(diagnoseStandalone(damagedBank)).toMatchObject({
    ok: false,
    result: null,
  })

  const { container, wordcode } = analysesOf(encoded)
  const capture = wordcode.instructions.find(
    (item) =>
      item.name === 'MAKE_CLOSURE' && item.functionMeta.captureCount === 1,
  )
  const changed = container.roles.words.values.slice()
  changed[capture.pc + capture.width - 1] += 1
  const damagedCapture = withWords(encoded, changed)
  expect(diagnoseStandalone(damagedCapture)).toMatchObject({
    ok: false,
    result: null,
  })
})

test('declines a decode slice outside the padded bank', () => {
  const encoded = fixture('string-concealing-switch', 'encoded.js')
  const { container, wordcode } = analysesOf(encoded)
  const site = wordcode.instructions.find(
    (item, index) =>
      item.name === 'CALL' &&
      item.words[3] === 4 &&
      wordcode.instructions[index - 1]?.name === 'LOAD_INT',
  )
  const prior = wordcode.instructions[wordcode.instructions.indexOf(site) - 2]
  const changed = container.roles.words.values.slice()
  changed[prior.pc + 2] = 0xffffffff
  const damaged = withWords(encoded, changed)
  expect(diagnoseStandalone(damaged)).toMatchObject({ ok: false, result: null })
})
