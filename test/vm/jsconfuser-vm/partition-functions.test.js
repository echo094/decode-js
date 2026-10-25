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

function analysesAt(relativePath) {
  const container = extractContainerFromSource(sourceAt(relativePath))
  expect(container, `extract-container declined ${relativePath}`).not.toBeNull()
  const wordcode = readWordcode(container)
  expect(wordcode, `read-wordcode declined ${relativePath}`).not.toBeNull()
  const references = validateReferences(container, wordcode)
  expect(
    references,
    `validate-references declined ${relativePath}`,
  ).not.toBeNull()
  return { container, wordcode, references }
}

function partitionAt(relativePath) {
  const analyses = analysesAt(relativePath)
  const diagnosis = diagnoseFunctionPartition(
    analyses.container,
    analyses.wordcode,
    analyses.references,
  )
  expect(
    diagnosis.ok,
    `${relativePath}: ${diagnosis.diagnostic?.message}`,
  ).toBe(true)
  return { ...analyses, result: diagnosis.result }
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
  const analyses = partitionAt(
    'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
  )

  expect(analyses.result).toMatchObject({
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
    ownership: analyses.wordcode.instructions.map((instruction) => ({
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
  expect(deepFrozen(analyses.result)).toBe(true)
  expect(
    partitionFunctions(
      analyses.container,
      analyses.wordcode,
      analyses.references,
    ),
  ).toEqual(analyses.result)
})

test('partitions nested closures and records unique parent/child creation sites', () => {
  const analyses = partitionAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-closures-state/encoded.js',
  )

  expect(analyses.result.entryPcs).toEqual([0, 55, 81])
  expect(
    analyses.result.functions.map(
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
  expect(analyses.result.functions[0].closureSites).toMatchObject([
    {
      creationPc: 2,
      parentFunctionId: 0,
      childFunctionId: 1,
      childStartPc: 55,
      destinationRegister: 4,
    },
  ])
  expect(analyses.result.functions[1].closureSites).toMatchObject([
    {
      creationPc: 64,
      parentFunctionId: 1,
      childFunctionId: 2,
      childStartPc: 81,
      destinationRegister: 3,
    },
  ])
  expect(analyses.result.functions[2].closureSites).toEqual([])

  const ownedPcs = analyses.result.functions.flatMap(
    ({ instructionPcs }) => instructionPcs,
  )
  expect(ownedPcs).toEqual(analyses.wordcode.instructions.map(({ pc }) => pc))
  expect(analyses.result.ownership).toEqual(
    analyses.wordcode.instructions.map(({ pc }) => ({
      pc,
      functionId: analyses.result.functions.find(({ instructionPcs }) =>
        instructionPcs.includes(pc),
      ).id,
    })),
  )
})

test('keeps exceptional labels local while partitioning multiple closures', () => {
  const analyses = partitionAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-finally-abrupt/encoded.js',
  )

  expect(analyses.result.entryPcs).toEqual([0, 102, 182, 255, 372])
  expect(
    analyses.result.functions.map(({ startPc, endPc }) => [startPc, endPc]),
  ).toEqual([
    [0, 102],
    [102, 182],
    [182, 255],
    [255, 372],
    [372, 517],
  ])
  expect(
    analyses.result.functions.map(({ closureSites }) => closureSites.length),
  ).toEqual([4, 0, 0, 0, 0])
  expect(
    analyses.result.labels
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
    const analyses = analysesAt(relativePath)
    const diagnosis = diagnoseFunctionPartition(
      analyses.container,
      analyses.wordcode,
      analyses.references,
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

test('does not mutate accepted frozen predecessor records', () => {
  const analyses = analysesAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
  )
  const before = structuredClone(analyses)
  const result = partitionFunctions(
    analyses.container,
    analyses.wordcode,
    analyses.references,
  )

  expect(result).not.toBeNull()
  expect(analyses).toEqual(before)
  expect(deepFrozen(result)).toBe(true)
  expect(() => result.functions.push({})).toThrow()
  expect(() => (result.functions[0].startPc = 99)).toThrow()
})
