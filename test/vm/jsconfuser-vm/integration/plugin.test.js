import crypto from 'node:crypto'
import { beforeEach, expect, test, vi } from 'vitest'

const { diagnoseStandaloneSpy } = vi.hoisted(() => ({
  diagnoseStandaloneSpy: vi.fn(),
}))

vi.mock('../../../../src/vm/jsconfuser-vm/decode-standalone.js', async () => {
  const actual = await vi.importActual(
    '../../../../src/vm/jsconfuser-vm/decode-standalone.js',
  )
  diagnoseStandaloneSpy.mockImplementation(actual.diagnoseStandalone)
  return { ...actual, diagnoseStandalone: diagnoseStandaloneSpy }
})

import decodeJsconfuserVm from '../../../../src/plugin/jsconfuser-vm.js'
import normalizeVmInput from '../../../../src/visitor/jsconfuser-vm/normalize-source.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  loadVmCell,
  parseSuccessfulOutput,
} from './harness.js'

const rawCell = loadVmCell('f-literals-order')
const focusedCell = loadVmCell('focused-call-method-spread', {
  kind: 'focused',
})

function sha256(source) {
  return crypto.createHash('sha256').update(source).digest('hex')
}

function expectSingleDiagnosis(input) {
  expect(diagnoseStandaloneSpy).toHaveBeenCalledTimes(1)
  expect(diagnoseStandaloneSpy).toHaveBeenCalledWith(normalizeVmInput(input))
}

beforeEach(() => {
  diagnoseStandaloneSpy.mockClear()
})

test.each([
  ['reference', rawCell],
  ['focused', focusedCell],
])(
  'returns fresh emitted JavaScript and standalone result for the %s fixture',
  (_label, cell) => {
    const adapterResult = decodeJsconfuserVm(cell.encodedSource)
    expectSingleDiagnosis(cell.encodedSource)

    expect(adapterResult).toMatchObject({
      schemaVersion: 'jsconfuser-vm-adapter.v1',
      ok: true,
      status: 'success',
      input: cell.encodedSource,
      diagnostic: null,
    })
    expect(adapterResult.result).toMatchObject({
      schemaVersion: 'jsconfuser-vm-standalone.v1',
      packet: 'N',
      parseOnly: true,
      targetExecution: false,
      vmExecuted: false,
      emittedJavaScript: true,
      finalJavaScriptSemantics: false,
      proof: {
        allPredecessorsReconstructed: true,
        noTargetExecution: true,
        noVmRuntimeEmission: true,
        freshJavaScriptEmission: true,
      },
    })
    expect(adapterResult.output).toBe(adapterResult.result.output)
    expect(adapterResult.output).not.toBe(cell.encodedSource)
    expect(Object.isFrozen(adapterResult)).toBe(true)

    const ast = parseSuccessfulOutput(adapterResult.output)
    expect(assertNoVmResidue(ast).ok).toBe(true)
    expect(assertDerivedStateConsistency(ast, adapterResult.output).ok).toBe(
      true,
    )
  },
)

test.each([
  [
    'ordinary JavaScript near-miss',
    'const answer = 42;\nwindow.TEST_OUTPUT = answer;\n',
    'container-declined',
  ],
  [
    'malformed truncated fixture',
    rawCell.encodedSource.slice(0, -20),
    'container-declined',
  ],
  [
    'explicit hardening decline',
    rawCell.encodedSource.replace(
      'var ENCODE_BYTECODE = false;',
      'var ENCODE_BYTECODE = true;',
    ),
    'container-declined',
  ],
])(
  'returns exact input and stable diagnostic for %s',
  (_label, input, diagnosticCode) => {
    const adapterResult = decodeJsconfuserVm(input)
    expectSingleDiagnosis(input)

    expect(adapterResult).toMatchObject({
      schemaVersion: 'jsconfuser-vm-adapter.v1',
      ok: false,
      status: 'declined',
      input,
      output: input,
      result: null,
      diagnostic: {
        code: diagnosticCode,
        message: expect.any(String),
      },
    })
    expect(adapterResult.output).toBe(input)
    expect(Buffer.byteLength(adapterResult.output)).toBe(
      Buffer.byteLength(input),
    )
    expect(sha256(adapterResult.output)).toBe(sha256(input))
    expect(Object.isFrozen(adapterResult)).toBe(true)
  },
)

test('does not depend on a leading debug comment', () => {
  const debugInput = `// __S4_A_SYNTHETIC_DEBUG_COMMENT__\n${focusedCell.encodedSource}`
  const plain = decodeJsconfuserVm(focusedCell.encodedSource)
  diagnoseStandaloneSpy.mockClear()
  const withDebug = decodeJsconfuserVm(debugInput)
  expectSingleDiagnosis(debugInput)

  expect(withDebug.status).toBe('success')
  expect(withDebug.output).toBe(plain.output)
  expect(withDebug.result).toMatchObject({
    targetExecution: false,
    vmExecuted: false,
  })
})
