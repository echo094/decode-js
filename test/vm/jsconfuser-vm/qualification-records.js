import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('fixtures/', import.meta.url))
export const focusedOracles = [
  'caught-return-through-finally',
  'protected-conditional-catch',
  'return-through-finally',
  'terminal-switch-arms',
]
export function records(directory = root) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name)
    return entry.isDirectory()
      ? records(name)
      : /^qualification(?:-\d+)?\.json$/.test(entry.name)
        ? [name]
        : []
  })
}
// A record's suffix names its encoded file; the common source file is shared.
export function readCell(filename) {
  const record = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const suffix = path.basename(filename, '.json').slice('qualification'.length)
  const directory = path.dirname(filename)
  return {
    record,
    sourcePath: path.join(directory, 'source.js'),
    encodedPath: path.join(directory, `encoded${suffix}.js`),
  }
}
export function readOracle(name) {
  const directory = path.join(root, 'corpus/focused', name)
  return {
    oracle: JSON.parse(
      fs.readFileSync(path.join(directory, 'oracle.json'), 'utf8'),
    ),
    directory,
  }
}
