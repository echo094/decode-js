import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import {
  diagnoseReferences,
  validateReferences,
} from '../../../src/vm/jsconfuser-vm/validate-references.js'

const repositoryRoot = new URL('../../../', import.meta.url)

function sourceAt(relativePath) {
  return fs.readFileSync(new URL(relativePath, repositoryRoot), 'utf8')
}

function packetAt(relativePath) {
  const container = extractContainerFromSource(sourceAt(relativePath))
  expect(container, `Packet A declined ${relativePath}`).not.toBeNull()
  const wordcode = readWordcode(container)
  expect(wordcode, `Packet B declined ${relativePath}`).not.toBeNull()
  return { container, wordcode }
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

test('returns immutable constants, references, labels, and root frame metadata', () => {
  const packet = packetAt('test/vm/jsconfuser-vm/fixtures/reference/encoded.js')
  const diagnosis = diagnoseReferences(packet.container, packet.wordcode)

  expect(diagnosis).toMatchObject({ ok: true, diagnostic: null })
  expect(diagnosis.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-references.v1',
    encoding: 'numeric-u32',
    wordCount: 32,
    instructionCount: 9,
    constants: { poolSize: packet.container.roles.pool.values.length },
    registers: { rootCount: 7, maxCount: 7, maxCaptureCount: 0 },
    frame: {
      frameStart: 1,
      headerSize: 8,
      mainStartPc: 0,
      mainRegCount: 7,
      root: {
        frameBase: 1,
        frameSize: 15,
        registerBase: 9,
        registerWindow: { start: 9, end: 16 },
        frameEnd: 16,
      },
    },
  })
  expect(diagnosis.result.frame.descriptors).toEqual([])
  expect(diagnosis.result.constants.values).toEqual(
    packet.container.roles.pool.values,
  )
  expect(diagnosis.result.labels.boundaries).toEqual(
    packet.wordcode.instructions.map(({ pc }) => pc),
  )
  expect(deepFrozen(diagnosis.result)).toBe(true)
  expect(validateReferences(packet.container, packet.wordcode)).toEqual(
    diagnosis.result,
  )
})

test('validates references for every tracked stripped raw and focused corpus input', () => {
  const paths = corpusPaths()
  expect(paths).toHaveLength(37)
  for (const relativePath of paths) {
    const packet = packetAt(relativePath)
    const diagnosis = diagnoseReferences(packet.container, packet.wordcode)
    expect(
      diagnosis.ok,
      `${relativePath}: ${diagnosis.diagnostic?.message}`,
    ).toBe(true)
  }
})

test('preserves frozen container and wordcode inputs', () => {
  const packet = packetAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
  )
  const before = {
    container: structuredClone(packet.container),
    wordcode: structuredClone(packet.wordcode),
  }
  const result = validateReferences(packet.container, packet.wordcode)
  expect(result).not.toBeNull()
  expect(packet.container).toEqual(before.container)
  expect(packet.wordcode).toEqual(before.wordcode)
  expect(deepFrozen(result)).toBe(true)
})
