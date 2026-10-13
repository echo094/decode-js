import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseAntiRuntime } from '../../../src/vm/jsconfuser-vm/analyze-anti-runtime.js'
import { diagnoseNormalizeAntiWordcode } from '../../../src/vm/jsconfuser-vm/normalize-anti-wordcode.js'
import {
  diagnoseAntiWordStream,
  readWordcode,
} from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import {
  decodeStandalone,
  diagnoseStandalone,
} from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
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
  'anti-runtime-boot',
  'anti-runtime-duplicate-step',
  'anti-runtime-finally',
  'anti-runtime-catch-finally',
])(
  'normalizes and decodes %s without changing the source container',
  (name) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const packetA = diagnoseContainer(encoded).result
    const originalWords = packetA.roles.words.values.slice()
    const normalized = diagnoseNormalizeAntiWordcode(encoded, packetA)
    expect(normalized.ok).toBe(true)
    expect(normalized.result.originalWordCount).toBe(originalWords.length)
    expect(normalized.result.container.roles.words.values.length).toBeLessThan(
      originalWords.length,
    )
    expect(readWordcode(normalized.result.container)).not.toBeNull()
    expect(packetA.roles.words.values).toEqual(originalWords)

    const decoded = diagnoseStandalone(encoded)
    expect(decoded.ok).toBe(true)
    expect(
      assertNoVmResidue(parseSuccessfulOutput(decoded.result.output)).ok,
    ).toBe(true)
    expect(
      assertDerivedStateConsistency(
        parseSuccessfulOutput(decoded.result.output),
        decoded.result.output,
      ).ok,
    ).toBe(true)
    expect(observe(decoded.result.output)).toEqual(observe(source))
    expect(observe(encoded)).toEqual(observe(source))
  },
)

test('declines a changed fake jump without a normalized container', () => {
  const encoded = fixture('anti-runtime-duplicate-step', 'encoded.js')
  const packetA = diagnoseContainer(encoded).result
  const runtime = diagnoseAntiRuntime(encoded).result
  const stream = diagnoseAntiWordStream(packetA, runtime).result
  const case62 = stream.instructions.find(({ opcode }) => opcode.value === 62)
  const jumpCanonical = runtime.syntheticCases[1].steps[1].operandStart + 1
  const jumpStored = runtime.syntheticCases[1].canonicalToStored[jumpCanonical]
  const targetIndex = case62.pc + 1 + jumpStored
  expect(packetA.roles.words.values[targetIndex]).toBe(case62.nextPc)
  const tampered = structuredClone(packetA)
  const originalWords = packetA.roles.words.values.slice()
  tampered.roles.words.values[targetIndex] += 1
  const normalized = diagnoseNormalizeAntiWordcode(encoded, tampered)
  expect(normalized).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'register-isolation' },
  })
  expect(packetA.roles.words.values).toEqual(originalWords)

  const malformed = encoded.replace(
    /^var BYTECODE = \[[^\n]+\];$/m,
    `var BYTECODE = ${JSON.stringify(tampered.roles.words.values)};`,
  )
  expect(malformed).not.toBe(encoded)
  expect(diagnoseStandalone(malformed)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
  expect(decodeStandalone(malformed)).toBeNull()
})
