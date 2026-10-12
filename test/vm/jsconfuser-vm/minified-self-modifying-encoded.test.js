import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { diagnoseSelfModifyingRegions } from '../../../src/vm/jsconfuser-vm/observe-self-modifying.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

function fixture(file) {
  return fs.readFileSync(
    new URL(
      `fixtures/minified-self-modifying-encoded-exceptions/${file}`,
      import.meta.url,
    ),
    'utf8',
  )
}

const source = fixture('source.js')
const encoded = fixture('encoded.js')
const record = JSON.parse(fixture('qualification.json'))

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test('recovers minified encoded PATCH regions before standalone emission', () => {
  const container = diagnoseContainer(encoded)
  expect(container.ok).toBe(true)
  const patches = diagnoseSelfModifyingRegions(container.result)
  expect(patches.ok).toBe(true)
  expect(patches.result.patches.length).toBeGreaterThan(0)

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(encoded)).toEqual(observe(source))
  expect(observe(decoded.result.output)).toEqual(observe(source))
  expect(record.status).toBe('accepted')
  expect(record.effectObservation.components).toEqual({
    minify: true,
    selfModifying: true,
    encodeBytecode: true,
  })
})
