import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import vm from 'node:vm'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'

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

const fixtureFile = (folder, name) =>
  fs.readFileSync(
    path.join(packageRoot, 'test/vm/jsconfuser-vm/fixtures', folder, name),
    'utf8',
  )
const layerPair = (name) => fixtureFile('layer-pair-arithmetic', `${name}.js`)

function switchCount(source) {
  let count = 0
  traverse(parse(source), {
    SwitchStatement() {
      count++
    },
  })
  return count
}

test('the layer-pair VM layer decodes on its own', () => {
  const input = layerPair('vm-only')
  const record = decodeJsconfuserVmSequential(input)
  expect(record.ok).toBe(true)
  expect(record.output).not.toBe(input)
})

// layer-pair-arithmetic keeps canonical opcodes; outer-layers randomizes them under one outer
// option each, so the handlers must be named through the outer layer's re-spelling.
test.each([
  ['layer-pair-arithmetic', 'outer-complete.js'],
  ['layer-pair-arithmetic', 'outer-without-string-concealing.js'],
  ['outer-layers', 'compact.encoded.js'],
  ['outer-layers', 'object-extraction.encoded.js'],
  ['outer-layers', 'moved-declarations.encoded.js'],
  ['outer-layers', 'minify.encoded.js'],
  ['outer-layers', 'variable-masking.encoded.js'],
])(
  '%s %s: VM preparation recovers the wrapped program without runtime residue',
  (folder, name) => {
    const input = fixtureFile(folder, name)
    const record = decodeJsconfuserVmSequential(input)
    expect(record).toMatchObject({
      ok: true,
      failedStage: null,
      stages: { outer: { ok: true }, vm: { ok: true } },
    })
    expect(record.output).not.toBe(input)
    expect(switchCount(record.stages.outer.output)).toBe(1)
    expect(switchCount(record.output)).toBe(0)
    // The VM payload is the word stream and the constant pool: arrays of literals only. Recovered
    // calls pass their arguments as arrays of registers, which are program code.
    const literal = (node) =>
      [
        'NumericLiteral',
        'StringLiteral',
        'BooleanLiteral',
        'NullLiteral',
      ].includes(node?.type) ||
      (node?.type === 'UnaryExpression' &&
        node.operator === '-' &&
        node.argument.type === 'NumericLiteral')
    const residue = (source) => {
      let payloads = 0
      let installations = 0
      traverse(parse(source), {
        ArrayExpression(path) {
          if (path.node.elements.length && path.node.elements.every(literal))
            payloads++
        },
        AssignmentExpression(path) {
          if (
            path.node.left.type === 'MemberExpression' &&
            path.node.right.type === 'FunctionExpression'
          )
            installations++
        },
      })
      return { payloads, installations }
    }
    // Control: the outer stage's output still holds the payload the VM stage removes.
    expect(residue(record.stages.outer.output).payloads).toBeGreaterThan(0)
    const { payloads, installations } = residue(record.output)
    expect(payloads).toBe(0)
    expect(installations).toBe(0)
    const observe = (source) => {
      const context = { Buffer, performance: { now: () => 0 } }
      context.window = context
      vm.runInNewContext(source, context, { timeout: 1000 })
      return context.TEST_OUTPUT
    }
    const source = fixtureFile(folder, 'source.js')
    expect(observe(record.output)).toBe(observe(source))
    expect(observe(input)).toBe(observe(source))
  },
)

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
