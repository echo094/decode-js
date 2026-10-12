import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseAliasedRuntime } from '../../../src/vm/jsconfuser-vm/observe-aliased-runtime.js'
import { diagnoseNormalizeAliasedWordcode } from '../../../src/vm/jsconfuser-vm/normalize-aliased-wordcode.js'
import {
  diagnoseAliasedWordStream,
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
  'aliased-runtime-boot',
  'aliased-runtime-closures',
  'aliased-runtime-exceptions',
])('proves, normalizes, and decodes %s', (name) => {
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const qualification = JSON.parse(fixture(name, 'qualification.json'))
  const packetA = diagnoseContainer(encoded).result
  const originalWords = packetA.roles.words.values.slice()
  expect(diagnoseWordcode(packetA)).toMatchObject({
    ok: false,
    diagnostic: { code: 'unknown-opcode' },
  })
  const runtime = diagnoseAliasedRuntime(encoded)
  expect(runtime.ok).toBe(true)
  const stream = diagnoseAliasedWordStream(packetA, runtime.result)
  expect(stream.ok).toBe(true)
  expect(
    stream.result.instructions.some(({ name: op }) => op === 'SYNTHETIC'),
  ).toBe(true)
  const normalized = diagnoseNormalizeAliasedWordcode(encoded, packetA)
  expect(normalized.ok).toBe(true)
  expect(normalized.result.originalWordCount).toBe(originalWords.length)
  expect(normalized.result.container.roles.words.values).toHaveLength(
    originalWords.length,
  )
  expect(readWordcode(normalized.result.container)).not.toBeNull()
  expect(packetA.roles.words.values).toEqual(originalWords)

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(encoded)).toEqual(observe(source))
  expect(observe(decoded.result.output)).toEqual(observe(source))
  expect(qualification.effectObservation).toEqual({
    axis: 'serialized-bytecode',
    observed: true,
  })
  expect(qualification.profile).toBe('aliasedOpcodes')
})

test('declines a changed alias handler even when its word stream remains parseable', () => {
  const encoded = fixture('aliased-runtime-boot', 'encoded.js')
  const damaged = encoded.replace(
    'regs[base + dst] = a * regs[base + _operands[2]];',
    'regs[base + dst] = a * (regs[base + _operands[2]] + 1);',
  )
  expect(damaged).not.toBe(encoded)
  expect(diagnoseAliasedRuntime(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'alias-runtime' },
  })
  expect(
    diagnoseNormalizeAliasedWordcode(
      damaged,
      diagnoseContainer(damaged).result,
    ),
  ).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'alias-runtime' },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})

// Pins the limit of the case-label count predicate: relabelling PATCH to a
// second DEBUGGER case, with an OP.PATCH expression kept for A's member-use
// census, is not caught by A or by alias runtime observation.
test('duplicated case label with preserved member census passes A and alias observation', () => {
  const original = fixture('aliased-runtime-boot', 'encoded.js')
  const patchCase = 'case OP.PATCH:\n          {\n'
  expect(original.split(patchCase)).toHaveLength(2)
  const changed = original.replace(
    patchCase,
    'case OP.DEBUGGER:\n          {\n            OP.PATCH;\n',
  )
  for (const source of [original, changed]) {
    expect(diagnoseContainer(source)).toMatchObject({ ok: true })
    expect(diagnoseAliasedRuntime(source)).toMatchObject({ ok: true })
  }
})
