import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import {
  buildControlFlow,
  diagnoseControlFlow,
} from '../../../src/vm/jsconfuser-vm/build-cfg.js'

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
  const functions = partitionFunctions(container, wordcode, references)
  expect(functions, `Packet D declined ${relativePath}`).not.toBeNull()
  return { container, wordcode, references, functions }
}

function cfgAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnoseControlFlow(
    packet.wordcode,
    packet.references,
    packet.functions,
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

function edgeCounts(result) {
  return Object.fromEntries(
    [...new Set(result.edges.map(({ kind }) => kind))]
      .sort()
      .map((kind) => [
        kind,
        result.edges.filter((edge) => edge.kind === kind).length,
      ]),
  )
}

test('builds an immutable reference CFG with an explicit return edge', () => {
  const packet = cfgAt('test/vm/jsconfuser-vm/fixtures/reference/encoded.js')

  expect(packet.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-cfg.v1',
    encoding: 'numeric-u32',
    wordCount: 32,
    instructionCount: 9,
    functionCount: 1,
    indirectTargets: [],
    functions: [
      {
        id: 0,
        startPc: 0,
        endPc: 32,
        instructionCount: 9,
        irreducible: { required: false, fallback: null },
      },
    ],
  })
  expect(edgeCounts(packet.result)).toEqual({ fallthrough: 8, return: 1 })
  expect(packet.result.edges.at(-1)).toMatchObject({
    kind: 'return',
    sourcePc: 30,
    targetPc: null,
    route: 'propagate',
  })
  expect(deepFrozen(packet.result)).toBe(true)
})

test('builds closure CFGs with call continuations and no indirect targets', () => {
  const packet = cfgAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-closures-state/encoded.js',
  )

  expect(
    packet.result.functions.map(({ id, startPc, endPc }) => [
      id,
      startPc,
      endPc,
    ]),
  ).toEqual([
    [0, 0, 55],
    [1, 55, 81],
    [2, 81, 111],
  ])
  expect(
    packet.result.functions.reduce((count, fn) => count + fn.blocks.length, 0),
  ).toBe(29)
  expect(edgeCounts(packet.result)).toEqual({
    call: 4,
    fallthrough: 20,
    return: 3,
    throw: 4,
  })
  expect(packet.result.callSites).toHaveLength(4)
  expect(
    packet.result.callSites.every(
      ({ continuationPc, returnDestination }) =>
        continuationPc !== null && returnDestination.kind === 'register',
    ),
  ).toBe(true)
  expect(packet.result.indirectTargets).toEqual([])
})

test('builds finally and abrupt CFGs with finite JUMP_REG branches', () => {
  const packet = cfgAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-finally-abrupt/encoded.js',
  )

  expect(
    packet.result.functions.map(({ startPc, endPc }) => [startPc, endPc]),
  ).toEqual([
    [0, 102],
    [102, 182],
    [182, 255],
    [255, 372],
    [372, 517],
  ])
  expect(edgeCounts(packet.result)).toEqual({
    branch: 14,
    call: 13,
    conditional: 3,
    fallthrough: 101,
    finally: 11,
    handler: 3,
    return: 5,
    throw: 12,
  })
  expect(packet.result.edges).toHaveLength(162)
  expect(
    packet.result.functions.reduce((count, fn) => count + fn.blocks.length, 0),
  ).toBe(145)
  expect(
    packet.result.indirectTargets.map(
      ({ functionId, pc, sourceRegister, targets }) => ({
        functionId,
        pc,
        sourceRegister,
        targets,
      }),
    ),
  ).toEqual([
    { functionId: 1, pc: 170, sourceRegister: 2, targets: [172, 174] },
    { functionId: 2, pc: 245, sourceRegister: 3, targets: [247, 249] },
    { functionId: 3, pc: 303, sourceRegister: 5, targets: [305] },
    { functionId: 3, pc: 362, sourceRegister: 3, targets: [364, 366] },
    {
      functionId: 4,
      pc: 487,
      sourceRegister: 3,
      targets: [489, 491, 493, 495],
    },
  ])
  for (const jump of packet.result.indirectTargets) {
    const successors = packet.result.edges.filter(
      ({ sourcePc }) => sourcePc === jump.pc,
    )
    expect(successors).toHaveLength(jump.targets.length)
    expect(
      successors.every(
        ({ kind, mode }) => kind === 'branch' && mode === 'indirect',
      ),
    ).toBe(true)
  }
})

test('accepts every stripped raw and focused corpus cell', () => {
  const paths = corpusPaths()
  expect(paths).toHaveLength(37)
  for (const relativePath of paths) {
    const packet = cfgAt(relativePath)
    expect(packet.result.functions[0].startPc).toBe(0)
    expect(packet.result.functions.at(-1).endPc).toBe(packet.result.wordCount)
    expect(packet.result.ownership).toHaveLength(packet.result.instructionCount)
    expect(
      packet.result.edges.every(
        ({ handlerStateBefore, handlerStateAfter }) =>
          deepFrozen(handlerStateBefore) && deepFrozen(handlerStateAfter),
      ),
    ).toBe(true)
  }
})

test('does not mutate frozen predecessors and freezes successful output', () => {
  const packet = packetAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
  )
  const before = structuredClone(packet)
  const result = buildControlFlow(
    packet.wordcode,
    packet.references,
    packet.functions,
  )
  expect(result).not.toBeNull()
  expect(packet).toEqual(before)
  expect(deepFrozen(result)).toBe(true)
  expect(() => result.functions.push({})).toThrow()
  expect(() => (result.functions[0].startPc = 99)).toThrow()
})
