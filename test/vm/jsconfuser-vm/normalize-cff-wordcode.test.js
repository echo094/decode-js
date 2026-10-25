import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseNormalizeCffWordcode } from '../../../src/vm/jsconfuser-vm/normalize-cff-wordcode.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
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

function analysesOf(encoded) {
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
  const { container, wordcode, functions } = analysesOf(encoded)
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
  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(encoded)).toEqual(observe(source))
  expect(observe(decoded.result.output)).toEqual(observe(source))
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

// The pass removes what CFF added (the state loop, its transitions and seeds, the fake blocks) and
// nothing else: unreachable code the compiler emitted, source dead code included, goes to the
// backend. So apart from jumps, the normalized stream holds the plain compile's instructions.
test.each(['normalize-cff-wordcode/dead-code', 'cff-loop-return'])(
  'removes only its own fake blocks from %s',
  (name) => {
    const opcodes = ({ instructions }) => {
      const counts = {}
      for (const { name: opcode } of instructions)
        if (opcode !== 'JUMP') counts[opcode] = (counts[opcode] ?? 0) + 1
      return counts
    }
    const { container, wordcode, functions } = analysesOf(
      fixture(name, 'encoded.js'),
    )
    const normalized = diagnoseNormalizeCffWordcode(
      container,
      wordcode,
      functions,
    )
    expect(normalized.ok, JSON.stringify(normalized.diagnostic)).toBe(true)
    expect(opcodes(normalized.result.wordcode)).toEqual(
      opcodes(analysesOf(fixture(name, 'plain.encoded.js')).wordcode),
    )
    const decoded = diagnoseStandalone(fixture(name, 'encoded.js'))
    expect(decoded.ok, JSON.stringify(decoded.diagnostic)).toBe(true)
    expect(observe(decoded.result.output)).toEqual(
      observe(fixture(name, 'source.js')),
    )
  },
)

// Every non-arrow function opens with LOAD_THIS, as the state-loop template does, so a plain loop
// on two fresh locals spells the state-loop prefix; it fails the arm grammar and is not CFF.
test('reads a plain loop sharing the state-loop prefix as no CFF', () => {
  const source = fixture('loop-sharing-cff-prefix', 'source.js')
  const encoded = fixture('loop-sharing-cff-prefix', 'encoded.js')
  const { container, wordcode, functions } = analysesOf(encoded)
  const loop = wordcode.instructions.filter(
    (item) =>
      item.pc >= functions.functions[1].startPc &&
      item.pc < functions.functions[1].endPc,
  )
  expect(loop.slice(0, 8).map((item) => item.name)).toEqual([
    'LOAD_THIS',
    'LOAD_CONST',
    'MOVE',
    'LOAD_CONST',
    'MOVE',
    'LOAD_CONST',
    'NEQ',
    'JUMP_IF_FALSE',
  ])
  expect(
    diagnoseNormalizeCffWordcode(container, wordcode, functions),
  ).toMatchObject({ ok: false, diagnostic: { code: 'cff-absent' } })
  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok, JSON.stringify(decoded.diagnostic)).toBe(true)
  expect(observe(decoded.result.output)).toEqual(observe(source))
})

// The synthetic exact word-PC example from the CFF specification, on a private
// container cloned from the reference fixture. Its omitted prefix starts have no first
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
  // A's transition to B proves no fallthrough, so it stays a jump; the end body is no fake
  // block, so it stays too, for the backend to read as unreachable.
  expect(normalize(words).result.container.roles.words.values).toEqual([
    1, 5, 7, 39, 11, 0, 5, 3, 0, 45, 5, 1, 5, 42, 45, 5,
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
