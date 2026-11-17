import vm from 'node:vm'
import { performance } from 'node:perf_hooks'
import { scriptTimeout } from '../../../helper.js'

// Runs a program under an oracle.json host profile and projects what it leaves in
// window.TEST_OUTPUT (or what the oracle's actions read from it) into plain data
// that compares across contexts. The corpus runs with the bare profile; generated
// cells add the browser facilities an encoded runtime reads (performance, atob/btoa,
// self), and compare source, encoded and decoded runs of one program in that host.

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

function makeExecutionContext(hostProfile, browser) {
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
  if (browser) Object.assign(window, { performance, atob, btoa, self: window })
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

export function runOracle(program, oracle = {}, { browser = false } = {}) {
  const { context, window } = makeExecutionContext(oracle.hostProfile, browser)
  try {
    vm.runInContext(program, context, { timeout: scriptTimeout })
    return { ok: true, value: observe(window, oracle.actions) }
  } catch (error) {
    return { ok: false, thrown: thrown(error) }
  }
}

export function expectedBehavior(oracle) {
  return oracle.expectedThrow
    ? { ok: false, thrown: oracle.expectedThrow }
    : { ok: true, value: oracle.expected }
}
