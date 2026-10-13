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

function packetFrom(script) {
  const diagnosis = diagnoseContainer(script)
  expect(diagnosis.ok).toBe(true)
  return diagnosis.result
}

function modifiedPacket(packet, mutate) {
  const changed = structuredClone(packet)
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
  const packetA = diagnoseContainer(encoded)
  expect(packetA.ok).toBe(true)
  const words = packetA.result.roles.words.values
  const [opcode, destPc, sliceStart, sliceEnd, key] = words
  expect(opcode).toBe(packetA.result.roles.op.values.PATCH)
  expect(destPc).toBe(5)
  expect(sliceStart).toBeGreaterThan(destPc)
  expect(sliceEnd).toBeLessThanOrEqual(words.length)
  expect(sliceEnd - sliceStart).toBe(22)

  let streamKey = (key ^ destPc) | 0
  const clear = words.slice(sliceStart, sliceEnd).map((word) => {
    streamKey = (streamKey + 0x9e3779b9) | 0
    return (word ^ (streamKey ^ (streamKey >>> 13))) >>> 0
  })
  const segment = structuredClone(packetA.result)
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
  expect(diagnoseWordcode(packetA.result)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'unsupported-hardening-opcode' },
  })
  expect(observe(encoded)).toBe(observe(source))
})

test('the region observer follows later patches and closure entries without parsing decoys', () => {
  for (const [sourceText, encodedText, expectedPatches] of [
    [source, encoded, 2],
    [closureSource, closureEncoded, 7],
  ]) {
    const packet = packetFrom(encodedText)
    const original = packet.roles.words.values.slice()
    const diagnosis = diagnoseSelfModifyingRegions(packet)
    expect(diagnosis.ok).toBe(true)
    const observed = diagnosis.result
    expect(observed.complete).toBe(true)
    expect(observed.patches).toHaveLength(expectedPatches)
    expect(
      observed.reachableInstructions.filter((item) => item.name === 'PATCH'),
    ).toHaveLength(expectedPatches)
    expect(
      observed.patches.every((patch) => patch.destPc === patch.pc + 5),
    ).toBe(true)
    expect(packet.roles.words.values).toEqual(original)
    expect(observe(encodedText)).toEqual(observe(sourceText))
  }

  const closurePacket = packetFrom(closureEncoded)
  const closureObservation = diagnoseSelfModifyingRegions(closurePacket).result
  expect(
    closureObservation.reachableInstructions.filter(
      (instruction) => instruction.name === 'MAKE_CLOSURE',
    ),
  ).toHaveLength(2)
  expect(
    closureObservation.destinationIntervals.some(({ start, end }) =>
      closurePacket.roles.words.values
        .slice(start, end)
        .includes(closurePacket.roles.op.values.PATCH),
    ),
  ).toBe(true)
})

test('the observer names malformed real-patch intervals and ciphertext', () => {
  const packet = packetFrom(encoded)
  const valid = diagnoseSelfModifyingRegions(packet)
  expect(valid.ok).toBe(true)
  const [first, second] = valid.result.patches

  const destinationMismatch = modifiedPacket(packet, (words) => {
    words[first.pc + 1] += 1
  })
  expect(diagnoseSelfModifyingRegions(destinationMismatch)).toMatchObject({
    ok: false,
    diagnostic: { code: 'patch-destination' },
  })

  const overlappingSource = modifiedPacket(packet, (words) => {
    words[second.pc + 2] = first.sourceStart
    words[second.pc + 3] = first.sourceStart + second.width
  })
  expect(diagnoseSelfModifyingRegions(overlappingSource)).toMatchObject({
    ok: false,
    diagnostic: { code: 'patch-overlap' },
  })

  const damagedCiphertext = modifiedPacket(packet, (words) => {
    let key = (words[first.pc + 4] ^ first.destPc) | 0
    key = (key + 0x9e3779b9) | 0
    words[first.sourceStart] = (0xffffffff ^ (key ^ (key >>> 13))) >>> 0
  })
  expect(diagnoseSelfModifyingRegions(damagedCiphertext)).toMatchObject({
    ok: false,
    diagnostic: { code: 'patch-ciphertext' },
  })
})

test('a register-held finally continuation has a finite proved target', () => {
  const diagnosis = diagnoseSelfModifyingRegions(packetFrom(finallyEncoded))
  expect(diagnosis.ok).toBe(true)
  expect(diagnosis.result.complete).toBe(true)
  expect(diagnosis.result.unresolvedIndirectPcs).toHaveLength(0)
  expect(diagnosis.result.indirectTargets).toMatchObject([
    { pc: 134, sourceRegister: 3, targets: [143], origins: { 143: ['90'] } },
  ])
  expect(diagnosis.result.patches.length).toBeGreaterThan(1)
  expect(observe(finallyEncoded)).toEqual(observe(finallySource))
})
