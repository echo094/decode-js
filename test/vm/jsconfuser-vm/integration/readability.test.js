import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { expect, test } from 'vitest'
import { expectConsistentState } from '../../../helper.js'
import { diagnoseStandalone } from '../../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { collectMetrics, loadBaseline } from './readability-metrics.js'

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/readability',
)
const parserOptions = {
  allowReturnOutsideFunction: true,
  errorRecovery: false,
  sourceType: 'script',
}

function execute(filePath) {
  const context = {}
  context.window = context
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, {
    filename: filePath,
    timeout: 5000,
  })
  return context.TEST_OUTPUT
}

function outputFunction(output, functionId) {
  const start = output.indexOf(`function __recovered_function_${functionId}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = output.indexOf('\n  function __recovered_function_', start + 1)
  return output.slice(start, next === -1 ? output.length : next)
}

function decodedOutput(caseId) {
  return fs.readFileSync(path.join(fixtureRoot, caseId, 'decoded.js'), 'utf8')
}

function baselineByCase() {
  return new Map(loadBaseline().cases.map((entry) => [entry.caseId, entry]))
}

test('readability benchmark is tracked, complete, and deterministic', () => {
  const first = collectMetrics()
  const second = collectMetrics()

  expect(second).toEqual(first)
  expect(first.schemaVersion).toBe('jsconfuser-vm-readability-metrics.v1')
  expect(first.cases.map(({ caseId }) => caseId)).toEqual([
    'arithmetic',
    'closure-loop',
    'scale',
  ])
  expect(first.cases.every(({ status }) => status === 'success')).toBe(true)
  for (const result of first.cases) {
    expect(result.files.source.bytes).toBeGreaterThan(0)
    expect(result.files.encoded.bytes).toBeGreaterThan(
      result.files.source.bytes,
    )
    expect(result.files.decoded.bytes).toBeGreaterThan(0)
    expect(result.ratios.decodedToSource).toBeTypeOf('number')
    expect(result.ratios.decodedToEncoded).toBeTypeOf('number')
    expect(result.ast.decoded.statements).toBeGreaterThan(0)
    expect(result.ast.decoded.declaredIdentifiers).toBeGreaterThan(0)
  }
})

test('baseline records the generated VM representation that readability work must address', () => {
  const metrics = collectMetrics()
  const generatedTotals = metrics.cases.map(
    ({ generatedIdentifiers }) => generatedIdentifiers.total,
  )
  const generatedStatementTotals = metrics.cases.map(
    ({ ast }) => ast.decoded.generatedStatements,
  )

  expect(generatedTotals.every((total) => total > 0)).toBe(true)
  expect(generatedStatementTotals.every((total) => total > 0)).toBe(true)
  expect(
    metrics.cases.every(
      ({ operations }) => operations.enumerableHelper.declarations === 0,
    ),
  ).toBe(true)
})

test('retains only setup required by captures, arguments, and enumeration', () => {
  const arithmetic = decodedOutput('arithmetic')
  expect(outputFunction(arithmetic, 0)).toMatch(
    /^function __recovered_function_0\(\)/,
  )

  const closure = decodedOutput('closure-loop')
  expect(outputFunction(closure, 0)).toMatch(
    /^function __recovered_function_0\(\)/,
  )
  expect(outputFunction(closure, 1)).toMatch(
    /^function __recovered_function_1\(\.\.\.__recovered_args\)/,
  )
  expect(outputFunction(closure, 1)).toContain(
    'const __recovered_cells_1 = [];',
  )
  expect(outputFunction(closure, 2)).toMatch(
    /^function __recovered_function_2\(__recovered_captures, \.\.\.__recovered_args\)/,
  )
  expect(outputFunction(closure, 2)).not.toContain(
    'const __recovered_cells_2 = [];',
  )

  const forInPath = path.join(
    fixtureRoot,
    '../corpus/raw/f-for-in-enumeration/encoded.js',
  )
  const forInDiagnosis = diagnoseStandalone(fs.readFileSync(forInPath, 'utf8'))
  expect(forInDiagnosis.ok).toBe(true)
  expect(forInDiagnosis.result.output).toContain(
    'function __recovered_enumerable_keys(__value)',
  )
})

test('source-oriented output is smaller without changing recovered behavior', () => {
  const metrics = collectMetrics()
  const baselines = baselineByCase()
  const expectedEmptyCells = {
    arithmetic: 0,
    'closure-loop': 1,
    scale: 0,
  }

  for (const result of metrics.cases) {
    const baseline = baselines.get(result.caseId)
    expect(baseline).toBeDefined()
    expect(result.files.decoded.bytes).toBeLessThan(baseline.decoded.bytes)
    expect(result.ratios.decodedToSource).toBeLessThan(
      baseline.decoded.ratios.decodedToSource,
    )
    expect(result.ratios.decodedToEncoded).toBeLessThan(
      baseline.decoded.ratios.decodedToEncoded,
    )
    expect(result.ast.decoded.statements).toBeLessThan(
      baseline.decoded.ast.statements,
    )
    expect(result.ast.decoded.generatedStatements).toBeLessThan(
      baseline.decoded.ast.generatedStatements,
    )
    expect(result.ast.decoded.declaredIdentifiers).toBeLessThan(
      baseline.decoded.ast.declaredIdentifiers,
    )
    expect(result.ast.decoded.generatedDeclarations.total).toBeLessThan(
      baseline.decoded.ast.generatedDeclarations.total,
    )
    expect(
      result.ast.decoded.generatedDeclarations.zeroReferences,
    ).toBeLessThanOrEqual(
      baseline.decoded.ast.generatedDeclarations.zeroReferences,
    )
    expect(result.ast.decoded.emptyCellDeclarations).toBe(
      expectedEmptyCells[result.caseId],
    )
    expect(result.generatedIdentifiers.total).toBeLessThan(
      baseline.decoded.generatedIdentifiers.total,
    )
    expect(result.generatedIdentifiers.distinct).toBeLessThan(
      baseline.decoded.generatedIdentifiers.distinct,
    )
    expect(result.eligibleAdjacentCopies).toBe(0)
    expect(result.operations.enumerableHelper).toEqual({
      declarations: 0,
      calls: 0,
      unused: false,
    })
    expect({
      reflectCalls: result.operations.reflectCalls,
      computedGlobalThis: result.operations.computedGlobalThis,
      descriptorCalls: result.operations.descriptorCalls,
      closureWrappers: result.operations.closureWrappers,
      handlerOperations: result.operations.handlerOperations,
      structuredFunctions: result.operations.structuredFunctions,
      stateMachineFunctions: result.operations.stateMachineFunctions,
    }).toEqual(baseline.decoded.operations)

    const sourcePath = path.join(fixtureRoot, result.caseId, 'source.js')
    const decodedPath = path.join(fixtureRoot, result.caseId, 'decoded.js')
    expect(execute(decodedPath)).toEqual(execute(sourcePath))

    const decoded = fs.readFileSync(decodedPath, 'utf8')
    const ast = parse(decoded, parserOptions)
    expect(() =>
      expectConsistentState(ast, decoded, parserOptions),
    ).not.toThrow()
    expect(decoded).not.toMatch(
      /\b(?:VM|Upvalue|decodeBytecode|BYTECODE|CONSTANTS|wordcode)\b/,
    )
  }
})
