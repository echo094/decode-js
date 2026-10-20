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
    const packetA = diagnoseContainer(encoded)
    expect(packetA.ok).toBe(true)
    const wordcode = readWordcode(packetA.result)
    expect(wordcode).not.toBeNull()
    expect(validateReferences(packetA.result, wordcode)).toBeNull()
    const before = JSON.stringify(packetA.result)
    const normalized = diagnoseNormalizeConcealedConstants(
      encoded,
      packetA.result,
      wordcode,
    )
    expect(normalized.ok).toBe(true)
    expect(normalized.result.concealedPoolEntries).toBeGreaterThan(0)
    expect(JSON.stringify(packetA.result)).toBe(before)
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

test('declines malformed base64 and inconsistent keys without changing Packet A', () => {
  const encoded = fixture('exceptions', 'encoded.js')
  const packetA = diagnoseContainer(encoded).result
  const wordcode = readWordcode(packetA)
  const concealedString = wordcode.instructions
    .flatMap((instruction) => instruction.operands)
    .find(
      (operand) =>
        operand.kind === 'constant-ref' &&
        operand.concealKey !== 0 &&
        typeof packetA.roles.pool.values[operand.index] === 'string',
    )
  expect(concealedString).toBeDefined()
  const malformed = structuredClone(packetA)
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
  const changed = structuredClone(packetA)
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
