import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseMacroRuntime } from '../../../src/vm/jsconfuser-vm/observe-macro-runtime.js'
import { diagnoseNormalizeMacroWordcode } from '../../../src/vm/jsconfuser-vm/normalize-macro-wordcode.js'
import {
  diagnoseMacroWordStream,
  diagnoseWordcode,
  readWordcode,
} from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
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

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, performance: { now: () => 0 } },
    { timeout: 1000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test.each([
  'macro-runtime-boot',
  'macro-runtime-branches',
  'macro-runtime-closures',
  'macro-runtime-exceptions',
  'macro-runtime-arrays',
])('proves, expands, and decodes %s', (name) => {
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const qualification = JSON.parse(fixture(name, 'qualification.json'))
  const packetA = diagnoseContainer(encoded)
  expect(packetA.ok).toBe(true)
  expect(diagnoseWordcode(packetA.result)).toMatchObject({
    ok: false,
    diagnostic: { code: 'unknown-opcode' },
  })
  const runtime = diagnoseMacroRuntime(encoded)
  expect(runtime.ok).toBe(true)
  const stream = diagnoseMacroWordStream(packetA.result, runtime.result)
  expect(stream.ok).toBe(true)
  if (name === 'macro-runtime-arrays') {
    expect(
      stream.result.instructions.some(
        (instruction) =>
          instruction.name === 'MACRO' &&
          instruction.steps.some((step) => step.name === 'BUILD_ARRAY'),
      ),
    ).toBe(true)
  }
  const normalized = diagnoseNormalizeMacroWordcode(encoded, packetA.result)
  expect(normalized.ok).toBe(true)
  expect(normalized.result.expandedWordCount).toBeGreaterThan(
    normalized.result.originalWordCount,
  )
  expect(readWordcode(normalized.result.container)).not.toBeNull()

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(encoded)).toEqual(observe(source))
  expect(observe(decoded.result.output)).toEqual(observe(source))
  expect(qualification.profile).toBe('macroOpcodes')
  expect(qualification.effectObservation).toEqual({
    axis: 'serialized-bytecode',
    observed: true,
  })
})

test('declines a changed macro body before word normalization', () => {
  const encoded = fixture('macro-runtime-boot', 'encoded.js')
  const damaged = encoded.replace(
    /(?<=\/\/ LOAD_CONST,LOAD_CONST \(macro\)[\s\S]*?)regs\[base \+ dst\] = this\._constant\(\);/,
    'regs[base + dst] = this._constant() + 1;',
  )
  expect(damaged).not.toBe(encoded)
  expect(diagnoseMacroRuntime(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'macro-runtime' },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})

test('declines a branch into the middle of an original macro instruction', () => {
  const encoded = fixture('macro-runtime-branches', 'encoded.js')
  const packetA = diagnoseContainer(encoded).result
  const words = packetA.roles.words.values.slice()
  const macro = diagnoseMacroWordStream(
    packetA,
    diagnoseMacroRuntime(encoded).result,
  ).result.instructions.find(({ name }) => name === 'MACRO')
  const branchPc = diagnoseMacroWordStream(
    packetA,
    diagnoseMacroRuntime(encoded).result,
  ).result.instructions.find(({ name }) => name === 'JUMP_IF_FALSE').pc
  words[branchPc + 2] = macro.pc + 1
  const damaged = structuredClone(packetA)
  damaged.roles.words.values = words
  expect(diagnoseNormalizeMacroWordcode(encoded, damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'macro-target-boundary' },
  })
  const malformed = encoded.replace(
    /^var BYTECODE = \[[^\n]+\];$/m,
    `var BYTECODE = ${JSON.stringify(words)};`,
  )
  expect(malformed).not.toBe(encoded)
  expect(diagnoseStandalone(malformed)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})

test('declines a source macro whose counted array payload exceeds the stream', () => {
  const encoded = fixture('macro-runtime-arrays', 'encoded.js')
  const container = diagnoseContainer(encoded).result
  const runtime = diagnoseMacroRuntime(encoded).result
  const stream = diagnoseMacroWordStream(container, runtime).result
  const macro = stream.instructions.find(
    (instruction) =>
      instruction.name === 'MACRO' &&
      instruction.steps.some(({ name }) => name === 'BUILD_ARRAY'),
  )
  expect(macro).toBeDefined()
  const stepIndex = macro.steps.findIndex(({ name }) => name === 'BUILD_ARRAY')
  const precedingWords = macro.steps
    .slice(0, stepIndex)
    .reduce((total, step) => total + step.words.length - 1, 0)
  const countPc = macro.pc + 2 + precedingWords
  const words = container.roles.words.values.slice()
  words[countPc] = 0xffffffff
  const damaged = encoded.replace(
    /^var BYTECODE = \[[^\n]+\];$/m,
    `var BYTECODE = ${JSON.stringify(words)};`,
  )
  expect(damaged).not.toBe(encoded)
  const admitted = diagnoseContainer(damaged)
  const observed = diagnoseMacroRuntime(damaged)
  expect(admitted.ok).toBe(true)
  expect(observed.ok).toBe(true)
  expect(
    diagnoseMacroWordStream(admitted.result, observed.result),
  ).toMatchObject({
    ok: false,
    result: null,
    diagnostic: {
      code: 'truncated-instruction',
      message: expect.stringContaining('BUILD_ARRAY'),
    },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})
