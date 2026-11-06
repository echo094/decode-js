import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { fixtureRecipes, ignoreFile, ignoreList } from './fixture-recipes.js'

// Encoded VM inputs that stay committed: the second encoder's layered outputs and one
// ordinary non-VM input. Every other encoded input is generated from its recipe.
const committedInputs = [
  'jsconfuser-vm/fixtures/layer-pair-arithmetic/outer-complete.js',
  'jsconfuser-vm/fixtures/layer-pair-arithmetic/outer-without-string-concealing.js',
  'jsconfuser-vm/fixtures/legacy-common/common.js',
  'jsconfuser-vm/fixtures/outer-layers/compact.encoded.js',
  'jsconfuser-vm/fixtures/outer-layers/minify.encoded.js',
  'jsconfuser-vm/fixtures/outer-layers/moved-declarations.encoded.js',
  'jsconfuser-vm/fixtures/outer-layers/object-extraction.encoded.js',
  'jsconfuser-vm/fixtures/outer-layers/variable-masking.encoded.js',
]
const testRoot = fileURLToPath(new URL('./', import.meta.url))
const walk = (directory) =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    )
const isInput = (file) =>
  file.endsWith('.js') &&
  !/(source|\.src|decoded)\.js$/.test(file) &&
  !/\/src\//.test(file)

test('the ignore list names exactly the generated fixtures', () => {
  expect(fs.readFileSync(ignoreFile, 'utf8')).toBe(ignoreList())
})

test('every encoded input is generated from a recipe or listed as committed', () => {
  const generated = new Set(
    fixtureRecipes().map(({ file }) => path.relative(testRoot, file)),
  )
  const inputs = walk(path.join(testRoot, 'jsconfuser-vm/fixtures'))
    .filter(isInput)
    .map((file) => path.relative(testRoot, file))
  expect(inputs.filter((file) => !generated.has(file)).sort()).toEqual(
    committedInputs,
  )
  for (const file of generated)
    expect(fs.existsSync(path.join(testRoot, file)), file).toBe(true)
})
