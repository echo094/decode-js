import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseNormalizeCffWordcode } from '../../../src/vm/jsconfuser-vm/normalize-cff-wordcode.js'
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

// The frontend cannot remove a damaged dispatcher, so the backend renders it as it runs: the
// dispatch loop stays as visible residue and the program behaves as its input does.
function outcome(script) {
  try {
    return ['value', observe(script)]
  } catch (error) {
    return ['thrown', error.message]
  }
}

function expectRetainedDispatch(damaged) {
  const diagnosis = diagnoseStandalone(damaged)
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  expect(diagnosis.result.output).toMatch(
    /__recovered_loop_\d+_\d+: while \(true\)/,
  )
  expect(outcome(diagnosis.result.output)).toEqual(outcome(damaged))
}

function withWords(encoded, words) {
  const original = encoded.match(/var BYTECODE = \[[\s\S]*?\];/)?.[0]
  expect(original).toBeDefined()
  return encoded.replace(original, `var BYTECODE = [${words.join(',')}];`)
}

test.each([
  'cff-branches',
  'cff-switch',
  'cff-for-in',
  'cff-try-catch',
  'cff-try-finally',
  'cff-exceptions',
])('normalizes and decodes %s', (name) => {
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const qualification = JSON.parse(fixture(name, 'qualification.json'))
  const { container, wordcode, functions } = packets(encoded)
  const original = JSON.stringify(container)
  const normalized = diagnoseNormalizeCffWordcode(
    container,
    wordcode,
    functions,
  )
  expect(normalized.ok).toBe(true)
  expect(JSON.stringify(container)).toBe(original)
  expect(normalized.result.functionCount).toBeGreaterThan(0)
  expect(normalized.result.normalizedWordCount).toBeLessThan(
    normalized.result.originalWordCount,
  )
  const nextWordcode = readWordcode(normalized.result.container)
  const nextReferences = validateReferences(
    normalized.result.container,
    nextWordcode,
  )
  const nextFunctions = partitionFunctions(
    normalized.result.container,
    nextWordcode,
    nextReferences,
  )
  expect(
    buildControlFlow(nextWordcode, nextReferences, nextFunctions),
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
  // The fake dispatcher arms are gone, also from functions that hold a finally.
  expect(decoded.result.output).not.toContain('if (false)')
  expect(qualification.profile).toBe('controlFlowFlattening')
  expect(qualification.effectObservation).toEqual({
    axis: 'serialized-bytecode',
    observed: true,
  })
})

// CFF reorders every block. The decoder keeps every jump the stream does not prove a fallthrough
// and places only a conditional's proved fallthrough (the encoder jumps over a transition to it)
// after its test; the backend reads loops, breaks and tries from the graph. The CFF decode reads
// as the plain decode does (registers and dead blocks aside).
test('restores the order of loop and try exits that flattening reorders', () => {
  const source = fixture('cff-loop-return', 'source.js')
  const read = (file) => {
    const decoded = diagnoseStandalone(fixture('cff-loop-return', file))
    expect(decoded.ok, JSON.stringify(decoded.diagnostic)).toBe(true)
    expect(observe(decoded.result.output)).toEqual(observe(source))
    return decoded.result.output
      .replace(/__recovered_r_\d+_\d+/g, 'R')
      .replace(/let [^;]*;/g, 'let;')
      .replace(/\n *if \(false\) \{\n(?: {4,}.*\n)*? *\}/g, '')
  }
  const flattened = read('encoded.js')
  expect(flattened).toBe(read('plain.encoded.js'))
})

test('declines a changed dispatch state constant atomically', () => {
  const encoded = fixture('cff-branches', 'encoded.js')
  const { container, wordcode } = packets(encoded)
  const first = wordcode.instructions[1]
  expect(first.name).toBe('LOAD_CONST')
  const changedWords = container.roles.words.values.slice()
  changedWords[first.pc + 2] = container.roles.pool.values.indexOf('window')
  const damaged = withWords(encoded, changedWords)
  const changed = packets(damaged)
  expect(
    diagnoseNormalizeCffWordcode(
      changed.container,
      changed.wordcode,
      changed.functions,
    ),
  ).toMatchObject({ ok: false, diagnostic: { code: 'cff-shape' } })
  expectRetainedDispatch(damaged)
})

test('declines a relative transition outside the dispatch state set', () => {
  const encoded = fixture('cff-branches', 'encoded.js')
  const { container, wordcode } = packets(encoded)
  const transition = wordcode.instructions.find((item, index) => {
    if (item.name !== 'LOAD_INT') return false
    const arithmetic = wordcode.instructions[index + 1]
    const jump = wordcode.instructions[index + 2]
    return (
      ['ADD', 'SUB'].includes(arithmetic?.name) &&
      arithmetic.words[1] === arithmetic.words[2] &&
      arithmetic.words[3] === item.words[1] &&
      jump?.name === 'JUMP'
    )
  })
  expect(transition).toBeDefined()
  const changedWords = container.roles.words.values.slice()
  changedWords[transition.pc + 2] = 65535
  const damaged = withWords(encoded, changedWords)
  const changed = packets(damaged)
  expect(
    diagnoseNormalizeCffWordcode(
      changed.container,
      changed.wordcode,
      changed.functions,
    ),
  ).toMatchObject({ ok: false, diagnostic: { code: 'cff-shape' } })
  expectRetainedDispatch(damaged)
})

test.each([
  ['state', 2],
  ['accumulator', 4],
  ['comparison temporary', 6],
])(
  'declines a payload use of erased dispatch %s through source input',
  (_, index) => {
    const encoded = fixture('cff-branches', 'encoded.js')
    const { container, wordcode } = packets(encoded)
    const state = wordcode.instructions[index].words[1]
    const publish = wordcode.instructions.find(
      (item) => item.name === 'SET_PROP',
    )
    expect(publish).toBeDefined()
    const words = container.roles.words.values.slice()
    words[publish.pc + 3] = state
    const changedSource = withWords(encoded, words)
    expect(observe(changedSource)).not.toBeUndefined()
    const changed = packets(changedSource)
    expect(
      diagnoseNormalizeCffWordcode(
        changed.container,
        changed.wordcode,
        changed.functions,
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'cff-shape',
        message: expect.stringContaining('Dispatch register escapes'),
      },
    })
    expectRetainedDispatch(changedSource)
  },
)

test('declines an erased state used by a retained conditional route', () => {
  const encoded = fixture('cff-branches', 'encoded.js')
  const { container, wordcode } = packets(encoded)
  const state = wordcode.instructions[2].words[1]
  const branch = wordcode.instructions.find(
    (item, index) =>
      item.name === 'JUMP_IF_TRUE' &&
      ['MOD', 'LT'].includes(wordcode.instructions[index - 1]?.name) &&
      wordcode.instructions[index - 1].words[2] !== state,
  )
  expect(branch).toBeDefined()
  const words = container.roles.words.values.slice()
  words[branch.pc + 1] = state
  const changedSource = withWords(encoded, words)
  const changed = packets(changedSource)
  expect(
    diagnoseNormalizeCffWordcode(
      changed.container,
      changed.wordcode,
      changed.functions,
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: {
      code: 'cff-shape',
      message: 'Dispatch condition uses erased state',
    },
  })
  expectRetainedDispatch(changedSource)
})

// The synthetic exact word-PC example from the CFF specification, on a private
// A cloned from the reference fixture. Its omitted prefix starts have no first
// map entries, so a branch into one is refused rather than retargeted.
test('normalizes the specification scaffold and refuses targets in its omitted prefix', () => {
  const reference = diagnoseContainer(fixture('reference', 'encoded.js')).result
  const words = [
    4, 0, 0, 1, 0, 0, 5, 2, 1, 0, 1, 1, 0, 5, 3, 1, 0, 1, 2, 0, 27, 4, 2, 1, 40,
    4, 65, 0, 1, 0, 0, 5, 3, 1, 26, 4, 2, 3, 40, 4, 43, 39, 76, 0, 1, 0, 0, 11,
    3, 3, 1, 5, 3, 3, 26, 4, 2, 3, 40, 4, 63, 39, 71, 39, 16, 0, 5, 3, 0, 45, 5,
    1, 5, 42, 45, 5, 1, 5, 7, 1, 1, 10, 11, 2, 2, 1, 39, 16,
  ]
  const normalize = (values) => {
    const container = structuredClone(reference)
    container.roles.words.values = values
    container.roles.pool.values = [10, 0, 60, undefined]
    container.roles.scalars.MAIN_REG_COUNT.value = 6
    const wordcode = readWordcode(container)
    const references = validateReferences(container, wordcode)
    const functions = partitionFunctions(container, wordcode, references)
    const supplied = JSON.stringify([
      container,
      wordcode,
      references,
      functions,
    ])
    const result = diagnoseNormalizeCffWordcode(container, wordcode, functions)
    expect(JSON.stringify([container, wordcode, references, functions])).toBe(
      supplied,
    )
    return result
  }
  expect(words).toHaveLength(88)
  // A's transition to B proves no fallthrough, so it stays a jump; the end body is pruned.
  expect(normalize(words).result.container.roles.words.values).toEqual([
    1, 5, 7, 39, 5, 1, 5, 42, 45, 5,
  ])

  const intoPrefix = [...words]
  intoPrefix.splice(71, 3, 41, 5, 2) // JUMP_IF_TRUE r5,2 replaces LOAD_INT r5,42
  expect(intoPrefix).toHaveLength(88)
  expect(normalize(intoPrefix)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: {
      code: 'cff-shape',
      message: 'Target 2 is not an instruction boundary',
    },
  })

  const unknownState = [...words]
  unknownState[81] = 11
  expect(normalize(unknownState)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: {
      code: 'cff-shape',
      message: 'Relative transition reaches unknown state 21',
    },
  })
})
