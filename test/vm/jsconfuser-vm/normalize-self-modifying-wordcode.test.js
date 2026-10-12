import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseNormalizeSelfModifyingWordcode } from '../../../src/vm/jsconfuser-vm/normalize-self-modifying-wordcode.js'
import { diagnoseSelfModifyingRegions } from '../../../src/vm/jsconfuser-vm/observe-self-modifying.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
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

function replaceWords(encoded, words) {
  const changed = encoded.replace(
    /^var BYTECODE = \[[^\n]+\];$/m,
    `var BYTECODE = ${JSON.stringify(words)};`,
  )
  expect(changed).not.toBe(encoded)
  return changed
}

test.each([
  'self-modifying-boot',
  'self-modifying-closures',
  'self-modifying-finally',
])('normalizes and decodes %s with no VM residue', (name) => {
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const packet = diagnoseContainer(encoded).result
  const originalWords = packet.roles.words.values.slice()
  const normalized = diagnoseNormalizeSelfModifyingWordcode(packet)
  expect(normalized.ok).toBe(true)
  expect(normalized.result.wordCount).toBeLessThan(originalWords.length)
  expect(readWordcode(normalized.result.container)).not.toBeNull()
  expect(packet.roles.words.values).toEqual(originalWords)

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const ast = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(ast).ok).toBe(true)
  expect(assertDerivedStateConsistency(ast, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(decoded.result.output)).toEqual(observe(source))
  expect(observe(encoded)).toEqual(observe(source))
})

test('declines a finalizer target redirected into ciphertext', () => {
  const encoded = fixture('self-modifying-finally', 'encoded.js')
  const packet = diagnoseContainer(encoded).result
  const originalWords = packet.roles.words.values.slice()
  const observation = diagnoseSelfModifyingRegions(packet).result
  const jump = observation.indirectTargets[0]
  const target = jump.targets[0]
  const labelLoadPc = Number(jump.origins[target][0])
  expect(
    observation.reachableInstructions.find((item) => item.pc === labelLoadPc)
      ?.name,
  ).toBe('LOAD_INT')
  const changed = structuredClone(packet)
  changed.roles.words.values[labelLoadPc + 2] =
    observation.patches[0].sourceStart
  expect(diagnoseNormalizeSelfModifyingWordcode(changed)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'source-reachable' },
  })
  expect(packet.roles.words.values).toEqual(originalWords)

  const malformed = replaceWords(encoded, changed.roles.words.values)
  expect(diagnoseStandalone(malformed)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
  expect(decodeStandalone(malformed)).toBeNull()
})
