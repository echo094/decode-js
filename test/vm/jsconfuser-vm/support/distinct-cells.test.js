import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { beforeAll, expect, test } from 'vitest'
import {
  expandCells,
  generateMissing,
  suites,
  plainCell,
  readCell,
} from './cells.js'
import { isStageSuite, payload } from './stage-effect.js'

// Cells are chosen, not multiplied: a repeat or a stage that changed nothing adds time and no
// proof (M4), so a new source or suite cannot bring them back unseen. Nothing here decodes.
const cells = expandCells()
const inertControls = suites.flatMap(({ inertControls: names = [] }) => names)

beforeAll(async () => {
  await generateMissing([
    ...cells,
    ...cells.filter(({ name }) => inertControls.includes(name)).map(plainCell),
  ])
}, 3600000)

test('every suite file has its test file and every test file a suite', () => {
  const root = new URL('../generated-cells/', import.meta.url)
  const files = fs
    .readdirSync(root, { recursive: true })
    .filter((file) => file.endsWith('.test.js'))
  expect(files.sort()).toEqual(
    suites
      .flatMap(({ name, files: suiteFiles }) =>
        Object.keys(suiteFiles).map((file) =>
          path.join(name, `${file}.test.js`),
        ),
      )
      .sort(),
  )
})

test('every suite and condition says what it protects', () => {
  const silent = cells
    .filter(({ suite, name }) => {
      const about = suites.find((entry) => entry.name === suite)
      return about.cases ? !about.cases[name] : !about.protects
    })
    .map(({ id }) => id)
  expect(silent).toEqual([])
})

// A Proved line holds only while the code it was proved against stands; re-prove it after a change.
test('every proved protection still names code that exists', () => {
  const root = new URL('../../../../', import.meta.url)
  const invalid = suites
    .flatMap(({ proofs = [] }) => proofs)
    .filter(
      ({ file, code }) =>
        !fs.readFileSync(new URL(file, root), 'utf8').includes(code),
    )
    .map(({ claim, file }) => `${claim}: ${file}`)
  expect(invalid).toEqual([])
})

test('no two cells encode the same text', () => {
  const seen = new Map()
  const repeats = []
  for (const cell of cells) {
    const text = crypto
      .createHash('sha256')
      .update(readCell(cell).encoded)
      .digest('hex')
    if (seen.has(text)) repeats.push(`${seen.get(text)} = ${cell.id}`)
    else seen.set(text, cell.id)
  }
  expect(repeats.join('\n')).toBe('')
})

test('an inert control shows no stage effect', () => {
  const inert = cells.filter(({ name }) => inertControls.includes(name))
  expect(inert.length).toBe(inertControls.length * 3)
  const changed = inert
    .filter((cell) => payload(cell) !== payload(plainCell(cell)))
    .map(({ id }) => id)
  expect(changed).toEqual([])
})

// The stage-changes-the-program check runs per stage suite, from stage-effect/<suite>.test.js.
test('every stage suite has its stage-effect file and every such file a stage suite', () => {
  const files = fs
    .readdirSync(new URL('../stage-effect/', import.meta.url))
    .filter((file) => file.endsWith('.test.js'))
  expect(files.sort()).toEqual(
    suites
      .map(({ name }) => name)
      .filter(isStageSuite)
      .map((name) => `${name}.test.js`)
      .sort(),
  )
})
