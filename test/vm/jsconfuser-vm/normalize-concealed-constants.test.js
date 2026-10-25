import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseNormalizeConcealedConstants } from '../../../src/vm/jsconfuser-vm/normalize-concealed-constants.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

function fixture(name, file) {
  return fs.readFileSync(
    new URL(`fixtures/concealed-constants-${name}/${file}`, import.meta.url),
    'utf8',
  )
}

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, Buffer, performance: { now: () => 0 } },
    { timeout: 1000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test.each(['arithmetic', 'closures', 'exceptions', 'repeatedArrays'])(
  'proves, normalizes, and decodes concealed constants in %s',
  (name) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const qualification = JSON.parse(fixture(name, 'qualification.json'))
    const extracted = diagnoseContainer(encoded)
    expect(extracted.ok).toBe(true)
    const wordcode = readWordcode(extracted.result)
    expect(wordcode).not.toBeNull()
    expect(validateReferences(extracted.result, wordcode)).toBeNull()
    const before = JSON.stringify(extracted.result)
    const normalized = diagnoseNormalizeConcealedConstants(
      encoded,
      extracted.result,
      wordcode,
    )
    expect(normalized.ok).toBe(true)
    expect(normalized.result.concealedPoolEntries).toBeGreaterThan(0)
    expect(JSON.stringify(extracted.result)).toBe(before)
    const canonical = readWordcode(normalized.result.container)
    expect(canonical).not.toBeNull()
    expect(
      validateReferences(normalized.result.container, canonical),
    ).not.toBeNull()

    const decoded = diagnoseStandalone(encoded)
    expect(decoded.ok).toBe(true)
    const output = parseSuccessfulOutput(decoded.result.output)
    expect(assertNoVmResidue(output).ok).toBe(true)
    expect(
      assertDerivedStateConsistency(output, decoded.result.output).ok,
    ).toBe(true)
    expect(observe(encoded)).toEqual(observe(source))
    expect(observe(decoded.result.output)).toEqual(observe(source))
    expect(qualification.profile).toBe('concealConstants')
    expect(qualification.effectObservation).toEqual({
      axis: 'serialized-bytecode',
      observed: true,
    })
  },
)

test('declines malformed base64 and inconsistent keys without changing the container', () => {
  const encoded = fixture('exceptions', 'encoded.js')
  const extracted = diagnoseContainer(encoded).result
  const wordcode = readWordcode(extracted)
  const concealedString = wordcode.instructions
    .flatMap((instruction) => instruction.operands)
    .find(
      (operand) =>
        operand.kind === 'constant-ref' &&
        operand.concealKey !== 0 &&
        typeof extracted.roles.pool.values[operand.index] === 'string',
    )
  expect(concealedString).toBeDefined()
  const malformed = structuredClone(extracted)
  malformed.roles.pool.values[concealedString.index] = '%%%%'
  expect(
    diagnoseNormalizeConcealedConstants(encoded, malformed, wordcode),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: 'concealed-string' },
  })

  const duplicate = wordcode.instructions
    .flatMap((instruction) =>
      instruction.operands
        .filter((operand) => operand.kind === 'constant-ref')
        .map((operand) => ({ instruction, operand })),
    )
    .filter(
      ({ operand }) =>
        operand.index === concealedString.index &&
        operand.concealKey === concealedString.concealKey,
    )[1]
  expect(duplicate).toBeDefined()
  const changed = structuredClone(extracted)
  const keyPc =
    duplicate.instruction.pc +
    (duplicate.instruction.name === 'STORE_GLOBAL' ? 2 : 3)
  changed.roles.words.values[keyPc] =
    (changed.roles.words.values[keyPc] + 1) >>> 0
  const changedWordcode = readWordcode(changed)
  expect(
    diagnoseNormalizeConcealedConstants(encoded, changed, changedWordcode),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: 'concealed-key' },
  })
})
