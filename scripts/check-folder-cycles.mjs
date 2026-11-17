// Modules depend in one direction, and each is kept in its own folder (CONTRIBUTING.md,
// Dependencies): reads every relative
// import under `src`, joins the files into their folders, and fails when folders form a cycle,
// naming the imports behind each edge of it.
//   node scripts/check-folder-cycles.mjs [root]
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2] ?? 'src'
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g

function modules(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return modules(file)
    return /\.(m|c)?js$/.test(entry.name) ? [file] : []
  })
}

// Folder -> folder -> the file imports behind that edge.
function folderEdges(files) {
  const edges = new Map()
  for (const file of files)
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const from = path.dirname(file)
      const to = path.dirname(path.join(from, spec))
      if (from === to) continue
      if (!edges.has(from)) edges.set(from, new Map())
      const targets = edges.get(from)
      if (!targets.has(to)) targets.set(to, [])
      targets.get(to).push(`${path.basename(file)} -> ${path.basename(spec)}`)
    }
  return edges
}

// The strongly connected components of more than one folder (Tarjan).
function cycles(edges) {
  const index = new Map()
  const low = new Map()
  const stack = []
  const onStack = new Set()
  const found = []
  const visit = (folder) => {
    index.set(folder, index.size)
    low.set(folder, index.get(folder))
    stack.push(folder)
    onStack.add(folder)
    for (const next of edges.get(folder)?.keys() ?? []) {
      if (!index.has(next)) {
        visit(next)
        low.set(folder, Math.min(low.get(folder), low.get(next)))
      } else if (onStack.has(next))
        low.set(folder, Math.min(low.get(folder), index.get(next)))
    }
    if (low.get(folder) !== index.get(folder)) return
    const component = []
    let member
    do {
      member = stack.pop()
      onStack.delete(member)
      component.push(member)
    } while (member !== folder)
    if (component.length > 1) found.push(component)
  }
  for (const folder of edges.keys()) if (!index.has(folder)) visit(folder)
  return found
}

const edges = folderEdges(modules(root))
const found = cycles(edges)
for (const component of found) {
  console.error(`Folder cycle: ${component.join(', ')}`)
  for (const from of component)
    for (const [to, imports] of edges.get(from) ?? [])
      if (component.includes(to))
        console.error(`  ${from} -> ${to}: ${imports.join('; ')}`)
}
if (found.length) process.exit(1)
