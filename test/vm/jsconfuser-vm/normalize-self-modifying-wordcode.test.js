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
    { window, performance: { now: () => 0 }, Buffer, atob },
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

// selfModifying over dispatcher, string concealing, CFF and anti: the PATCH stage removes only its
// own words (headers, decoys, decoy fillers, storage) and hands the inner opcodes on with its map.
const layers = JSON.parse(
  fixture('self-modifying-layers', 'generation.json'),
).files

test.each(Object.keys(layers))(
  'decodes layered self-modifying %s with source behaviour',
  (file) => {
    const source = fixture(
      'self-modifying-layers',
      layers[file].source ?? 'source.js',
    )
    const encoded = fixture('self-modifying-layers', file)
    expect(diagnoseContainer(encoded).ok).toBe(true)
    const decoded = diagnoseStandalone(encoded)
    expect(decoded.ok, JSON.stringify(decoded.diagnostic)).toBe(true)
    const ast = parseSuccessfulOutput(decoded.result.output)
    expect(assertNoVmResidue(ast).ok).toBe(true)
    expect(assertDerivedStateConsistency(ast, decoded.result.output).ok).toBe(
      true,
    )
    expect(observe(decoded.result.output)).toEqual(observe(source))
    expect(observe(encoded)).toEqual(observe(source))
  },
)

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

// A finalizer's continuation register is written only by label loads, so its literal is an
// address the stage relocates; one pointing into PATCH storage names no code and declines.
test('declines a finally continuation redirected into storage', () => {
  const encoded = fixture('self-modifying-finally', 'encoded.js')
  const packet = diagnoseContainer(encoded).result
  const originalWords = packet.roles.words.values.slice()
  const observation = diagnoseSelfModifyingRegions(packet).result
  const setup = observation.instructions.find(
    (item) => item.name === 'FINALLY_SETUP',
  )
  const load = observation.instructions.find(
    (item) => item.name === 'LOAD_INT' && item.words[1] === setup.words[2],
  )
  expect(load).toBeDefined()
  const target = observation.patches[0].sourceStart
  const changed = structuredClone(packet)
  const words = changed.roles.words.values
  const at = load.pc + 2
  const region = observation.patches.find(
    ({ destPc, width }) => at >= destPc && at < destPc + width,
  )
  if (region) {
    // Change the plaintext through its ciphertext word: c' = c ^ p ^ p'.
    const source = region.sourceStart + (at - region.destPc)
    words[source] =
      (words[source] ^ observation.patchedWords[at] ^ target) >>> 0
  } else words[at] = target
  expect(diagnoseNormalizeSelfModifyingWordcode(changed)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'self-modifying-target' },
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
