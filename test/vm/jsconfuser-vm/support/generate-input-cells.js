import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ensureEncoder,
  expandCells,
  freshSeeds,
  generateMissing,
  inputCells,
} from './cells.js'

// Vitest global setup: generate the input cells, the encoded inputs of the tests that are not
// cells, so those tests run no encoder and only look an input up (cells.js inputPath).
export async function generateInputCells() {
  // A cell generated before raw output was kept has no raw.js, which a listing input reads.
  for (const cell of inputCells)
    if (!fs.existsSync(path.join(cell.directory, 'raw.js')))
      fs.rmSync(path.join(cell.directory, 'cell.json'), { force: true })
  return generateMissing(inputCells)
}

// Cell files generate in parallel, so the one encoder checkout is fetched before they start.
function prepareEncoder() {
  const generates = expandCells(freshSeeds()).some(
    ({ directory }) => !fs.existsSync(path.join(directory, 'cell.json')),
  )
  if (generates) ensureEncoder()
}

export default async function setup() {
  await generateInputCells()
  prepareEncoder()
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(`generated ${await generateInputCells()} input cells`)
