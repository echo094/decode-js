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

function analysesAt(relativePath) {
  const container = extractContainerFromSource(sourceAt(relativePath))
  expect(container, `extract-container declined ${relativePath}`).not.toBeNull()
  const wordcode = readWordcode(container)
  expect(wordcode, `read-wordcode declined ${relativePath}`).not.toBeNull()
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
  const analyses = analysesAt(
    'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
  )
  const diagnosis = diagnoseReferences(analyses.container, analyses.wordcode)

  expect(diagnosis).toMatchObject({ ok: true, diagnostic: null })
  expect(diagnosis.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-references.v1',
    encoding: 'numeric-u32',
    wordCount: 32,
    instructionCount: 9,
    constants: { poolSize: analyses.container.roles.pool.values.length },
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
    analyses.container.roles.pool.values,
  )
  expect(diagnosis.result.labels.boundaries).toEqual(
    analyses.wordcode.instructions.map(({ pc }) => pc),
  )
  expect(deepFrozen(diagnosis.result)).toBe(true)
  expect(validateReferences(analyses.container, analyses.wordcode)).toEqual(
    diagnosis.result,
  )
})

test('validates references for every tracked stripped raw and focused corpus input', () => {
  const paths = corpusPaths()
  expect(paths).toHaveLength(37)
  for (const relativePath of paths) {
    const analyses = analysesAt(relativePath)
    const diagnosis = diagnoseReferences(analyses.container, analyses.wordcode)
    expect(
      diagnosis.ok,
      `${relativePath}: ${diagnosis.diagnostic?.message}`,
    ).toBe(true)
  }
})

test('preserves frozen container and wordcode inputs', () => {
  const analyses = analysesAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
  )
  const before = {
    container: structuredClone(analyses.container),
    wordcode: structuredClone(analyses.wordcode),
  }
  const result = validateReferences(analyses.container, analyses.wordcode)
  expect(result).not.toBeNull()
  expect(analyses.container).toEqual(before.container)
  expect(analyses.wordcode).toEqual(before.wordcode)
  expect(deepFrozen(result)).toBe(true)
})
