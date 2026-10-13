import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'

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

function allLeaves(control) {
  return control.functions.flatMap((functionRecord) =>
    functionRecord.blocks.flatMap((block) =>
      block.leaves.map((leaf) => ({
        functionId: functionRecord.id,
        leaf,
        block,
      })),
    ),
  )
}

function incomingCount(control, functionId, block) {
  return control.edges.filter(
    (edge) => edge.functionId === functionId && edge.targetPc === block.startPc,
  ).length
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
  const branchingLeaves = allLeaves(branchingResult.control)
  for (const proof of branchingResult.simplification.functions.flatMap(
    ({ copies }) => copies,
  )) {
    const move = branchingLeaves.find(
      ({ functionId, leaf }) =>
        functionId === proof.functionId && leaf.pc === proof.movePc,
    )
    expect(move).toBeDefined()
    expect(
      incomingCount(branchingResult.control, move.functionId, move.block),
    ).toBe(1)
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
  const leaves = allLeaves(diagnosis.result.control)
  const effectfulNames = new Set(['ADD', 'BUILD_ARRAY', 'BUILD_OBJECT'])
  const effectfulProofs = diagnosis.result.simplification.functions
    .flatMap(({ copies }) => copies)
    .filter((proof) => {
      const producer = leaves.find(
        ({ functionId, leaf }) =>
          functionId === proof.functionId && leaf.pc === proof.producerPc,
      )
      return effectfulNames.has(producer?.leaf.name)
    })
  expect(effectfulProofs.length).toBeGreaterThan(0)
  expect(
    effectfulProofs.every(({ producerRetained }) => producerRetained),
  ).toBe(true)
  staticChecks(diagnosis.result.output)
  expect(execute(diagnosis.result.output)).toEqual(execute(input.source))
})
