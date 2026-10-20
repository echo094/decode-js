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

const dir = new URL(
  'fixtures/class-handler-alias-stack-exceptions/',
  import.meta.url,
)
const source = fs.readFileSync(new URL('source.js', dir), 'utf8')
const encoded = fs.readFileSync(new URL('encoded.js', dir), 'utf8')
const record = JSON.parse(fs.readFileSync(new URL('qualification.json', dir)))

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test('decodes the eleven-effect class and handler-table stack', () => {
  const container = diagnoseContainer(encoded)
  expect(container.ok).toBe(true)
  expect(container.result.roles.pool.values.some((value) => value < 0)).toBe(
    true,
  )

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
