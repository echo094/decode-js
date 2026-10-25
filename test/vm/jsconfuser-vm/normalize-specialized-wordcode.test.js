import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseSpecializedRuntime } from '../../../src/vm/jsconfuser-vm/observe-specialized-runtime.js'
import { diagnoseNormalizeSpecializedWordcode } from '../../../src/vm/jsconfuser-vm/normalize-specialized-wordcode.js'
import {
  diagnoseSpecializedWordStream,
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
  'specialized-runtime-boot',
  'specialized-runtime-branches',
  'specialized-runtime-closures',
  'specialized-runtime-exceptions',
])('proves, expands, and decodes %s', (name) => {
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const qualification = JSON.parse(fixture(name, 'qualification.json'))
  const extracted = diagnoseContainer(encoded)
  expect(extracted.ok).toBe(true)
  expect(diagnoseWordcode(extracted.result)).toMatchObject({
    ok: false,
    diagnostic: { code: 'unknown-opcode' },
  })
  const runtime = diagnoseSpecializedRuntime(encoded)
  expect(runtime.ok).toBe(true)
  const stream = diagnoseSpecializedWordStream(extracted.result, runtime.result)
  expect(stream.ok).toBe(true)
  const normalized = diagnoseNormalizeSpecializedWordcode(
    encoded,
    extracted.result,
  )
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
  expect(qualification.profile).toBe('specializedOpcodes')
  expect(qualification.effectObservation).toEqual({
    axis: 'serialized-bytecode',
    observed: true,
  })
})

test('declines a changed specialized handler before word expansion', () => {
  const encoded = fixture('specialized-runtime-boot', 'encoded.js')
  const damaged = encoded.replace(
    /(?<=\/\/ MUL_[^\n]+\(specialized\)[\s\S]*?)a \* regs\[base \+ 5\]/,
    'a * (regs[base + 5] + 1)',
  )
  expect(damaged).not.toBe(encoded)
  expect(diagnoseSpecializedRuntime(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'specialized-runtime' },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})
