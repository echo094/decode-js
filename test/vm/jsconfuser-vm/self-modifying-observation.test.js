import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { diagnoseSelfModifyingRegions } from '../../../src/vm/jsconfuser-vm/observe-self-modifying.js'

const directory = new URL('fixtures/self-modifying-boot/', import.meta.url)
const source = fs.readFileSync(new URL('source.js', directory), 'utf8')
const encoded = fs.readFileSync(new URL('encoded.js', directory), 'utf8')
const closureDirectory = new URL(
  'fixtures/self-modifying-closures/',
  import.meta.url,
)
const closureSource = fs.readFileSync(
  new URL('source.js', closureDirectory),
  'utf8',
)
const closureEncoded = fs.readFileSync(
  new URL('encoded.js', closureDirectory),
  'utf8',
)
const finallyDirectory = new URL(
  'fixtures/self-modifying-finally/',
  import.meta.url,
)
const finallySource = fs.readFileSync(
  new URL('source.js', finallyDirectory),
  'utf8',
)
const finallyEncoded = fs.readFileSync(
  new URL('encoded.js', finallyDirectory),
  'utf8',
)

function analysesFrom(script) {
  const diagnosis = diagnoseContainer(script)
  expect(diagnosis.ok).toBe(true)
  return diagnosis.result
}

function modifiedAnalyses(analyses, mutate) {
  const changed = structuredClone(analyses)
  mutate(changed.roles.words.values)
  return changed
}

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, performance: { now: () => 0 } },
    { timeout: 1000 },
  )
  return window.TEST_OUTPUT
}

test('the emitted first PATCH decrypts a canonical instruction region', () => {
  const extracted = diagnoseContainer(encoded)
  expect(extracted.ok).toBe(true)
  const words = extracted.result.roles.words.values
  const [opcode, destPc, sliceStart, sliceEnd, key] = words
  expect(opcode).toBe(extracted.result.roles.op.values.PATCH)
  expect(destPc).toBe(5)
  expect(sliceStart).toBeGreaterThan(destPc)
  expect(sliceEnd).toBeLessThanOrEqual(words.length)
  expect(sliceEnd - sliceStart).toBe(22)

  let streamKey = (key ^ destPc) | 0
  const clear = words.slice(sliceStart, sliceEnd).map((word) => {
    streamKey = (streamKey + 0x9e3779b9) | 0
    return (word ^ (streamKey ^ (streamKey >>> 13))) >>> 0
  })
  const segment = structuredClone(extracted.result)
  segment.roles.words.values = clear
  expect(
    diagnoseWordcode(segment).result.instructions.map(({ name }) => name),
  ).toEqual([
    'LOAD_THIS',
    'LOAD_GLOBAL',
    'LOAD_CONST',
    'LOAD_CONST',
    'LOAD_CONST',
    'MUL',
  ])
  expect(words.slice(destPc, destPc + clear.length)).not.toEqual(clear)
  expect(diagnoseWordcode(extracted.result)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'unsupported-hardening-opcode' },
  })
  expect(observe(encoded)).toBe(observe(source))
})

test('the sweep materializes every real patch and skips decoys', () => {
  for (const [sourceText, encodedText, expectedPatches] of [
    [source, encoded, 2],
    [closureSource, closureEncoded, 7],
  ]) {
    const analyses = analysesFrom(encodedText)
    const original = analyses.roles.words.values.slice()
    const diagnosis = diagnoseSelfModifyingRegions(analyses)
    expect(diagnosis.ok).toBe(true)
    const observed = diagnosis.result
    expect(observed.patches).toHaveLength(expectedPatches)
    expect(
      observed.instructions.filter((item) => item.name === 'PATCH'),
    ).toHaveLength(expectedPatches)
    expect(observed.end).toBeLessThanOrEqual(observed.storageStart)
    expect(
      observed.patches.every((patch) => patch.destPc === patch.pc + 5),
    ).toBe(true)
    expect(analyses.roles.words.values).toEqual(original)
    expect(observe(encodedText)).toEqual(observe(sourceText))
  }

  const closureAnalyses = analysesFrom(closureEncoded)
  const closureObservation =
    diagnoseSelfModifyingRegions(closureAnalyses).result
  expect(
    closureObservation.instructions.filter(
      (instruction) => instruction.name === 'MAKE_CLOSURE',
    ),
  ).toHaveLength(2)
  expect(
    closureObservation.destinationIntervals.some(({ start, end }) =>
      closureAnalyses.roles.words.values
        .slice(start, end)
        .includes(closureAnalyses.roles.op.values.PATCH),
    ),
  ).toBe(true)
})

test('the observer names malformed real-patch intervals and ciphertext', () => {
  const analyses = analysesFrom(encoded)
  const valid = diagnoseSelfModifyingRegions(analyses)
  expect(valid.ok).toBe(true)
  const [first, second] = valid.result.patches

  const overlappingSource = modifiedAnalyses(analyses, (words) => {
    words[second.pc + 2] = first.sourceStart
    words[second.pc + 3] = first.sourceStart + second.width
  })
  expect(diagnoseSelfModifyingRegions(overlappingSource)).toMatchObject({
    ok: false,
    diagnostic: { code: 'patch-overlap' },
  })

  const damagedCiphertext = modifiedAnalyses(analyses, (words) => {
    let key = (words[first.pc + 4] ^ first.destPc) | 0
    key = (key + 0x9e3779b9) | 0
    words[first.sourceStart] = (0xffffffff ^ (key ^ (key >>> 13))) >>> 0
  })
  expect(diagnoseSelfModifyingRegions(damagedCiphertext)).toMatchObject({
    ok: false,
    diagnostic: { code: 'patch-ciphertext' },
  })
})
