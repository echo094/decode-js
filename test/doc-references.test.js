import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { expect, test } from 'vitest'

// This repository ships alone, so its code and tests may name only documents it holds itself. A
// comment citing a document kept outside it cannot be resolved by a reader of this repository,
// and goes stale unseen when that document moves. The check sees file names only: a cited section
// title or worklist label must be kept out by review.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCANNED = ['src', 'test', 'scripts']
const OUTSIDE = new Set(['.git', 'node_modules', 'sandbox-tests'])
const SKIPPED = new Set([...OUTSIDE, 'fixtures'])
const CODE = /\.(?:js|mjs|cjs)$/

function walk(directory, visit, skipped = SKIPPED) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full, visit, skipped)
    else visit(full)
  }
}

function heldDocuments() {
  const names = new Set()
  walk(
    root,
    (file) => {
      if (file.endsWith('.md')) names.add(path.basename(file))
    },
    OUTSIDE,
  )
  return names
}

function foreignDocuments(text, held) {
  return [...text.matchAll(/[\w.-]+\.md\b/g)]
    .map((match) => match[0])
    .filter((name) => !held.has(name))
}

test('foreignDocuments reports a document this repository does not hold', () => {
  // The cited name is assembled so this file does not itself cite it.
  const cited = ['control-flow', 'md'].join('.')
  const held = new Set(['README.md'])
  expect(
    foreignDocuments(`// see README.md and ${cited} item 4`, held),
  ).toEqual([cited])
})

test('code, tests and scripts name no document outside this repository', () => {
  const held = heldDocuments()
  const found = []
  for (const directory of SCANNED)
    walk(path.join(root, directory), (file) => {
      if (!CODE.test(file)) return
      for (const name of foreignDocuments(fs.readFileSync(file, 'utf8'), held))
        found.push(`${path.relative(root, file)}: ${name}`)
    })
  expect(found).toEqual([])
})
