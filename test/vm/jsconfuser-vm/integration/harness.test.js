import fs from 'node:fs'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import {
  assertDebugCommentIndependent,
  assertDerivedStateConsistency,
  checkAttempt,
  checkVmResidue,
  findVmResidue,
  loadVmCell,
  parseNumericContainer,
  parseSuccessfulOutput,
  runAttempt,
  runBoundedBehavioralOracle,
} from './harness.js'

const rawCell = loadVmCell('f-literals-order')
const focusedCell = loadVmCell('focused-call-method-spread', {
  kind: 'focused',
})

test('loads only stable raw/focused comment-stripped numeric fixtures', () => {
  expect(rawCell.paths.encoded).toMatch(/encoded\.js$/)
  expect(rawCell.paths).not.toHaveProperty('encodedDebug')
  expect(rawCell.encodedSource.startsWith('//')).toBe(false)
  expect(
    rawCell.bytecode.every((word) => Number.isSafeInteger(word) && word >= 0),
  ).toBe(true)
  expect(focusedCell.corpusKind).toBe('focused')
  expect(focusedCell.oracle.cellId).toBe('focused-call-method-spread')
  expect(focusedCell.bytecode).toHaveLength(88)
})

test('rejects the explicitly declined encoded-bytecode mode', () => {
  const encodedInput = focusedCell.encodedSource.replace(
    'var ENCODE_BYTECODE = false;',
    'var ENCODE_BYTECODE = true;',
  )
  expect(() => parseNumericContainer(encodedInput)).toThrowError(
    expect.objectContaining({ code: 'unsupported-encoded-bytecode' }),
  )
})

test('writes and checks named successful attempts, then invokes the oracle seam', async () => {
  const oracleCalls = []
  const attempt = await runAttempt(focusedCell, {
    behavioralOracle: ({ metadata, recoveredSource, source }, signal) => {
      oracleCalls.push({ metadata, recoveredSource, signal, source })
      return { ok: true }
    },
    decoder: () => 'window.TEST_OUTPUT = 5;',
    name: 'success-with-oracle',
  })

  expect(attempt.status).toBe('success')
  expect(attempt.result.attemptName).toBe('success-with-oracle')
  expect(attempt.outputPath).toMatch(
    /jsconfuser-vm-harness-[^/]+\/attempts\/focused\/focused-call-method-spread\/success-with-oracle\.js$/,
  )
  expect(attempt.oracleResult.status).toBe('passed')
  expect(oracleCalls).toHaveLength(1)
  expect(oracleCalls[0].metadata.expected).toEqual([1, 2, 3, 4, 5])
  expect(checkAttempt(attempt).ok).toBe(true)
  expect(fs.readFileSync(attempt.outputPath, 'utf8')).toBe(
    'window.TEST_OUTPUT = 5;',
  )
})

test('writes an exact unchanged output for a decline and never invokes the oracle', async () => {
  let oracleCalled = false
  const attempt = await runAttempt(rawCell, {
    behavioralOracle: () => {
      oracleCalled = true
      return true
    },
    decoder: () => null,
    name: 'decline-exact',
  })

  expect(attempt.status).toBe('declined')
  expect(attempt.output).toBe(rawCell.encodedSource)
  expect(attempt.result.oracle.invoked).toBe(false)
  expect(oracleCalled).toBe(false)
  expect(checkAttempt(attempt).ok).toBe(true)
})

test('runs the behavioral seam only after output parsing and structural checks', async () => {
  let oracleCalled = false
  await expect(
    runAttempt(focusedCell, {
      behavioralOracle: () => {
        oracleCalled = true
        return true
      },
      decoder: () => `${focusedCell.encodedSource}\nvar partial = true;`,
      name: 'partial-recovery',
    }),
  ).rejects.toMatchObject({ code: 'vm-residue' })
  expect(oracleCalled).toBe(false)
})

test.each([
  ['missing decoder', undefined, 'missing-decoder'],
  [
    'malformed result',
    () => ({ output: 'window.TEST_OUTPUT = 1;' }),
    'malformed-recovery',
  ],
  ['undefined recovery', () => undefined, 'undefined-recovery'],
  ['non-string output', () => 42, 'non-string-output'],
  ['malformed JavaScript output', () => 'var =', 'parse-output'],
])('detects %s before writing an attempt', async (_label, decoder, code) => {
  await expect(
    runAttempt(focusedCell, { decoder, name: `negative-${code}` }),
  ).rejects.toMatchObject({ code })
})

test('detects an altered decline artifact instead of accepting it', async () => {
  const attempt = await runAttempt(rawCell, {
    decoder: () => null,
    name: 'altered-decline',
  })
  fs.writeFileSync(attempt.outputPath, 'altered decline', 'utf8')
  expect(() => checkAttempt(attempt)).toThrowError(
    expect.objectContaining({ code: 'decline-output-mismatch' }),
  )
})

test('ordinary JavaScript near-miss declines and is not classified as VM residue', async () => {
  const ordinarySource = 'const answer = 42;\nwindow.TEST_OUTPUT = answer;\n'
  const attempt = await runAttempt(rawCell, {
    decoder: () => null,
    expectedStatus: 'declined',
    input: ordinarySource,
    name: 'ordinary-javascript-near-miss',
  })
  const ast = parseSuccessfulOutput(ordinarySource)
  expect(checkVmResidue(ast).ok).toBe(true)
  expect(attempt.output).toBe(ordinarySource)
})

test('the debug-comment check uses a synthetic comment and catches dependence', () => {
  expect(() =>
    assertDebugCommentIndependent(() => null, rawCell.encodedSource),
  ).not.toThrow()
  expect(() =>
    assertDebugCommentIndependent(
      (source) =>
        source.includes('__A0_SYNTHETIC_DEBUG_COMMENT__') ? 'changed' : null,
      rawCell.encodedSource,
    ),
  ).toThrowError(expect.objectContaining({ code: 'debug-comment-dependence' }))
})

test('the derived-state detector catches a detached cached reference', () => {
  const ast = parse('var value = 1; function read() { return value; }')
  traverse(ast, {
    Program(path) {
      path.scope.crawl()
    },
  })
  traverse(ast, {
    FunctionDeclaration(path) {
      path.node.body.body = []
    },
  })
  expect(() => assertDerivedStateConsistency(ast)).toThrowError(
    expect.objectContaining({ code: 'derived-state' }),
  )
})

test('the bounded oracle seam aborts a finite delayed callback without target execution', async () => {
  let aborted = false
  const outcome = await runBoundedBehavioralOracle(
    (_request, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(true), 50)
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            clearTimeout(timer)
            resolve(false)
          },
          { once: true },
        )
      }),
    {},
    { timeoutMs: 5 },
  )
  expect(outcome).toMatchObject({ status: 'timed-out', timedOut: true })
  expect(aborted).toBe(true)
})

test('the residue detector has a positive control and a clean control', () => {
  const clean = parseSuccessfulOutput('window.TEST_OUTPUT = 1;')
  const residual = parseSuccessfulOutput(
    'var BYTECODE = [1]; var CONSTANTS = [];',
  )
  expect(findVmResidue(clean)).toEqual({ runtime: [], vm: [], wordcode: [] })
  expect(findVmResidue(residual).wordcode).toEqual(['BYTECODE', 'CONSTANTS'])
})
