import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import {
  diagnoseFunctionPartition,
  partitionFunctions,
} from '../../../src/vm/jsconfuser-vm/partition-functions.js'

const repositoryRoot = new URL('../../../', import.meta.url)

function sourceAt(relativePath) {
  return fs.readFileSync(new URL(relativePath, repositoryRoot), 'utf8')
}

function packetAt(relativePath) {
  const container = extractContainerFromSource(sourceAt(relativePath))
  expect(container, `Packet A declined ${relativePath}`).not.toBeNull()
  const wordcode = readWordcode(container)
  expect(wordcode, `Packet B declined ${relativePath}`).not.toBeNull()
  const references = validateReferences(container, wordcode)
  expect(references, `Packet C declined ${relativePath}`).not.toBeNull()
  return { container, wordcode, references }
}

function partitionAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnoseFunctionPartition(
    packet.container,
    packet.wordcode,
    packet.references,
  )
  expect(
    diagnosis.ok,
    `${relativePath}: ${diagnosis.diagnostic?.message}`,
  ).toBe(true)
  return { ...packet, result: diagnosis.result }
}

function deepFrozen(value) {
  if (!value || typeof value !== 'object') return true
  return (
    Object.isFrozen(value) &&
    Object.values(value).every((child) => deepFrozen(child))
  )
}

function corpusPaths() {
  return ['raw', 'focused'].flatMap((kind) => {
    const root = new URL(
      `test/vm/jsconfuser-vm/fixtures/corpus/${kind}/`,
      repositoryRoot,
    )
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map(
        (entry) =>
          `test/vm/jsconfuser-vm/fixtures/corpus/${kind}/${entry.name}/encoded.js`,
      )
      .filter((relativePath) =>
        fs.existsSync(new URL(relativePath, repositoryRoot)),
      )
      .sort()
  })
}

test('partitions the reference stream into one immutable root function', () => {
  const packet = partitionAt(
    'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
  )

  expect(packet.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-functions.v1',
    encoding: 'numeric-u32',
    wordCount: 32,
    instructionCount: 9,
    entryPcs: [0],
    functions: [
      {
        id: 0,
        kind: 'root',
        startPc: 0,
        endPc: 32,
        paramCount: 0,
        regCount: 7,
        captureCount: 0,
        hasRest: false,
        parentFunctionId: null,
        instructionCount: 9,
        descriptor: null,
        closureSites: [],
      },
    ],
    ownership: packet.wordcode.instructions.map((instruction) => ({
      pc: instruction.pc,
      functionId: 0,
    })),
    labels: [],
    frame: {
      frameStart: 1,
      headerSize: 8,
      root: { functionId: 0, startPc: 0, regCount: 7 },
    },
  })
  expect(deepFrozen(packet.result)).toBe(true)
  expect(
    partitionFunctions(packet.container, packet.wordcode, packet.references),
  ).toEqual(packet.result)
})

test('partitions nested closures and records unique parent/child creation sites', () => {
  const packet = partitionAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-closures-state/encoded.js',
  )

  expect(packet.result.entryPcs).toEqual([0, 55, 81])
  expect(
    packet.result.functions.map(
      ({ id, kind, startPc, endPc, parentFunctionId, instructionCount }) => ({
        id,
        kind,
        startPc,
        endPc,
        parentFunctionId,
        instructionCount,
      }),
    ),
  ).toEqual([
    {
      id: 0,
      kind: 'root',
      startPc: 0,
      endPc: 55,
      parentFunctionId: null,
      instructionCount: 14,
    },
    {
      id: 1,
      kind: 'closure',
      startPc: 55,
      endPc: 81,
      parentFunctionId: 0,
      instructionCount: 7,
    },
    {
      id: 2,
      kind: 'closure',
      startPc: 81,
      endPc: 111,
      parentFunctionId: 1,
      instructionCount: 10,
    },
  ])
  expect(packet.result.functions[0].closureSites).toMatchObject([
    {
      creationPc: 2,
      parentFunctionId: 0,
      childFunctionId: 1,
      childStartPc: 55,
      destinationRegister: 4,
    },
  ])
  expect(packet.result.functions[1].closureSites).toMatchObject([
    {
      creationPc: 64,
      parentFunctionId: 1,
      childFunctionId: 2,
      childStartPc: 81,
      destinationRegister: 3,
    },
  ])
  expect(packet.result.functions[2].closureSites).toEqual([])

  const ownedPcs = packet.result.functions.flatMap(
    ({ instructionPcs }) => instructionPcs,
  )
  expect(ownedPcs).toEqual(packet.wordcode.instructions.map(({ pc }) => pc))
  expect(packet.result.ownership).toEqual(
    packet.wordcode.instructions.map(({ pc }) => ({
      pc,
      functionId: packet.result.functions.find(({ instructionPcs }) =>
        instructionPcs.includes(pc),
      ).id,
    })),
  )
})

test('keeps exceptional labels local while partitioning multiple closures', () => {
  const packet = partitionAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-finally-abrupt/encoded.js',
  )

  expect(packet.result.entryPcs).toEqual([0, 102, 182, 255, 372])
  expect(
    packet.result.functions.map(({ startPc, endPc }) => [startPc, endPc]),
  ).toEqual([
    [0, 102],
    [102, 182],
    [182, 255],
    [255, 372],
    [372, 517],
  ])
  expect(
    packet.result.functions.map(({ closureSites }) => closureSites.length),
  ).toEqual([4, 0, 0, 0, 0])
  expect(
    packet.result.labels
      .filter(({ role }) => role !== 'functionEntry')
      .every(
        ({ sourceFunctionId, targetFunctionId }) =>
          sourceFunctionId === targetFunctionId,
      ),
  ).toBe(true)
})

test('partitions every tracked stripped raw and focused corpus input', () => {
  const paths = corpusPaths()
  expect(paths).toHaveLength(37)
  for (const relativePath of paths) {
    const packet = packetAt(relativePath)
    const diagnosis = diagnoseFunctionPartition(
      packet.container,
      packet.wordcode,
      packet.references,
    )
    expect(
      diagnosis.ok,
      `${relativePath}: ${diagnosis.diagnostic?.message}`,
    ).toBe(true)
    expect(diagnosis.result.entryPcs[0]).toBe(0)
    expect(diagnosis.result.functions.at(-1).endPc).toBe(
      diagnosis.result.wordCount,
    )
    expect(diagnosis.result.ownership).toHaveLength(
      diagnosis.result.instructionCount,
    )
  }
})

test('does not mutate accepted frozen predecessor packets', () => {
  const packet = packetAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
  )
  const before = structuredClone(packet)
  const result = partitionFunctions(
    packet.container,
    packet.wordcode,
    packet.references,
  )

  expect(result).not.toBeNull()
  expect(packet).toEqual(before)
  expect(deepFrozen(result)).toBe(true)
  expect(() => result.functions.push({})).toThrow()
  expect(() => (result.functions[0].startPc = 99)).toThrow()
})
