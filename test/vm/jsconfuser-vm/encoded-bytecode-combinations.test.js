import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

const fixture = new URL(
  'fixtures/encoded-class-stack-exceptions/',
  import.meta.url,
)
const source = fs.readFileSync(new URL('source.js', fixture), 'utf8')
const encoded = fs.readFileSync(new URL('encoded.js', fixture), 'utf8')
const record = JSON.parse(
  fs.readFileSync(new URL('qualification.json', fixture)),
)

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test('decodes the twelve-effect encoded class stack', () => {
  expect(diagnoseContainer(encoded).ok).toBe(true)
  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  const expected = observe(source)
  expect(observe(encoded)).toEqual(expected)
  expect(observe(decoded.result.output)).toEqual(expected)
  expect(record.status).toBe('accepted')
  expect(record.effectObservation.observed).toBe(true)
  expect(
    Object.values(record.effectObservation.components).every(Boolean),
  ).toBe(true)
})

test('declines a damaged class-inlined base64 payload', () => {
  const damaged = encoded.replace(/(decodeBytecode\(")[^"]/, '$1*')
  expect(damaged).not.toBe(encoded)
  expect(diagnoseContainer(damaged)).toMatchObject({
    ok: false,
    diagnostic: { code: 'missing-role' },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'container-declined' },
  })
})
