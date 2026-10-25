import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { diagnoseStandaloneInput } from '../../../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { numericToVmSwitch } from '../../../src/vm/jsconfuser-vm/numeric-to-vm-switch.js'
import { solveControl } from '../../../src/vm/switch/vm-switch-control.js'

function fixture(cellId, kind = 'raw') {
  const directory = new URL(
    `./fixtures/${kind === 'readability' ? 'readability' : `corpus/${kind}`}/${cellId}/`,
    import.meta.url,
  )
  return {
    encoded: fs.readFileSync(new URL('encoded.js', directory), 'utf8'),
    source: fs.readFileSync(new URL('source.js', directory), 'utf8'),
  }
}

function execute(source) {
  const window = {}
  window.window = window
  const context = vm.createContext(window)
  vm.runInContext(source, context, { timeout: 5000 })
  return window.TEST_OUTPUT
}

function staticChecks(output) {
  const ast = parseSuccessfulOutput(output)
  expect(assertNoVmResidue(ast).ok).toBe(true)
  expect(assertDerivedStateConsistency(ast, output).ok).toBe(true)
}

// The frontend's instruction at a PC, by function.
function instructionAt(encoded) {
  const { model } = diagnoseStandaloneInput(encoded)
  return (functionId, pc) =>
    model.instructionsByFunction.get(functionId).find((item) => item.pc === pc)
}

// The control solver's edges entering a case, by function.
function incomingCount(encoded) {
  const model = numericToVmSwitch(diagnoseStandaloneInput(encoded).model)
  const edges = new Map(
    model.functions.functions.map((fn) => [
      fn.id,
      solveControl(fn, model.instructionsByFunction.get(fn.id)).edges,
    ]),
  )
  return (functionId, pc) =>
    edges.get(functionId).filter(({ targetPc }) => targetPc === pc).length
}

test('source-derived copy proofs simplify independent supported controls', () => {
  for (const [cellId, kind] of [
    ['arithmetic', 'readability'],
    ['f-literals-order', 'raw'],
  ]) {
    const input = fixture(cellId, kind)
    const diagnosis = diagnoseStandalone(input.encoded)
    expect(diagnosis.ok, cellId).toBe(true)
    const { result } = diagnosis
    expect(result.simplification.schemaVersion).toBe(
      'jsconfuser-vm-simplification.v1',
    )
    expect(result.proof.freshSimplificationState).toBe(true)
    expect(result.proof.simplificationDispositionsDisjoint).toBe(true)
    expect(result.simplification.summary.safelyEliminated).toBeGreaterThan(0)
    for (const proof of result.simplification.functions.flatMap(
      ({ copies }) => copies,
    )) {
      expect(proof.disposition).toBe('safely-eliminated')
      expect(proof.reachingDefinitions).toEqual([String(proof.producerPc)])
      expect(proof.useSites).toEqual([
        { pc: proof.movePc, register: proof.sourceRegister },
      ])
      expect(proof.producerRetained).toBe(true)
      expect(proof.evaluationOrderPreserved).toBe(true)
      expect(proof.receiverSemanticsPreserved).toBe(true)
    }
    staticChecks(result.output)
    expect(execute(result.output)).toEqual(execute(input.source))
  }
})

test('joins and capture cells remain barriers to copy coalescing', () => {
  const branching = fixture('f-branching')
  const branchingDiagnosis = diagnoseStandalone(branching.encoded)
  expect(branchingDiagnosis.ok).toBe(true)
  const branchingResult = branchingDiagnosis.result
  const branchingInstruction = instructionAt(branching.encoded)
  const branchingIncoming = incomingCount(branching.encoded)
  for (const proof of branchingResult.simplification.functions.flatMap(
    ({ copies }) => copies,
  )) {
    expect(branchingInstruction(proof.functionId, proof.movePc)?.name).toBe(
      'MOVE',
    )
    expect(branchingIncoming(proof.functionId, proof.movePc)).toBe(1)
  }
  expect(execute(branchingResult.output)).toEqual(execute(branching.source))

  const closure = fixture('closure-loop', 'readability')
  const closureDiagnosis = diagnoseStandalone(closure.encoded)
  expect(closureDiagnosis.ok).toBe(true)
  const closureFunctions = closureDiagnosis.result.simplification.functions
  expect(
    closureFunctions.find(({ functionId }) => functionId === 1).copies,
  ).toEqual([])
  expect(
    closureFunctions.find(({ functionId }) => functionId === 2).copies,
  ).toEqual([])
  expect(closureDiagnosis.result.output).toContain(
    'const __recovered_cells_1 = [];',
  )
  expect(execute(closureDiagnosis.result.output)).toEqual(
    execute(closure.source),
  )
})

test('effectful producers are retained while only their private move is removed', () => {
  const input = fixture('f-expression-mutation')
  const diagnosis = diagnoseStandalone(input.encoded)
  expect(diagnosis.ok).toBe(true)
  const instruction = instructionAt(input.encoded)
  const effectfulNames = new Set(['ADD', 'BUILD_ARRAY', 'BUILD_OBJECT'])
  const effectfulProofs = diagnosis.result.simplification.functions
    .flatMap(({ copies }) => copies)
    .filter((proof) => {
      const producer = instruction(proof.functionId, proof.producerPc)
      return effectfulNames.has(producer?.name)
    })
  expect(effectfulProofs.length).toBeGreaterThan(0)
  expect(
    effectfulProofs.every(({ producerRetained }) => producerRetained),
  ).toBe(true)
  staticChecks(diagnosis.result.output)
  expect(execute(diagnosis.result.output)).toEqual(execute(input.source))
})
