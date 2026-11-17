import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { beforeAll, expect, test } from 'vitest'
import {
  expandCells,
  generateMissing,
  inertCells,
  suites,
  plainCell,
  readCell,
} from '../support/cells.js'
import { isStageSuite, payload } from '../support/stage-effect.js'

// Cells are chosen, not multiplied: a repeat or a stage that changed nothing adds time and no
// proof (M4), so a new source or suite cannot bring them back unseen. Nothing here decodes.
const cells = expandCells()

beforeAll(async () => {
  await generateMissing([...cells, ...inertCells, ...inertCells.map(plainCell)])
}, 3600000)

test('every suite file has its test file and every test file a suite', () => {
  const root = new URL('./', import.meta.url)
  const files = fs
    .readdirSync(root, { recursive: true })
    .filter(
      (file) =>
        path.dirname(file) !== '.' &&
        file.endsWith('.test.js') &&
        path.basename(file) !== 'stage-effect.test.js',
    )
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
    .filter(({ suite, name, protects }) => {
      const about = suites.find((entry) => entry.name === suite)
      return !(protects ?? (about.cases ? about.cases[name] : about.protects))
    })
    .map(({ id }) => id)
  expect(silent).toEqual([])
})

// A proof is a break: replacing `find` with `replace` in `file` turns the claim's cells red (M4).
// It holds only while `find` stands once in the file; re-prove it after a change.
test('every proof still applies its break to exactly one place', () => {
  const root = new URL('../../../../', import.meta.url)
  const invalid = suites
    .flatMap(({ proofs = [] }) => proofs)
    .filter(
      ({ file, find, replace }) =>
        typeof replace !== 'string' ||
        find === replace ||
        fs.readFileSync(new URL(file, root), 'utf8').split(find).length !== 2,
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
  expect(inertCells.every(({ protects }) => protects)).toBe(true)
  const changed = inertCells
    .filter((cell) => payload(cell) !== payload(plainCell(cell)))
    .map(({ id }) => id)
  expect(changed).toEqual([])
})

// The stage-changes-the-program check runs per stage suite, from <suite>/stage-effect.test.js.
test('every stage suite has its stage-effect file and every such file a stage suite', () => {
  const owners = suites
    .map(({ name }) => name)
    .filter((name) =>
      fs.existsSync(new URL(`./${name}/stage-effect.test.js`, import.meta.url)),
    )
  expect(owners).toEqual(suites.map(({ name }) => name).filter(isStageSuite))
})
