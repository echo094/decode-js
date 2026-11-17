// Proof census: which cells does each recorded proof's break turn red? A suite keeps a cell only
// if a break that is not broad turns it red, and a proof is that break; this applies the breaks.
//   node scripts/proof-census.mjs prepare                 copy the decoder into the workspace
//   node scripts/proof-census.mjs suite <name> [break..]  the suite clean, then under each break
//   node scripts/proof-census.mjs report <name>           cell by break, from the suite's results
//   node scripts/proof-census.mjs cross                   every effective break over the cross pool
// The workspace is the ignored sandbox-tests/proof-census/: copy/ is the decoder with its own copy
// of the cell cache, so a broken decode never writes into the real one; results/ holds one
// <suite>.jsonl per run. A break replaces a proof's `find`, which stands once in its file, with
// its `replace`; the file must still parse. breaks.json in the workspace, `{ "<suite>#<name>":
// { file, find, replace } }`, adds breaks to try before one is recorded as a proof. Run prepare
// again after any change to the decoder. Minify cells need a JDK (audit.mjs javaRoot).
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parse } from '@babel/parser'
import { decoderRoot, encoderRoot } from './jsconfuser-vm-cells/audit.mjs'

const workspace = path.join(decoderRoot, 'sandbox-tests/proof-census')
const copy = path.join(workspace, 'copy')
const pristine = path.join(workspace, 'pristine-src')
const results = path.join(workspace, 'results')
const suiteRoot = 'test/vm/jsconfuser-vm/cell-suites'
const deadlineMs = 20 * 60 * 1000
// The copy encodes with the checkout the decoder's own tests use.
const environment = { ...process.env, JSCONFUSER_VM_ENCODER: encoderRoot }

const readRows = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
// The latest row of each break in one results file.
const latestRows = (file) => [
  ...new Map(readRows(file).map((row) => [row.break, row])).values(),
]
const resultFiles = () =>
  fs.readdirSync(results).filter((file) => file.endsWith('.jsonl'))
const redCount = (cells) =>
  Object.values(cells ?? {}).filter((cell) => cell.red).length

function prepare() {
  fs.rmSync(copy, { recursive: true, force: true })
  fs.mkdirSync(path.join(copy, 'sandbox-tests'), { recursive: true })
  fs.mkdirSync(results, { recursive: true })
  const sync = (...args) => execFileSync('rsync', ['-a', ...args])
  sync(
    '--exclude=.git',
    '--exclude=node_modules',
    '--exclude=sandbox-tests',
    '--exclude=coverage',
    `${decoderRoot}/`,
    `${copy}/`,
  )
  fs.symlinkSync(
    path.join(decoderRoot, 'node_modules'),
    path.join(copy, 'node_modules'),
  )
  const cache = path.join(decoderRoot, 'sandbox-tests/vm-cells')
  if (fs.existsSync(cache))
    sync(`${cache}/`, `${path.join(copy, 'sandbox-tests/vm-cells')}/`)
  sync('--delete', `${decoderRoot}/src/`, `${pristine}/`)
  console.log('prepared', copy)
}

const restoreSource = () =>
  execFileSync('rsync', ['-a', '--delete', `${pristine}/`, `${copy}/src/`])

async function cellSupport() {
  process.env.JSCONFUSER_VM_ENCODER = encoderRoot
  return import(
    pathToFileURL(path.join(copy, 'test/vm/jsconfuser-vm/support/cells.js'))
  )
}

function breaksOf(suite) {
  const file = path.join(workspace, 'breaks.json')
  const tried = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {}
  const own = (suite.proofs ?? []).map((proof, index) => ({
    id: `${suite.name}#${index}`,
    ...proof,
  }))
  const extra = Object.entries(tried)
    .filter(([id]) => id.startsWith(`${suite.name}#`))
    .map(([id, edit]) => ({ id, ...edit }))
  return [...own, ...extra]
}

// Null when the break is applied; otherwise why it cannot be.
function applyBreak({ file, find, replace }) {
  const target = path.join(copy, file)
  const text = fs.readFileSync(target, 'utf8')
  const count = text.split(find).length - 1
  if (count !== 1) return `find stands ${count} times`
  const broken = text.replace(find, () => replace)
  try {
    parse(broken, { sourceType: 'module' })
  } catch {
    return 'the break does not parse'
  }
  fs.writeFileSync(target, broken)
  return null
}

// One Vitest run in the copy over the given paths; VM_CELLS narrows it to the named cells.
function runCells(paths, out, cellIds) {
  const escape = (id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const env = cellIds
    ? { ...environment, VM_CELLS: `^(${cellIds.map(escape).join('|')})$` }
    : environment
  fs.rmSync(out, { force: true })
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(
      'npx',
      [
        'vitest',
        'run',
        ...paths,
        '--coverage.enabled=false',
        '--reporter=json',
        `--outputFile=${out}`,
      ],
      { cwd: copy, detached: true, stdio: ['ignore', 'ignore', 'pipe'], env },
    )
    let stderr = ''
    child.stderr.on('data', (data) => (stderr = (stderr + data).slice(-4000)))
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // The run already ended.
      }
    }, deadlineMs)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      const seconds = Math.round((Date.now() - started) / 1000)
      resolve({ code, signal, seconds, stderr })
    })
  })
}

// Each cell's outcome from a Vitest JSON report: a cell's tests sit under its id.
function readOutcome(out, cellIds) {
  if (!fs.existsSync(out)) return null
  const known = new Set(cellIds)
  const cells = Object.fromEntries(
    cellIds.map((id) => [id, { red: false, why: [] }]),
  )
  for (const file of JSON.parse(fs.readFileSync(out, 'utf8')).testResults)
    for (const assertion of file.assertionResults) {
      const id = assertion.ancestorTitles[0]
      if (!known.has(id) || assertion.status !== 'failed') continue
      const message = (assertion.failureMessages[0] ?? '').split('\n')[0]
      cells[id].red = true
      cells[id].why.push(
        `${assertion.title.slice(0, 40)}: ${message.slice(0, 160)}`,
      )
    }
  return cells
}

// The clean run, then one run per break, appended to `log`.
async function census(label, breaks, paths, cellIds, log, narrowed) {
  const out = log.replace(/\.jsonl$/, '.last.json')
  for (const edit of [{ id: 'baseline' }, ...breaks]) {
    restoreSource()
    const problem = edit.id === 'baseline' ? null : applyBreak(edit)
    const { id, claim, file, find, replace } = edit
    const row = { break: id, claim, file, find, replace }
    if (problem) {
      fs.appendFileSync(log, JSON.stringify({ ...row, problem }) + '\n')
      console.log(label, id, 'SKIPPED', problem)
      continue
    }
    const run = await runCells(paths, out, narrowed ? cellIds : null)
    const cells = readOutcome(out, cellIds)
    fs.appendFileSync(
      log,
      JSON.stringify({
        ...row,
        seconds: run.seconds,
        exit: run.code,
        signal: run.signal,
        cells,
        stderr: cells ? undefined : run.stderr,
      }) + '\n',
    )
    console.log(
      label,
      id,
      `${cells ? redCount(cells) : '?'}/${cellIds.length} red`,
      `${run.seconds}s`,
    )
  }
  restoreSource()
}

async function runSuite(name, only) {
  const support = await cellSupport()
  const suite = support.suites.find((item) => item.name === name)
  if (!suite) throw new Error(`no suite ${name}`)
  const cellIds = support
    .expandCells([])
    .filter((cell) => cell.suite === name)
    .map(({ id }) => id)
  const breaks = breaksOf(suite).filter(
    ({ id }) => !only.length || only.includes(id),
  )
  await census(
    name,
    breaks,
    [path.join(suiteRoot, name)],
    cellIds,
    path.join(results, `${name}.jsonl`),
    false,
  )
}

// A break that deletes a binding and fails every cell crashes on the missing name: no proof.
function vacuous(row) {
  const declares = (text) => /^\s*(const|let|var)\s/.test(text ?? '')
  const cells = Object.values(row.cells ?? {})
  return (
    declares(row.find) &&
    !declares(row.replace) &&
    cells.length > 0 &&
    cells.every((cell) => cell.red)
  )
}

function report(name) {
  const rows = latestRows(path.join(results, `${name}.jsonl`))
  const runs = rows.filter((row) => row.cells && !vacuous(row))
  const ids = Object.keys(runs[0]?.cells ?? {}).sort()
  for (const row of rows) {
    const outcome =
      row.problem ??
      `${redCount(row.cells)}/${ids.length} red, ${row.seconds}s` +
        (vacuous(row) ? ' VACUOUS: every cell fails on a missing name' : '')
    console.log(`${row.break}: ${outcome}`)
  }
  console.log()
  for (const id of ids) {
    const reds = runs
      .filter((row) => row.cells[id]?.red)
      .map((row) => row.break)
    const state = reds.includes('baseline')
      ? 'BASE-RED'
      : reds.length
        ? 'kept    '
        : 'UNPROVED'
    console.log(state, id, reds.join(' '))
  }
}

const suiteRows = () =>
  resultFiles()
    .filter((file) => file !== 'cross.jsonl')
    .flatMap((file) => latestRows(path.join(results, file)))
    .filter((row) => row.break !== 'baseline' && row.cells && !vacuous(row))

// The breaks that turned some cell of their own suite red, one per edit.
function effectiveBreaks() {
  const breaks = new Map()
  for (const row of suiteRows()) {
    if (!redCount(row.cells)) continue
    const key = JSON.stringify([row.file, row.find, row.replace])
    if (!breaks.has(key))
      breaks.set(key, {
        id: row.break,
        file: row.file,
        find: row.find,
        replace: row.replace,
      })
  }
  return [...breaks.values()]
}

// The cross pool: every cell no break of its own suite turned red, in the suites already run and
// in the suites that record no proof.
async function crossPool() {
  const support = await cellSupport()
  const proved = new Set(
    suiteRows().flatMap((row) =>
      Object.entries(row.cells)
        .filter(([, cell]) => cell.red)
        .map(([id]) => id),
    ),
  )
  const ran = new Set(resultFiles().map((file) => file.replace('.jsonl', '')))
  const unproved = new Set(
    support.suites
      .filter((suite) => !suite.proofs?.length)
      .map(({ name }) => name),
  )
  return support
    .expandCells([])
    .filter(
      (cell) =>
        unproved.has(cell.suite) ||
        (ran.has(cell.suite) && !proved.has(cell.id)),
    )
    .map(({ id }) => id)
}

async function runCross() {
  const cellIds = await crossPool()
  const breaks = effectiveBreaks()
  console.log(`cross: ${cellIds.length} cells, ${breaks.length} breaks`)
  const log = path.join(results, 'cross.jsonl')
  fs.rmSync(log, { force: true })
  await census('cross', breaks, [suiteRoot], cellIds, log, true)
}

const [command, name, ...rest] = process.argv.slice(2)
if (command === 'prepare') prepare()
else if (command === 'suite') await runSuite(name, rest)
else if (command === 'report') report(name)
else if (command === 'cross') await runCross()
else
  console.log(
    'usage: prepare | suite <name> [break ids] | report <name> | cross',
  )
