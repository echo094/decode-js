import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseDispatcherWordcode } from '../../../src/vm/jsconfuser-vm/observe-dispatcher-wordcode.js'
import { diagnoseNormalizeDispatcherWordcode } from '../../../src/vm/jsconfuser-vm/normalize-dispatcher-wordcode.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { buildControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

function fixture(name, file) {
  return fs.readFileSync(
    new URL(`fixtures/${name}/${file}`, import.meta.url),
    'utf8',
  )
}

function packets(encoded) {
  const container = diagnoseContainer(encoded).result
  const wordcode = readWordcode(container)
  const references = validateReferences(container, wordcode)
  const functions = partitionFunctions(container, wordcode, references)
  return { container, wordcode, references, functions }
}

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, Buffer, performance: { now: () => 0 } },
    { timeout: 1000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

function withWords(encoded, words) {
  const original = encoded.match(/var BYTECODE = \[[\s\S]*?\];/)?.[0]
  expect(original).toBeDefined()
  return encoded.replace(original, `var BYTECODE = [${words.join(',')}];`)
}

test.each([
  'dispatcher-branches',
  'dispatcher-array-result',
  'dispatcher-split-key',
  'dispatcher-object-result',
  'dispatcher-switch',
  'dispatcher-finally',
  'dispatcher-exceptions',
])('proves, normalizes, and decodes %s', (name) => {
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const qualification = JSON.parse(fixture(name, 'qualification.json'))
  const { container, wordcode, references, functions } = packets(encoded)
  expect(buildControlFlow(wordcode, references, functions)).toBeNull()
  const observation = diagnoseDispatcherWordcode(container, wordcode, functions)
  expect(observation.ok).toBe(true)
  expect(observation.result.plans.length).toBeGreaterThan(0)
  const original = JSON.stringify(container)
  const normalized = diagnoseNormalizeDispatcherWordcode(
    container,
    wordcode,
    functions,
  )
  expect(normalized.ok).toBe(true)
  expect(JSON.stringify(container)).toBe(original)
  expect(normalized.result.routeCount).toBeGreaterThan(0)
  expect(normalized.result.normalizedWordCount).toBeLessThan(
    normalized.result.originalWordCount,
  )
  const normalizedPackets = packets(
    withWords(encoded, normalized.result.container.roles.words.values),
  )
  expect(
    buildControlFlow(
      normalizedPackets.wordcode,
      normalizedPackets.references,
      normalizedPackets.functions,
    ),
  ).not.toBeNull()

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(encoded)).toEqual(observe(source))
  expect(observe(decoded.result.output)).toEqual(observe(source))
  expect(qualification.profile).toBe('dispatcher')
  expect(qualification.effectObservation).toEqual({
    axis: 'serialized-bytecode',
    observed: true,
  })
})

test('declines a changed decode-closure global before normalization', () => {
  const encoded = fixture('dispatcher-branches', 'encoded.js')
  const { container, wordcode, functions } = packets(encoded)
  const observed = diagnoseDispatcherWordcode(container, wordcode, functions)
  const closure = functions.functions.find(
    (item) => item.id === observed.result.plans[0].closureId,
  )
  const globalLoad = closure.instructionPcs
    .map((pc) => wordcode.instructions.find((item) => item.pc === pc))
    .find((item) => item.name === 'LOAD_GLOBAL')
  const words = container.roles.words.values.slice()
  words[globalLoad.pc + 2] = container.roles.pool.values.indexOf('window')
  const damaged = withWords(encoded, words)
  const changed = packets(damaged)
  expect(
    diagnoseDispatcherWordcode(
      changed.container,
      changed.wordcode,
      changed.functions,
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: 'dispatcher-closure' },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'cfg-declined' },
  })
})

test('declines a site key that decodes outside instruction boundaries', () => {
  const encoded = fixture('dispatcher-branches', 'encoded.js')
  const { container, wordcode, functions } = packets(encoded)
  const observed = diagnoseDispatcherWordcode(container, wordcode, functions)
  const route = observed.result.plans[0].routes[0]
  const keyLoadPc = route.oldPcs.at(-2)
  const words = container.roles.words.values.slice()
  words[keyLoadPc + 2] = (words[keyLoadPc + 2] + 1) >>> 0
  const damaged = withWords(encoded, words)
  const changed = packets(damaged)
  expect(
    diagnoseDispatcherWordcode(
      changed.container,
      changed.wordcode,
      changed.functions,
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: 'dispatcher-target' },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'cfg-declined' },
  })
})

test.each(['state', 'key', 'selector temporary'])(
  'declines a payload use of erased dispatcher %s through source input',
  (role) => {
    const encoded = fixture('dispatcher-branches', 'encoded.js')
    const { container, wordcode, functions } = packets(encoded)
    const plan = diagnoseDispatcherWordcode(container, wordcode, functions)
      .result.plans[0]
    const jump = wordcode.instructions.find(
      (item) => item.pc === plan.dispatcherPcs.at(-1),
    )
    const publish = wordcode.instructions.find(
      (item) => item.name === 'SET_PROP',
    )
    const route = plan.routes.find((item) => item.name !== 'JUMP')
    expect(route).toBeDefined()
    const keyLoad = wordcode.instructions.find(
      (item) => item.pc === route.oldPcs.at(-2),
    )
    const selector = wordcode.instructions.find(
      (item) => route.oldPcs.includes(item.pc) && item.name === 'SUB',
    )
    const register =
      role === 'state'
        ? jump.words[1]
        : role === 'key'
          ? keyLoad.words[1]
          : selector.words[1]
    const words = container.roles.words.values.slice()
    words[publish.pc + 3] = register
    const changedSource = withWords(encoded, words)
    expect(typeof observe(changedSource)).toBe('number')
    const changed = packets(changedSource)
    expect(
      diagnoseDispatcherWordcode(
        changed.container,
        changed.wordcode,
        changed.functions,
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'dispatcher-shape',
        message: expect.stringContaining('Dispatcher register escapes'),
      },
    })
    expect(diagnoseStandalone(changedSource)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'cfg-declined' },
    })
  },
)

test('declines an erased state used by a retained dispatcher condition', () => {
  const encoded = fixture('dispatcher-branches', 'encoded.js')
  const { container, wordcode, functions } = packets(encoded)
  const plan = diagnoseDispatcherWordcode(container, wordcode, functions).result
    .plans[0]
  const route = plan.routes.find((item) => item.condition !== undefined)
  const invert = wordcode.instructions.find(
    (item) => item.pc === route.oldPcs[0],
  )
  const jump = wordcode.instructions.find(
    (item) => item.pc === plan.dispatcherPcs.at(-1),
  )
  expect(invert.name).toBe('UNARY_NOT')
  const words = container.roles.words.values.slice()
  words[invert.pc + 2] = jump.words[1]
  const changedSource = withWords(encoded, words)
  const changed = packets(changedSource)
  expect(
    diagnoseDispatcherWordcode(
      changed.container,
      changed.wordcode,
      changed.functions,
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: {
      code: 'dispatcher-shape',
      message: 'Dispatcher condition uses erased state',
    },
  })
  expect(diagnoseStandalone(changedSource)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'cfg-declined' },
  })
})
