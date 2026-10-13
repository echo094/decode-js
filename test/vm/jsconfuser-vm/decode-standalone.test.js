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
  for (const corpusKind of ['raw', 'focused']) {
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

const expectedStructuredDeclines = new Set([
  'f-finally-abrupt',
  'f-switch-flow',
  'program-cash',
  'program-sha256',
])

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

function assertControlContract(diagnosis, output, entry) {
  const control = diagnosis.result.control
  expect(control.schemaVersion).toBe('jsconfuser-vm-structured-control.v1')
  expect(control.functions).toHaveLength(diagnosis.result.functionCount)
  for (const controlFunction of control.functions) {
    const functionSource = functionOutput(output, controlFunction.id)
    if (controlFunction.mode === 'structured') {
      expect(controlFunction.control.kind).toBe('structured')
      expect(functionSource).not.toContain('__recovered_pc')
      expect(functionSource).not.toContain('__recovered_dispatch')
      expect(functionSource).not.toContain('switch (__recovered_pc)')
    } else {
      expect(controlFunction.mode).toBe('state-machine')
      expect(controlFunction.control.kind).toBe('state-machine')
      expect(controlFunction.control.proof).toMatchObject({
        exactBlockGraph: true,
        explicitLeaves: true,
        irreducible: { required: true, fallback: 'state-machine' },
      })
      expect(functionSource).toContain('__recovered_dispatch')
    }
  }
  if (['reference', 'f-branching', 'f-loop-forms'].includes(entry.cellId)) {
    expect(control.functions.every(({ mode }) => mode === 'structured')).toBe(
      true,
    )
    expect(output).not.toContain('__recovered_pc')
    expect(output).not.toContain('__recovered_dispatch')
    expect(output).not.toContain('switch (__recovered_pc)')
  }
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

test(
  'recovers the tracked corpus with complete structure and bounded behavior',
  () => {
    const entries = corpusCases()
    expect(entries).toHaveLength(38)
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
      assertControlContract(diagnosis, output, entry)
      assertStaticOutput(output)
      expect(runRecovered(output, entry.oracle), entry.relativePath).toEqual(
        expectedBehavior(entry.oracle),
      )
    }
  },
)

test('recovers source-derived switch arms with independent terminal routes', () => {
  const entry = corpusCases().find(
    ({ cellId }) => cellId === 'terminal-switch-arms',
  )
  const diagnosis = diagnoseStandalone(entry.encodedSource)
  expect(diagnosis.ok).toBe(true)
  const functionControl = diagnosis.result.control.functions.find(
    ({ id }) => id === 1,
  )
  expect(functionControl.control.regions).toContainEqual(
    expect.objectContaining({
      kind: 'conditional',
      mergeBlockId: null,
      proof:
        'both disjoint successor subgraphs terminate without a control merge',
    }),
  )
  expect(functionOutput(diagnosis.result.output, 1)).not.toContain(
    '__recovered_dispatch',
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
  const functionControl = diagnosis.result.control.functions.find(
    ({ id }) => id === 1,
  )
  expect(functionControl.control.regions).toContainEqual(
    expect.objectContaining({
      kind: 'conditional',
      proof:
        'disjoint successors terminate through normal or one handler route',
    }),
  )
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

test('unproved finalizer routes and damaged targets decline atomically', () => {
  const abrupt = corpusCases().find(
    ({ cellId }) => cellId === 'f-finally-abrupt',
  ).encodedSource
  const damaged = fs.readFileSync(
    new URL(
      'test/vm/jsconfuser-vm/fixtures/corpus/negative/finally-stale-target/encoded.js',
      repositoryRootUrl,
    ),
    'utf8',
  )
  for (const [cellId, input] of [
    ['f-finally-abrupt', abrupt],
    ['finally-stale-target', damaged],
  ]) {
    const diagnosis = diagnoseStandalone(input)
    expect(diagnosis.ok, cellId).toBe(false)
    expect(diagnosis.result, cellId).toBeNull()
    expect(decodeStandalone(input), cellId).toBeNull()
  }
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
      'encoded bytecode',
      reference.replace(
        'var ENCODE_BYTECODE = false;',
        'var ENCODE_BYTECODE = true;',
      ),
      'container-declined',
    ],
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
