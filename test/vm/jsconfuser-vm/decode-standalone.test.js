import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'
import {
  decodeStandalone,
  diagnoseStandalone,
} from '../../../src/vm/jsconfuser-vm/decode-standalone.js'

const repositoryRootUrl = new URL('../../../', import.meta.url)
function corpusCases() {
  const entries = [
    {
      corpusKind: 'reference',
      cellId: 'reference',
      relativePath: 'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
    },
  ]
  for (const corpusKind of ['raw', 'focused', 'composition']) {
    const directory = new URL(
      `test/vm/jsconfuser-vm/fixtures/corpus/${corpusKind}/`,
      repositoryRootUrl,
    )
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const relativePath = `test/vm/jsconfuser-vm/fixtures/corpus/${corpusKind}/${entry.name}/encoded.js`
      if (!fs.existsSync(new URL(relativePath, repositoryRootUrl))) continue
      entries.push({
        corpusKind,
        cellId: entry.name,
        relativePath,
      })
    }
  }
  return entries
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((entry) => {
      const encodedPath = fileURLToPath(
        new URL(entry.relativePath, repositoryRootUrl),
      )
      const directory = path.dirname(encodedPath)
      return {
        ...entry,
        encodedSource: fs.readFileSync(encodedPath, 'utf8'),
        oracle: JSON.parse(
          fs.readFileSync(path.join(directory, 'oracle.json'), 'utf8'),
        ),
      }
    })
}

function assertStaticOutput(output) {
  const ast = parseSuccessfulOutput(output)
  expect(assertNoVmResidue(ast).ok).toBe(true)
  expect(assertDerivedStateConsistency(ast, output).ok).toBe(true)
}

// Known gaps of structured emission (vm-switch-boundary.md item 5); each cell declines there.
const expectedStructuredDeclines = new Set()

test('recovers the class-obfuscated numeric runtime fixture', () => {
  const directory = new URL('fixtures/class-runtime-boot/', import.meta.url)
  const source = fs.readFileSync(new URL('source.js', directory), 'utf8')
  const encoded = fs.readFileSync(new URL('encoded.js', directory), 'utf8')
  const diagnosis = diagnoseStandalone(encoded)
  expect(diagnosis.ok).toBe(true)
  const decoded = diagnosis.result.output
  expect(decoded).toBe(decodeStandalone(encoded))
  assertStaticOutput(decoded)
  const observe = (script) => {
    const window = {}
    vm.runInNewContext(
      script,
      { window, performance: { now: () => 0 } },
      { timeout: 1000 },
    )
    return window.TEST_OUTPUT
  }
  expect(observe(decoded)).toBe(observe(source))
  expect(observe(encoded)).toBe(observe(source))
})

test('recovers every loop nesting as structured loops with source behaviour', () => {
  const directory = new URL(
    '../switch/fixtures/vm-switch-statements/nested-loops/forms/',
    import.meta.url,
  )
  const source = fs.readFileSync(new URL('source.js', directory), 'utf8')
  const encoded = fs.readFileSync(new URL('encoded.js', directory), 'utf8')
  const diagnosis = diagnoseStandalone(encoded)
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  const output = diagnosis.result.output
  assertStaticOutput(output)
  expect(diagnosis.result.statements).toHaveLength(
    diagnosis.result.functionCount,
  )
  expect(output).not.toContain('__recovered_dispatch')
  const observe = (script) => {
    const window = {}
    vm.runInNewContext(script, { window }, { timeout: 1000 })
    return JSON.stringify(window.TEST_OUTPUT)
  }
  expect(observe(output)).toBe(observe(source))
})

test('recovers the handler-table numeric runtime fixture', () => {
  const directory = new URL('fixtures/handler-table-boot/', import.meta.url)
  const source = fs.readFileSync(new URL('source.js', directory), 'utf8')
  const encoded = fs.readFileSync(new URL('encoded.js', directory), 'utf8')
  const diagnosis = diagnoseStandalone(encoded)
  expect(diagnosis.ok).toBe(true)
  const decoded = diagnosis.result.output
  assertStaticOutput(decoded)
  const observe = (script) => {
    const window = {}
    vm.runInNewContext(
      script,
      { window, performance: { now: () => 0 } },
      { timeout: 1000 },
    )
    return window.TEST_OUTPUT
  }
  expect(observe(decoded)).toBe(observe(source))
  expect(observe(encoded)).toBe(observe(source))
})

function functionOutput(output, functionId) {
  const start = output.indexOf(`function __recovered_function_${functionId}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = output.indexOf('\n  function __recovered_function_', start + 1)
  return output.slice(start, next === -1 ? output.length : next)
}

// The backend renders every function structured and publishes its statement regions.
function assertControlContract(diagnosis, output) {
  const structured = new Set(
    diagnosis.result.statements.map(({ functionId }) => functionId),
  )
  expect(structured.size).toBe(diagnosis.result.functionCount)
  expect(output).not.toContain('__recovered_pc')
  expect(output).not.toContain('__recovered_dispatch')
  expect(output).not.toContain('switch (__recovered_pc)')
}

function isError(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.message === 'string' &&
    (Object.prototype.toString.call(value).endsWith('Error]') ||
      'stack' in value)
  )
}

function project(value, seen = new WeakSet()) {
  if (value === undefined) return { type: 'undefined' }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { type: 'nan' }
    if (value === Infinity) return { type: 'infinity' }
    if (value === -Infinity) return { type: '-infinity' }
    if (Object.is(value, -0)) return { type: '-0' }
    return value
  }
  if (typeof value === 'bigint') return { type: 'bigint', value: String(value) }
  if (typeof value === 'function')
    return { type: 'function', name: value.name || '' }
  if (value === null || typeof value !== 'object') return value
  if (isError(value))
    return { type: 'error', name: value.name, message: value.message }
  if (seen.has(value)) return { type: 'cycle' }
  seen.add(value)
  const output = Array.isArray(value)
    ? value.map((item) => project(item, seen))
    : Object.fromEntries(
        Object.keys(value).map((key) => [key, project(value[key], seen)]),
      )
  seen.delete(value)
  return output
}

function thrown(value) {
  return isError(value)
    ? { type: 'error', name: value.name, message: value.message }
    : { type: 'primitive', value: project(value) }
}

function makeExecutionContext(hostProfile) {
  const window = { TEST_OUTPUT: null }
  if (hostProfile === 'cash-dom-test-v1') {
    window.document = {
      documentElement: {},
      createElement: function () {
        return { style: {} }
      },
    }
    window.module = { exports: {} }
    window.exports = undefined
    for (const name of Object.getOwnPropertyNames(globalThis)) {
      if (name !== 'globalThis' && !(name in window))
        window[name] = globalThis[name]
    }
  }
  window.window = window
  return { context: vm.createContext(window), window }
}

function observe(window, actions) {
  if (!actions?.length) return project(window.TEST_OUTPUT)
  const result = {}
  const at = (value, keys) => keys.reduce((current, key) => current[key], value)
  for (const action of actions) {
    const root = action.root === 'window' ? window : window.TEST_OUTPUT
    if (action.op === 'keys')
      result[action.as] = Object.keys(at(root, action.path || []))
    else if (action.op === 'typeOf')
      result[action.as] = typeof at(root, action.path || [])
    else if (action.op === 'get')
      result[action.as] = project(at(root, action.path || []))
    else if (action.op === 'call') {
      const keys = action.path || []
      const parent = keys.length ? at(root, keys.slice(0, -1)) : undefined
      const fn = keys.length ? parent[keys[keys.length - 1]] : root
      result[action.as] = project(fn.apply(parent, action.args || []))
    } else throw new Error(`Unknown oracle action ${action.op}`)
  }
  return result
}

function runRecovered(output, oracle) {
  const { context, window } = makeExecutionContext(oracle.hostProfile)
  try {
    vm.runInContext(output, context, {
      timeout: oracle.timeoutMs || 2000,
    })
    return { ok: true, value: observe(window, oracle.actions) }
  } catch (error) {
    return { ok: false, thrown: thrown(error) }
  }
}

function expectedBehavior(oracle) {
  return oracle.expectedThrow
    ? { ok: false, thrown: oracle.expectedThrow }
    : { ok: true, value: oracle.expected }
}

function replaceBytecodeWords(source, words) {
  const match = /var BYTECODE = \[([\s\S]*?)\];/.exec(source)
  if (!match)
    throw new Error('reference input has no numeric BYTECODE declaration')
  const replacement = `var BYTECODE = [${words.join(', ')}];`
  return (
    source.slice(0, match.index) +
    replacement +
    source.slice(match.index + match[0].length)
  )
}

test('recovers the tracked corpus with complete structure and bounded behavior', () => {
  const entries = corpusCases()
  expect(entries).toHaveLength(43)
  for (const entry of entries) {
    const diagnosis = diagnoseStandalone(entry.encodedSource)
    if (!diagnosis.ok) {
      expect(
        expectedStructuredDeclines.has(entry.cellId),
        entry.relativePath,
      ).toBe(true)
      expect(diagnosis.diagnostic.code, entry.relativePath).toBe(
        'unemittable-structured-control',
      )
      expect(
        decodeStandalone(entry.encodedSource),
        entry.relativePath,
      ).toBeNull()
      continue
    }
    expect(Object.isFrozen(diagnosis)).toBe(true)
    expect(Object.isFrozen(diagnosis.result)).toBe(true)
    expect(diagnosis.result.proof).toMatchObject({
      allPredecessorsReconstructed: true,
      noTargetExecution: true,
      noVmRuntimeEmission: true,
      freshJavaScriptEmission: true,
    })

    const output = diagnosis.result.output
    assertControlContract(diagnosis, output)
    assertStaticOutput(output)
    expect(runRecovered(output, entry.oracle), entry.relativePath).toEqual(
      expectedBehavior(entry.oracle),
    )
  }
})

// Each case returns, so each test's consequent is a transfer and the test closes at the next
// one: the switch reads as a chain of guards, `if (value === 1) return "one";` and so on.
test('recovers source-derived switch arms as a chain of guards', () => {
  const entry = corpusCases().find(
    ({ cellId }) => cellId === 'terminal-switch-arms',
  )
  const diagnosis = diagnoseStandalone(entry.encodedSource)
  expect(diagnosis.ok).toBe(true)
  const conditionals = diagnosis.result.statements
    .find(({ functionId }) => functionId === 1)
    .regions.filter(({ kind }) => kind === 'conditional')
  expect(conditionals).toHaveLength(2)
  for (const conditional of conditionals)
    expect(conditional.mergeBlockId).toBe(`1:b@${conditional.branchTargetPc}`)
  const output = functionOutput(diagnosis.result.output, 1)
  expect(output).not.toContain('__recovered_dispatch')
  expect(output).not.toContain('else')
  expect(runRecovered(diagnosis.result.output, entry.oracle)).toEqual(
    expectedBehavior(entry.oracle),
  )
})

// Case bodies that share routes (a case falling into the next, grouped cases, a default in the
// middle) have no if/else form: each function's test chain is one switch region, written as a
// native switch whose clauses keep the source order.
test('recovers switches whose case bodies share routes as native switches', () => {
  const entry = corpusCases().find(({ cellId }) => cellId === 'f-switch-flow')
  const diagnosis = diagnoseStandalone(entry.encodedSource)
  expect(diagnosis.ok).toBe(true)
  const clauses = { 1: [0, 1, 2, null], 2: [0, 1, null, 2], 3: [0, 1, 2, null] }
  for (const [functionId, order] of Object.entries(clauses)) {
    const regions = diagnosis.result.statements.find(
      (statement) => statement.functionId === Number(functionId),
    ).regions
    const switches = regions.filter(({ kind }) => kind === 'switch')
    expect(switches, `function ${functionId}`).toHaveLength(1)
    const [region] = switches
    expect(region.clauses.map(({ caseIndex }) => caseIndex)).toEqual(order)
    const tests = new Set(region.cases.map(({ testBlockId }) => testBlockId))
    expect(
      regions.some(
        ({ kind, testBlockId }) =>
          kind === 'conditional' && tests.has(testBlockId),
      ),
    ).toBe(false)
    const output = functionOutput(diagnosis.result.output, Number(functionId))
    expect(output.match(/switch \(/g)).toHaveLength(1)
    expect(output).toContain('default:')
    expect(output).not.toContain('__recovered_dispatch')
  }
  // group's first two cases share one body: the first clause is empty and falls into it.
  expect(functionOutput(diagnosis.result.output, 2)).toMatch(
    /case [^:]+:\n\s*case /,
  )
  expect(runRecovered(diagnosis.result.output, entry.oracle)).toEqual(
    expectedBehavior(entry.oracle),
  )
})

test('recovers a protected terminal throw and its handler without dispatch', () => {
  const entry = corpusCases().find(({ cellId }) => cellId === 'f-throw-catch')
  const diagnosis = diagnoseStandalone(entry.encodedSource)
  expect(diagnosis.ok).toBe(true)
  expect(diagnosis.result.output).toContain('try {')
  expect(diagnosis.result.output).toContain('catch (__recovered_error)')
  expect(diagnosis.result.output).not.toContain('__recovered_dispatch')
  expect(runRecovered(diagnosis.result.output, entry.oracle)).toEqual(
    expectedBehavior(entry.oracle),
  )
})

test('recovers a protected conditional with caught and normal terminal arms', () => {
  const entry = corpusCases().find(
    ({ cellId }) => cellId === 'protected-conditional-catch',
  )
  const diagnosis = diagnoseStandalone(entry.encodedSource)
  expect(diagnosis.ok).toBe(true)
  const functionStatements = diagnosis.result.statements.find(
    ({ functionId }) => functionId === 1,
  )
  // The throwing arm is a transfer, so the merge is the start of the normal arm and the source's
  // guard clause `if (value < 0) throw ...; return value + 1;` survives without an else.
  const guard = functionStatements.regions.find(
    ({ kind }) => kind === 'conditional',
  )
  expect(guard).toMatchObject({
    mergeBlockId: `1:b@${guard.branchTargetPc}`,
    proof:
      'the arms never meet: the transferring arm ends inside the statement',
  })
  expect(functionOutput(diagnosis.result.output, 1)).not.toContain('} else {')
  expect(functionOutput(diagnosis.result.output, 1)).toContain('catch (')
  expect(functionOutput(diagnosis.result.output, 1)).not.toContain(
    '__recovered_dispatch',
  )
  expect(runRecovered(diagnosis.result.output, entry.oracle)).toEqual(
    expectedBehavior(entry.oracle),
  )
})

test('recovers a direct return through a straight finalizer', () => {
  const entry = corpusCases().find(
    ({ cellId }) => cellId === 'return-through-finally',
  )
  const diagnosis = diagnoseStandalone(entry.encodedSource)
  expect(diagnosis.ok).toBe(true)
  const output = functionOutput(diagnosis.result.output, 1)
  expect(output).toContain('try {')
  expect(output).toContain('} finally {')
  expect(output).not.toContain('__recovered_dispatch')
  expect(runRecovered(diagnosis.result.output, entry.oracle)).toEqual(
    expectedBehavior(entry.oracle),
  )
})

test('recovers caught and normal returns through one finalizer', () => {
  const entry = corpusCases().find(
    ({ cellId }) => cellId === 'caught-return-through-finally',
  )
  const diagnosis = diagnoseStandalone(entry.encodedSource)
  expect(diagnosis.ok).toBe(true)
  const output = functionOutput(diagnosis.result.output, 1)
  expect(output).toContain('catch (__recovered_error)')
  expect(output).toContain('} finally {')
  expect(output).not.toContain('__recovered_dispatch')
  expect(runRecovered(diagnosis.result.output, entry.oracle)).toEqual(
    expectedBehavior(entry.oracle),
  )
})

test('a damaged finalizer target declines atomically', () => {
  const damaged = fs.readFileSync(
    new URL(
      'test/vm/jsconfuser-vm/fixtures/corpus/negative/finally-stale-target/encoded.js',
      repositoryRootUrl,
    ),
    'utf8',
  )
  const diagnosis = diagnoseStandalone(damaged)
  expect(diagnosis.ok).toBe(false)
  expect(diagnosis.result).toBeNull()
  expect(decodeStandalone(damaged)).toBeNull()
})

test('a damaged control target still declines atomically', () => {
  const input = fs.readFileSync(
    new URL(
      'test/vm/jsconfuser-vm/fixtures/corpus/negative/control-stale-target/encoded.js',
      repositoryRootUrl,
    ),
    'utf8',
  )
  const diagnosis = diagnoseStandalone(input)
  expect(diagnosis).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'unemittable-structured-control' },
  })
  expect(decodeStandalone(input)).toBeNull()
})

test('malformed and unsupported containers never emit partial source', () => {
  const reference = corpusCases().find(
    ({ corpusKind }) => corpusKind === 'reference',
  ).encodedSource
  const words = [
    4, 1, 2, 2, 0, 0, 0, 3, 1, 0, 0, 4, 2, 0, 0, 5, 3, 0, 11, 6, 4, 5, 9, 2, 3,
    6, 0, 2, 4, 0, 45, 2,
  ]
  const mutations = [
    [
      'truncated wordcode',
      replaceBytecodeWords(reference, words.slice(0, -1)),
      'wordcode-declined',
    ],
    [
      'extra wordcode',
      replaceBytecodeWords(reference, [...words, 0]),
      'wordcode-declined',
    ],
    [
      'unknown opcode',
      replaceBytecodeWords(reference, [56, ...words.slice(1)]),
      'wordcode-declined',
    ],
    [
      'missing bytecode binding',
      reference.replace('var BYTECODE =', 'var NOT_BYTECODE ='),
      'container-declined',
    ],
    [
      'malformed source',
      'not a valid js-confuser-vm container',
      'container-declined',
    ],
  ]
  for (const [name, input, code] of mutations) {
    expect(input, name).not.toBe(reference)
    const diagnosis = diagnoseStandalone(input)
    expect(diagnosis.ok, name).toBe(false)
    expect(diagnosis.result, name).toBeNull()
    expect(diagnosis.diagnostic.code, name).toBe(code)
    expect(Object.isFrozen(diagnosis), name).toBe(true)
    expect(Object.isFrozen(diagnosis.diagnostic), name).toBe(true)
    expect(decodeStandalone(input), name).toBeNull()
  }
})

test('decodeStandalone returns only the diagnosed source', () => {
  const input = fs.readFileSync(
    new URL(
      'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
      repositoryRootUrl,
    ),
    'utf8',
  )
  const diagnosis = diagnoseStandalone(input)
  expect(diagnosis.ok).toBe(true)
  expect(decodeStandalone(input)).toBe(diagnosis.result.output)
})
