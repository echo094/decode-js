import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cacheRoot,
  cellKey,
  ensureEncoder,
  expandCells,
  freshSeeds,
  generateMissing,
} from './jsconfuser-vm/support/cells.js'
import { fixtureRecipes, ignoreFile, ignoreList } from './fixture-recipes.js'

// Vitest global setup: write every recipe's encoded fixture that is missing from the
// test tree, generating it through the cell cache first. A present file is left as
// it is, so a local tree keeps its files until they are deleted.
export async function materializeFixtures() {
  const recipes = fixtureRecipes().map((recipe) => ({
    ...recipe,
    directory: path.join(cacheRoot, cellKey(recipe)),
  }))
  const missing = recipes.filter((recipe) => !fs.existsSync(recipe.file))
  // A cell generated before raw output was kept has no raw.js; regenerate it.
  for (const recipe of missing)
    if (recipe.listing && !fs.existsSync(path.join(recipe.directory, 'raw.js')))
      fs.rmSync(path.join(recipe.directory, 'cell.json'), { force: true })
  await generateMissing([
    ...new Map(missing.map((recipe) => [recipe.directory, recipe])).values(),
  ])
  for (const recipe of missing) {
    const cached = path.join(recipe.directory, recipe.listing ? 'raw.js' : 'encoded.js')
    if (!fs.existsSync(cached))
      throw new Error(`Generation failed for ${recipe.file}; see ${recipe.directory}/cell.json`)
    fs.copyFileSync(cached, recipe.file)
  }
  return missing.length
}

// Cell files generate in parallel, so the one encoder checkout is fetched before they start.
function prepareEncoder() {
  const generates = expandCells(freshSeeds()).some(
    ({ directory }) => !fs.existsSync(path.join(directory, 'cell.json')),
  )
  if (generates) ensureEncoder()
}

export default async function setup() {
  await materializeFixtures()
  prepareEncoder()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write-ignore')) fs.writeFileSync(ignoreFile, ignoreList())
  else console.log(`materialized ${await materializeFixtures()} fixtures`)
}
