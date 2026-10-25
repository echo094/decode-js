import crypto from 'node:crypto'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expectConsistentState } from '../../../helper.js'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(moduleDirectory, '../../../..')
const corpusRoot = path.join(
  repositoryRoot,
  'test/vm/jsconfuser-vm/fixtures/corpus',
)
const evidenceRoot = fs.mkdtempSync(
  path.join(tmpdir(), 'jsconfuser-vm-harness-'),
)
const attemptRoot = path.join(evidenceRoot, 'attempts')

const parserOptions = {
  allowReturnOutsideFunction: true,
  errorRecovery: false,
  sourceType: 'script',
}

const vmRoleNames = new Set(['Closure', 'VM', 'Upvalue', 'decodeBytecode'])
const wordcodeRoleNames = new Set([
  'BYTECODE',
  'CONSTANTS',
  'ENCODE_BYTECODE',
  'MAIN_REG_COUNT',
  'MAIN_START_PC',
  'OP',
  'SENTINELS',
  'SLOTS',
])
const runtimeRoleNames = new Set([
  'FRAME_START',
  'HEADER_SIZE',
  'TIMING_CHECKS',
  'decodeBytecode',
  'Closure',
  'VM',
  'Upvalue',
])

export class HarnessError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'HarnessError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details = {}) {
  throw new HarnessError(code, message, details)
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

function safeSegment(value, label) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  ) {
    fail('unsafe-path-segment', `${label} is not a safe path segment`, {
      value,
    })
  }
  return value
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail('fixture-read', `Could not read JSON fixture ${filePath}`, {
      cause: error.message,
      filePath,
    })
  }
}

function parseSource(source, label, code = 'parse-input') {
  try {
    return parse(source, parserOptions)
  } catch (error) {
    fail(code, `Could not parse ${label}`, { cause: error.message })
  }
}

function getInitializers(ast, name) {
  const initializers = []
  traverse(ast, {
    VariableDeclarator(path) {
      if (path.node.id.type === 'Identifier' && path.node.id.name === name) {
        initializers.push(path.node.init)
      }
    },
  })
  return initializers
}

function getSingleInitializer(ast, name) {
  const initializers = getInitializers(ast, name)
  if (initializers.length !== 1) {
    fail('container-role', `Expected one ${name} declaration`, {
      count: initializers.length,
      name,
    })
  }
  return initializers[0]
}

export function parseNumericContainer(source) {
  const ast = parseSource(source, 'encoded.js')
  const encodeBytecode = getSingleInitializer(ast, 'ENCODE_BYTECODE')
  if (!encodeBytecode || encodeBytecode.type !== 'BooleanLiteral') {
    fail('container-role', 'ENCODE_BYTECODE is not a boolean literal')
  }
  if (encodeBytecode.value === true) {
    fail(
      'unsupported-encoded-bytecode',
      'ENCODE_BYTECODE=true is an explicit decline for the numeric-wordcode harness',
    )
  }

  const bytecode = getSingleInitializer(ast, 'BYTECODE')
  if (!bytecode || bytecode.type !== 'ArrayExpression') {
    fail('container-role', 'BYTECODE is not an array expression')
  }
  const words = bytecode.elements.map((element, index) => {
    if (
      !element ||
      element.type !== 'NumericLiteral' ||
      !Number.isSafeInteger(element.value) ||
      element.value < 0 ||
      element.value > 0xffffffff
    ) {
      fail(
        'non-numeric-wordcode',
        `BYTECODE word ${index} is not an unsigned 32-bit integer`,
        {
          index,
        },
      )
    }
    return element.value
  })

  return { bytecode: Object.freeze(words), encodeBytecode: false }
}

function startsWithLeadingDebugComment(source) {
  const firstLineEnd = source.indexOf('\n')
  const firstLine = firstLineEnd === -1 ? source : source.slice(0, firstLineEnd)
  return firstLine.startsWith('//')
}

function stripLeadingDebugComments(source) {
  let offset = 0
  while (offset < source.length) {
    const lineEnd = source.indexOf('\n', offset)
    const line =
      lineEnd === -1 ? source.slice(offset) : source.slice(offset, lineEnd)
    if (!line.startsWith('//')) break
    offset = lineEnd === -1 ? source.length : lineEnd + 1
  }
  return source.slice(offset)
}

function sha256(source) {
  return crypto.createHash('sha256').update(source).digest('hex')
}

function stableCellPaths(root, kind, cellId) {
  const relativeDirectory = path.join(
    'test/vm/jsconfuser-vm/fixtures/corpus',
    kind,
    cellId,
  )
  const directory = path.join(root, relativeDirectory)
  return deepFreeze({
    directory,
    encoded: path.join(directory, 'encoded.js'),
    oracle: path.join(directory, 'oracle.json'),
    source: path.join(directory, 'source.js'),
  })
}

export function loadVmCell(
  cellId,
  { kind = 'raw', root = repositoryRoot } = {},
) {
  safeSegment(cellId, 'cellId')
  if (kind !== 'raw' && kind !== 'focused') {
    fail(
      'unsupported-corpus-kind',
      `Unsupported js-confuser-vm corpus kind: ${kind}`,
      { kind },
    )
  }

  const paths = stableCellPaths(root, kind, cellId)
  const encodedSource = fs.readFileSync(paths.encoded, 'utf8')
  if (startsWithLeadingDebugComment(encodedSource)) {
    fail(
      'debug-input',
      'The harness accepts only comment-stripped encoded.js input',
    )
  }
  const source = fs.readFileSync(paths.source, 'utf8')
  const oracle = readJson(paths.oracle)
  if (oracle.cellId !== cellId) {
    fail(
      'fixture-metadata',
      'Oracle metadata does not match the requested cell',
      {
        cellId,
        oracleCellId: oracle.cellId,
      },
    )
  }
  const container = parseNumericContainer(encodedSource)

  return deepFreeze({
    bytecode: container.bytecode,
    cellId,
    corpusKind: kind,
    encodedSource,
    oracle,
    paths,
    source,
  })
}

export function parseSuccessfulOutput(output) {
  if (typeof output !== 'string') {
    fail('non-string-output', 'Successful recovery output must be a string')
  }
  return parseSource(output, 'recovered output', 'parse-output')
}

function addFinding(findings, bucket, name) {
  findings[bucket].add(name)
}

export function findVmResidue(ast) {
  const findings = {
    runtime: new Set(),
    vm: new Set(),
    wordcode: new Set(),
  }

  traverse(ast, {
    Identifier(path) {
      const name = path.node.name
      if (vmRoleNames.has(name)) addFinding(findings, 'vm', name)
      if (wordcodeRoleNames.has(name)) addFinding(findings, 'wordcode', name)
      if (runtimeRoleNames.has(name)) addFinding(findings, 'runtime', name)
    },
    MemberExpression(path) {
      if (
        !path.node.computed &&
        path.node.object.type === 'Identifier' &&
        path.node.object.name === 'vm' &&
        path.node.property.type === 'Identifier' &&
        path.node.property.name === 'run'
      ) {
        addFinding(findings, 'runtime', 'vm.run')
      }
    },
    NewExpression(path) {
      if (
        path.node.callee.type === 'Identifier' &&
        path.node.callee.name === 'VM'
      ) {
        addFinding(findings, 'runtime', 'new VM')
      }
    },
  })

  return {
    runtime: [...findings.runtime].sort(),
    vm: [...findings.vm].sort(),
    wordcode: [...findings.wordcode].sort(),
  }
}

export function checkVmResidue(astOrSource) {
  const ast =
    typeof astOrSource === 'string'
      ? parseSuccessfulOutput(astOrSource)
      : astOrSource
  if (!ast || typeof ast !== 'object')
    fail('invalid-ast', 'VM residue check needs a Babel AST or source')
  const findings = findVmResidue(ast)
  return {
    ...findings,
    ok: Object.values(findings).every((bucket) => bucket.length === 0),
  }
}

export function assertNoVmResidue(astOrSource) {
  const findings = checkVmResidue(astOrSource)
  if (!findings.ok) {
    fail(
      'vm-residue',
      'Recovered output still contains VM, wordcode, or runtime residue',
      findings,
    )
  }
  return findings
}

export function assertDerivedStateConsistency(
  ast,
  output,
  parseOptions = parserOptions,
) {
  try {
    expectConsistentState(ast, output, parseOptions)
  } catch (error) {
    fail(
      'derived-state',
      'Recovered AST derived state is inconsistent with its output',
      {
        cause: error.message,
      },
    )
  }
  return { ok: true }
}

function validateRecoveryResult(result) {
  if (result === null) return { output: null, status: 'declined' }
  if (result === undefined)
    fail(
      'undefined-recovery',
      'Decoder returned undefined instead of string or null',
    )
  if (typeof result !== 'string') {
    if (typeof result === 'object' || typeof result === 'function') {
      fail(
        'malformed-recovery',
        'Decoder returned a malformed recovery result',
        {
          type: typeof result,
        },
      )
    }
    fail(
      'non-string-output',
      'Decoder returned a non-string, non-null recovery result',
      {
        type: typeof result,
      },
    )
  }
  return { output: result, status: 'success' }
}

function invokeDecoder(decoder, input, context) {
  if (typeof decoder !== 'function') {
    fail(
      'missing-decoder',
      'A standalone decoder/recovery function must be injected',
    )
  }
  try {
    return validateRecoveryResult(decoder(input, context))
  } catch (error) {
    if (error instanceof HarnessError) throw error
    fail(
      'decoder-threw',
      'Injected decoder threw before producing a recovery result',
      {
        cause: error.message,
      },
    )
  }
}

function canonicalRecovery(result) {
  if (result.output === null) return result
  return {
    output: stripLeadingDebugComments(result.output),
    status: result.status,
  }
}

export function inspectDebugCommentDependence(decoder, input) {
  const context = Object.freeze({
    purpose: 'synthetic-debug-comment-independence-check',
  })
  const plain = invokeDecoder(decoder, input, context)
  const syntheticDebugInput = `// __A0_SYNTHETIC_DEBUG_COMMENT__\n${input}`
  const withDebug = invokeDecoder(decoder, syntheticDebugInput, context)
  const plainCanonical = canonicalRecovery(plain)
  const debugCanonical = canonicalRecovery(withDebug)
  const dependent =
    plainCanonical.status !== debugCanonical.status ||
    plainCanonical.output !== debugCanonical.output
  return {
    dependent,
    inputWasCommentStripped: !startsWithLeadingDebugComment(input),
    syntheticDebugInput,
  }
}

export function assertDebugCommentIndependent(decoder, input) {
  const check = inspectDebugCommentDependence(decoder, input)
  if (check.dependent) {
    fail(
      'debug-comment-dependence',
      'Decoder result changes when a synthetic debug comment is added',
    )
  }
  return check
}

export async function runBoundedBehavioralOracle(
  oracle,
  request,
  { timeoutMs = 2000 } = {},
) {
  if (typeof oracle !== 'function') {
    fail(
      'missing-oracle',
      'Behavioral oracle seam needs a function when enabled',
    )
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail(
      'invalid-oracle-timeout',
      'Behavioral oracle timeout must be a positive integer',
      { timeoutMs },
    )
  }

  const controller = new AbortController()
  let timer
  let timedOut = false
  const oraclePromise = Promise.resolve().then(() =>
    oracle(request, controller.signal),
  )
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      resolve({ kind: 'timeout' })
    }, timeoutMs)
  })
  const settledOracle = oraclePromise.then(
    (value) => ({ kind: 'value', value }),
    (error) => ({ kind: 'error', error }),
  )
  const winner = await Promise.race([settledOracle, timeoutPromise])
  clearTimeout(timer)

  if (winner.kind === 'timeout') return { status: 'timed-out', timedOut: true }
  if (winner.kind === 'error') {
    return { cause: winner.error.message, status: 'failed', timedOut }
  }
  if (winner.value === true || (winner.value && winner.value.ok === true)) {
    return { status: 'passed', timedOut }
  }
  return { status: 'failed', value: winner.value, timedOut }
}

function attemptPathsFor(cell, name, root = repositoryRoot) {
  safeSegment(cell.cellId, 'cellId')
  safeSegment(name, 'attempt name')
  const directory = path.join(
    attemptRootFor(root),
    cell.corpusKind,
    cell.cellId,
  )
  return {
    directory,
    output: path.join(directory, `${name}.js`),
    result: path.join(directory, `${name}.json`),
  }
}

function attemptRootFor(root) {
  return root === repositoryRoot
    ? attemptRoot
    : path.join(root, 'jsconfuser-vm-attempts')
}

export function checkAttempt(attempt) {
  if (!attempt || !attempt.outputPath || !attempt.resultPath) {
    fail('invalid-attempt', 'Attempt check needs a result and output path')
  }
  let output
  let recorded
  try {
    output = fs.readFileSync(attempt.outputPath, 'utf8')
    recorded = readJson(attempt.resultPath)
  } catch (error) {
    if (error instanceof HarnessError) throw error
    fail('attempt-read', 'Could not read named attempt artifacts', {
      cause: error.message,
    })
  }
  if (attempt.status === 'declined' && output !== attempt.input) {
    fail(
      'decline-output-mismatch',
      'Declined attempt output is not byte-for-byte original input',
    )
  }
  if (output !== attempt.output) {
    fail(
      'attempt-output-mismatch',
      'Attempt output changed after it was written',
    )
  }
  const expectedOutputPath = path.relative(
    attempt.repositoryRoot,
    attempt.outputPath,
  )
  const expectedResultPath = path.relative(
    attempt.repositoryRoot,
    attempt.resultPath,
  )
  if (
    recorded.schemaVersion !== 'a0-attempt.v1' ||
    recorded.attemptName !== attempt.name ||
    recorded.caseId !== attempt.cell.cellId ||
    recorded.corpusKind !== attempt.cell.corpusKind ||
    recorded.status !== attempt.status ||
    recorded.inputSha256 !== sha256(attempt.input) ||
    recorded.outputPath !== expectedOutputPath ||
    recorded.resultPath !== expectedResultPath
  ) {
    fail(
      'attempt-result-mismatch',
      'Named attempt result does not describe its artifacts',
    )
  }
  if (
    recorded.outputBytes !== Buffer.byteLength(output) ||
    recorded.outputSha256 !== sha256(output)
  ) {
    fail(
      'attempt-result-mismatch',
      'Named attempt result has the wrong output hash',
    )
  }
  return {
    ok: true,
    outputPath: attempt.outputPath,
    resultPath: attempt.resultPath,
  }
}

async function writeAttempt({
  cell,
  name,
  input,
  output,
  status,
  oracleResult,
  repository,
}) {
  const paths = attemptPathsFor(cell, name, repository)
  fs.mkdirSync(paths.directory, { recursive: true })
  fs.writeFileSync(paths.output, output, 'utf8')
  const record = {
    schemaVersion: 'a0-attempt.v1',
    attemptName: name,
    caseId: cell.cellId,
    corpusKind: cell.corpusKind,
    inputSha256: sha256(input),
    outputBytes: Buffer.byteLength(output),
    outputPath: path.relative(repository, paths.output),
    outputSha256: sha256(output),
    resultPath: path.relative(repository, paths.result),
    oracle: oracleResult
      ? {
          invoked: true,
          status: oracleResult.status,
          timedOut: oracleResult.timedOut,
        }
      : { invoked: false },
    status,
  }
  fs.writeFileSync(paths.result, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return {
    cell,
    input,
    name,
    oracleResult,
    output,
    outputPath: paths.output,
    repositoryRoot: repository,
    result: record,
    resultPath: paths.result,
    status,
  }
}

export async function runAttempt(
  cell,
  {
    behavioralOracle,
    decoder,
    expectedStatus,
    input = cell.encodedSource,
    name,
    oracleTimeoutMs = cell.oracle.timeoutMs ?? 2000,
    root = repositoryRoot,
  },
) {
  if (!cell || typeof cell.encodedSource !== 'string') {
    fail('invalid-cell', 'Attempt needs a loaded js-confuser-vm cell')
  }
  safeSegment(name, 'attempt name')
  if (typeof input !== 'string')
    fail('invalid-input', 'Attempt input must be a string')
  const context = Object.freeze({
    bytecode: cell.bytecode,
    cell,
    input,
    oracle: cell.oracle,
    source: cell.source,
  })
  const recovery = invokeDecoder(decoder, input, context)
  const output = recovery.status === 'declined' ? input : recovery.output
  let ast
  let oracleResult

  if (recovery.status === 'success') {
    ast = parseSuccessfulOutput(output)
    assertNoVmResidue(ast)
    assertDerivedStateConsistency(ast, output)
    if (behavioralOracle) {
      oracleResult = await runBoundedBehavioralOracle(
        behavioralOracle,
        Object.freeze({
          metadata: cell.oracle,
          recoveredSource: output,
          source: cell.source,
        }),
        { timeoutMs: oracleTimeoutMs },
      )
      if (oracleResult.status !== 'passed') {
        fail(
          'behavioral-oracle',
          'Behavioral oracle did not complete successfully',
          oracleResult,
        )
      }
    }
  }

  if (expectedStatus && expectedStatus !== recovery.status) {
    fail(
      'unexpected-status',
      `Expected ${expectedStatus} but recovery was ${recovery.status}`,
    )
  }
  const attempt = await writeAttempt({
    cell,
    input,
    name,
    oracleResult,
    output,
    repository: root,
    status: recovery.status,
  })
  checkAttempt(attempt)
  return { ...attempt, ast }
}

export const paths = deepFreeze({
  attemptRoot,
  corpusRoot,
  evidenceRoot,
  repositoryRoot,
})
