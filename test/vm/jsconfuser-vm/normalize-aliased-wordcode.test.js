import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseAliasedRuntime } from '../../../src/vm/jsconfuser-vm/observe-aliased-runtime.js'
import { diagnoseNormalizeAliasedWordcode } from '../../../src/vm/jsconfuser-vm/normalize-aliased-wordcode.js'
import {
  diagnoseAliasedWordStream,
  diagnoseWordcode,
  readWordcode,
} from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
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
    { window, performance: { now: () => 0 } },
    { timeout: 1000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test.each([
  'aliased-runtime-boot',
  'aliased-runtime-closures',
  'aliased-runtime-exceptions',
])('proves, normalizes, and decodes %s', (name) => {
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const qualification = JSON.parse(fixture(name, 'qualification.json'))
  const extracted = diagnoseContainer(encoded).result
  const originalWords = extracted.roles.words.values.slice()
  expect(diagnoseWordcode(extracted)).toMatchObject({
    ok: false,
    diagnostic: { code: 'unknown-opcode' },
  })
  const runtime = diagnoseAliasedRuntime(encoded)
  expect(runtime.ok).toBe(true)
  const stream = diagnoseAliasedWordStream(extracted, runtime.result)
  expect(stream.ok).toBe(true)
  expect(
    stream.result.instructions.some(({ name: op }) => op === 'SYNTHETIC'),
  ).toBe(true)
  const normalized = diagnoseNormalizeAliasedWordcode(encoded, extracted)
  expect(normalized.ok).toBe(true)
  expect(normalized.result.originalWordCount).toBe(originalWords.length)
  expect(normalized.result.container.roles.words.values).toHaveLength(
    originalWords.length,
  )
  expect(readWordcode(normalized.result.container)).not.toBeNull()
  expect(extracted.roles.words.values).toEqual(originalWords)

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
  expect(qualification.profile).toBe('aliasedOpcodes')
})

test('declines a changed alias handler even when its word stream remains parseable', () => {
  const encoded = fixture('aliased-runtime-boot', 'encoded.js')
  const damaged = encoded.replace(
    'regs[base + dst] = a * regs[base + _operands[2]];',
    'regs[base + dst] = a * (regs[base + _operands[2]] + 1);',
  )
  expect(damaged).not.toBe(encoded)
  expect(diagnoseAliasedRuntime(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'alias-runtime' },
  })
  expect(
    diagnoseNormalizeAliasedWordcode(
      damaged,
      diagnoseContainer(damaged).result,
    ),
  ).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'alias-runtime' },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})
