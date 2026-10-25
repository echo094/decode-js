import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './harness.js'
import { diagnoseStandalone } from '../../../../src/vm/jsconfuser-vm/decode-standalone.js'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(testDirectory, '../../../..')
const repositoryRoot = packageRoot
const evidenceRoot = fs.mkdtempSync(path.join(tmpdir(), 'jsconfuser-vm-cli-'))
const artifactRoot = path.join(evidenceRoot, 'cli-artifacts')
const successInput = path.join(
  repositoryRoot,
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-literals-order/encoded.js',
)
const legacyInput = path.join(
  packageRoot,
  'test/visitor/calculate-constant-exp/non-literal-left.js',
)

fs.mkdirSync(artifactRoot, { recursive: true })

function sha256(source) {
  return crypto.createHash('sha256').update(source).digest('hex')
}

function createCase(name) {
  const directory = path.join(artifactRoot, name)
  fs.rmSync(directory, { force: true, recursive: true })
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

function runCli(args) {
  const completed = spawnSync(process.execPath, ['src/main.js', ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
  })
  if (completed.error) throw completed.error
  return completed
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function assertDeclinedAttempt({ input, outputPath, resultPath, completed }) {
  expect(completed.status).toBe(0)
  expect(completed.stdout).toContain('Status: declined')
  expect(completed.stderr).toContain('Diagnostic: container-declined')

  const output = fs.readFileSync(outputPath, 'utf8')
  const record = readJson(resultPath)
  expect(output).toBe(input)
  expect(sha256(output)).toBe(sha256(input))
  expect(record).toMatchObject({
    schemaVersion: 'jsconfuser-vm-adapter.v1',
    ok: false,
    status: 'declined',
    input,
    output: input,
    result: null,
    diagnostic: {
      code: 'container-declined',
      message: expect.any(String),
    },
  })
}

test('subprocess success writes fresh output and the explicit adapter result', () => {
  const directory = createCase('success-explicit-result')
  const outputPath = path.join(directory, 'decoded.js')
  const resultPath = path.join(directory, 'decoded.json')
  const completed = runCli([
    '-t',
    'jsconfuser-vm',
    '-i',
    successInput,
    '-o',
    outputPath,
    '--result',
    resultPath,
  ])
  const input = fs.readFileSync(successInput, 'utf8')
  const output = fs.readFileSync(outputPath, 'utf8')
  const record = readJson(resultPath)

  expect(completed.status).toBe(0)
  expect(completed.stdout).toContain('Status: success')
  expect(completed.stdout).toContain(`Output written: ${outputPath}`)
  expect(completed.stdout).toContain(`Result written: ${resultPath}`)
  expect(completed.stderr).toBe('')
  expect(output).not.toBe(input)
  expect(record).toMatchObject({
    schemaVersion: 'jsconfuser-vm-adapter.v1',
    ok: true,
    status: 'success',
    input,
    output,
    diagnostic: null,
    result: {
      schemaVersion: 'jsconfuser-vm-standalone.v2',
      parseOnly: true,
      targetExecution: false,
      vmExecuted: false,
      emittedJavaScript: true,
      proof: {
        allPredecessorsReconstructed: true,
        noTargetExecution: true,
        noVmRuntimeEmission: true,
        freshJavaScriptEmission: true,
      },
    },
  })
  expect(record.output).toBe(output)
  const direct = diagnoseStandalone(input)
  expect(direct.ok).toBe(true)
  expect(record.result).toEqual(direct.result)

  const ast = parseSuccessfulOutput(output)
  expect(assertNoVmResidue(ast).ok).toBe(true)
  expect(assertDerivedStateConsistency(ast, output).ok).toBe(true)
})

test('subprocess ordinary decline writes exact output and the default sidecar result', () => {
  const directory = createCase('ordinary-decline-default-result')
  const inputPath = path.join(directory, 'input.js')
  const outputPath = path.join(directory, 'declined.js')
  const resultPath = `${outputPath}.result.json`
  const input = 'const answer = 42;\nwindow.TEST_OUTPUT = answer;\n'
  fs.writeFileSync(inputPath, input)

  const completed = runCli([
    '-t',
    'jsconfuser-vm',
    '-i',
    inputPath,
    '-o',
    outputPath,
  ])

  assertDeclinedAttempt({ input, outputPath, resultPath, completed })
  expect(completed.stdout).toContain(`Result written: ${resultPath}`)
})

test('subprocess container decline remains exact through an explicit result path', () => {
  const directory = createCase('container-decline-explicit-result')
  const inputPath = path.join(directory, 'input.js')
  const outputPath = path.join(directory, 'declined.js')
  const resultPath = path.join(directory, 'declined.json')
  const encoded = fs.readFileSync(successInput, 'utf8')
  const input = encoded.replace('var BYTECODE =', 'var NOT_BYTECODE =')
  expect(input).not.toBe(encoded)
  fs.writeFileSync(inputPath, input)

  const completed = runCli([
    '-t',
    'jsconfuser-vm',
    '-i',
    inputPath,
    '-o',
    outputPath,
    '--result',
    resultPath,
  ])

  assertDeclinedAttempt({ input, outputPath, resultPath, completed })
})

test('rejects a result path that aliases the output before writing either file', () => {
  const directory = createCase('result-output-alias')
  const outputPath = path.join(directory, 'decoded.js')
  const aliasPath = path.join(directory, 'nested', '..', 'decoded.js')
  const sentinel = 'output must remain untouched\n'
  fs.writeFileSync(outputPath, sentinel)

  const completed = runCli([
    '-t',
    'jsconfuser-vm',
    '-i',
    successInput,
    '-o',
    outputPath,
    '--result',
    aliasPath,
  ])

  expect(completed.status).toBe(1)
  expect(completed.stderr).toContain(
    'Output and result files must be different',
  )
  expect(fs.readFileSync(outputPath, 'utf8')).toBe(sentinel)
})

test('unknown target keeps the established non-throwing error path', () => {
  const directory = createCase('unknown-target')
  const outputPath = path.join(directory, 'unknown.js')
  const resultPath = path.join(directory, 'unknown.json')
  const completed = runCli([
    '-t',
    'not-a-target',
    '-i',
    legacyInput,
    '-o',
    outputPath,
    '--result',
    resultPath,
  ])

  expect(completed.status).toBe(1)
  expect(completed.stdout).toContain('Type: not-a-target')
  expect(completed.stderr).toContain('Unknown type: not-a-target')
  expect(fs.existsSync(outputPath)).toBe(false)
  expect(fs.existsSync(resultPath)).toBe(false)
})

test('missing VM input keeps the established read error path', () => {
  const directory = createCase('missing-input')
  const inputPath = path.join(directory, 'missing.js')
  const outputPath = path.join(directory, 'missing-output.js')
  const resultPath = path.join(directory, 'missing-result.json')
  const completed = runCli([
    '-t',
    'jsconfuser-vm',
    '-i',
    inputPath,
    '-o',
    outputPath,
    '--result',
    resultPath,
  ])

  expect(completed.status).toBe(1)
  expect(completed.stderr).toContain(`Cannot read input file ${inputPath}`)
  expect(fs.existsSync(outputPath)).toBe(false)
  expect(fs.existsSync(resultPath)).toBe(false)
})

test('output write failure keeps the result path unwritten', () => {
  const directory = createCase('output-write-failure')
  const inputPath = path.join(directory, 'input.js')
  const outputPath = path.join(directory, 'missing', 'output.js')
  const resultPath = path.join(directory, 'result.json')
  fs.writeFileSync(inputPath, 'const answer = 42;\n')

  const completed = runCli([
    '-t',
    'jsconfuser-vm',
    '-i',
    inputPath,
    '-o',
    outputPath,
    '--result',
    resultPath,
  ])

  expect(completed.status).toBe(1)
  expect(completed.stderr).toContain(`Cannot write output file ${outputPath}`)
  expect(fs.existsSync(outputPath)).toBe(false)
  expect(fs.existsSync(resultPath)).toBe(false)
})

test('existing common target preserves its pre-change output and no sidecar', () => {
  const directory = createCase('legacy-common')
  const outputPath = path.join(directory, 'common.js')
  const completed = runCli([
    '-t',
    'common',
    '-i',
    legacyInput,
    '-o',
    outputPath,
  ])
  const output = fs.readFileSync(outputPath, 'utf8')
  const baseline = fs.readFileSync(
    path.join(
      packageRoot,
      'test/vm/jsconfuser-vm/fixtures/legacy-common/common.js',
    ),
    'utf8',
  )

  expect(completed.status).toBe(0)
  expect(completed.stdout).toContain(`Output written: ${outputPath}`)
  expect(output).toBe(baseline)
  expect(fs.existsSync(`${outputPath}.result.json`)).toBe(false)
})
