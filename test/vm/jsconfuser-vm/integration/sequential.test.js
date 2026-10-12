import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import { decodeJsconfuserVmSequential } from '../../../../src/plugin/jsconfuser-vm-sequential.js'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(testDirectory, '../../../..')
const outerInputPath = path.join(
  packageRoot,
  'test/jsconfuser/control-flow-flattening-scope-capture.js',
)
const vmInputPath = path.join(
  packageRoot,
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-literals-order/encoded.js',
)

test('outer decoding cannot publish a partial VM result', () => {
  const input = fs.readFileSync(outerInputPath, 'utf8')
  const record = decodeJsconfuserVmSequential(input)

  expect(record).toMatchObject({
    schemaVersion: 'jsconfuser-vm-sequential.v1',
    ok: false,
    input,
    output: input,
    result: null,
    failedStage: 'vm',
    diagnostic: { stage: 'vm', code: 'container-declined' },
    stages: {
      outer: { status: 'success', ok: true, output: expect.any(String) },
      vm: { status: 'declined', ok: false },
    },
  })
  expect(record.stages.outer.output).not.toBe(input)
  expect(Object.isFrozen(record)).toBe(true)
})

test('ordinary source remains unchanged when no VM container exists', () => {
  const input = 'const answer = 42;\nwindow.TEST_OUTPUT = answer;\n'
  const record = decodeJsconfuserVmSequential(input)
  expect(record.output).toBe(input)
  expect(record.diagnostic).toMatchObject({
    stage: 'vm',
    code: 'container-declined',
  })
})

test('visible numeric VM input completes through both decoders', () => {
  const input = fs.readFileSync(vmInputPath, 'utf8')
  const record = decodeJsconfuserVmSequential(input)

  expect(record).toMatchObject({
    schemaVersion: 'jsconfuser-vm-sequential.v1',
    ok: true,
    status: 'success',
    input,
    diagnostic: null,
    failedStage: null,
    result: { schemaVersion: 'jsconfuser-vm-standalone.v1' },
    stages: {
      outer: { status: 'success', ok: true },
      vm: { status: 'success', ok: true },
    },
  })
  expect(record.output).toBe(record.result.output)
  expect(record.output).not.toBe(input)
  expect(Object.isFrozen(record.result)).toBe(true)
})

test('invalid source declines at the outer decoder', () => {
  const input = 'function ('
  const record = decodeJsconfuserVmSequential(input)
  expect(record).toMatchObject({
    ok: false,
    output: input,
    failedStage: 'outer',
    diagnostic: { stage: 'outer', code: 'outer-declined' },
    stages: { vm: { status: 'pending' } },
  })
})

test('sequential CLI writes the original source and diagnosis on VM decline', () => {
  const directory = fs.mkdtempSync(
    path.join(tmpdir(), 'jsconfuser-vm-sequential-'),
  )
  const inputPath = path.join(directory, 'input.js')
  const outputPath = path.join(directory, 'output.js')
  const resultPath = path.join(directory, 'result.json')
  const input = fs.readFileSync(outerInputPath, 'utf8')
  fs.writeFileSync(inputPath, input)

  const completed = spawnSync(
    process.execPath,
    [
      'src/main.js',
      '-t',
      'jsconfuser-vm-sequential',
      '-i',
      inputPath,
      '-o',
      outputPath,
      '--result',
      resultPath,
    ],
    { cwd: packageRoot, encoding: 'utf8' },
  )

  expect(completed.status).toBe(0)
  expect(completed.stdout).toContain('Status: declined')
  expect(completed.stderr).toContain('Diagnostic: container-declined')
  expect(fs.readFileSync(outputPath, 'utf8')).toBe(input)
  expect(JSON.parse(fs.readFileSync(resultPath, 'utf8'))).toMatchObject({
    schemaVersion: 'jsconfuser-vm-sequential.v1',
    status: 'declined',
    output: input,
    diagnostic: { stage: 'vm', code: 'container-declined' },
  })
})
