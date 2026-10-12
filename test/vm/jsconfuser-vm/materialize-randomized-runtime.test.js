import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { materializeEncodedBytecode } from '../../../src/vm/jsconfuser-vm/materialize-encoded-bytecode.js'
import { materializeRandomizedRuntime } from '../../../src/vm/jsconfuser-vm/materialize-randomized-runtime.js'
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
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test.each([
  ['randomized-runtime-exceptions', false],
  ['randomized-encoded-exceptions', true],
])(
  'projects and decodes %s',
  (name, encodedPayload) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const record = JSON.parse(fixture(name, 'qualification.json'))
    const ast = parse(encoded, { sourceType: 'script' })
    const projected = materializeRandomizedRuntime(
      encodedPayload ? materializeEncodedBytecode(ast) : ast,
    )
    expect(diagnoseContainer(projected).ok).toBe(true)
    expect(diagnoseContainer(encoded).ok).toBe(true)
    const decoded = diagnoseStandalone(encoded)
    expect(decoded.ok).toBe(true)
    const output = parseSuccessfulOutput(decoded.result.output)
    expect(assertNoVmResidue(output).ok).toBe(true)
    expect(
      assertDerivedStateConsistency(output, decoded.result.output).ok,
    ).toBe(true)
    const expected = observe(source)
    expect(observe(encoded)).toEqual(expected)
    expect(observe(decoded.result.output)).toEqual(expected)
    expect(record.status).toBe('accepted')
    expect(record.effectObservation.observed).toBe(true)
    if (encodedPayload) {
      expect(
        Object.values(record.effectObservation.components).every(Boolean),
      ).toBe(true)
    }
  },
  60000,
)

test('declines duplicate randomized opcode values', () => {
  const encoded = fixture('randomized-runtime-exceptions', 'encoded.js')
  const labels = encoded.match(/LOAD_CONST: (\d+),\n {2}LOAD_INT: (\d+)/)
  expect(labels).not.toBeNull()
  const damaged = encoded.replace(
    `LOAD_INT: ${labels[2]}`,
    `LOAD_INT: ${labels[1]}`,
  )
  expect(() => materializeRandomizedRuntime(parse(damaged))).toThrow(
    'Opcode values are not distinct u16 words',
  )
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'container-declined' },
  })
})

test('declines changed decoy-slot behavior', () => {
  const encoded = fixture('randomized-runtime-exceptions', 'encoded.js')
  const damaged = encoded.replace(
    'SLOTS.NOISE_END] = end;',
    'SLOTS.NOISE_END] = end + 1;',
  )
  expect(damaged).not.toBe(encoded)
  expect(() => materializeRandomizedRuntime(parse(damaged))).toThrow(
    'Pinned noise guards are incomplete',
  )
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'container-declined' },
  })
})
