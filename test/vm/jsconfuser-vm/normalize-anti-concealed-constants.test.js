import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseNormalizeAntiWordcode } from '../../../src/vm/jsconfuser-vm/normalize-anti-wordcode.js'
import { diagnoseNormalizeConcealedConstants } from '../../../src/vm/jsconfuser-vm/normalize-concealed-constants.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

const fixtureRoot = new URL(
  'fixtures/concealed-constants-anti-instrumentation/',
  import.meta.url,
)
const fixture = (file) => fs.readFileSync(new URL(file, fixtureRoot), 'utf8')

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, Buffer, performance: { now: () => 0 } },
    { timeout: 10000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test('normalizes anti wordcode before keyed constants and preserves finalizer behavior', () => {
  const source = fixture('source.js')
  const encoded = fixture('encoded.js')
  const record = JSON.parse(fixture('qualification.json'))
  const container = diagnoseContainer(encoded).result
  const before = JSON.stringify(container)
  const anti = diagnoseNormalizeAntiWordcode(encoded, container)
  expect(anti.ok).toBe(true)
  expect(JSON.stringify(container)).toBe(before)
  const antiWordcode = readWordcode(anti.result.container)
  expect(
    antiWordcode.instructions.some((instruction) =>
      instruction.operands.some(
        (operand) =>
          operand.kind === 'constant-ref' && operand.concealKey !== 0,
      ),
    ),
  ).toBe(true)
  expect(validateReferences(anti.result.container, antiWordcode)).toBeNull()
  const constants = diagnoseNormalizeConcealedConstants(
    encoded,
    anti.result.container,
    antiWordcode,
  )
  expect(constants.ok).toBe(true)
  expect(
    validateReferences(
      constants.result.container,
      readWordcode(constants.result.container),
    ),
  ).not.toBeNull()

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(source)).toEqual(observe(encoded))
  expect(observe(source)).toEqual(observe(decoded.result.output))
  expect(record.effectObservation).toMatchObject({
    observed: true,
    components: { concealConstants: true, antiInstrumentation: true },
  })
})
