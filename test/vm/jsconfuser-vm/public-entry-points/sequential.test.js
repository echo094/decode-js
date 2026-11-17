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
import { scriptTimeout } from '../../../helper.js'
import { inputPath } from '../support/cells.js'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(testDirectory, '../../../..')
const outerInputPath = path.join(
  packageRoot,
  'test/jsconfuser/control-flow-flattening-scope-capture.js',
)
const vmInputPath = inputPath('f-literals-order', 'baseline', 1)

test('outer decoding cannot publish a partial VM result', () => {
  const input = fs.readFileSync(outerInputPath, 'utf8')
  const record = decodeJsconfuserVmSequential(input, { postStage: false })

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
  const record = decodeJsconfuserVmSequential(input, { postStage: false })
  expect(record.output).toBe(input)
  expect(record.diagnostic).toMatchObject({
    stage: 'vm',
    code: 'container-declined',
  })
})

test('visible numeric VM input completes through both decoders', () => {
  const input = fs.readFileSync(vmInputPath, 'utf8')
  const record = decodeJsconfuserVmSequential(input, { postStage: false })

  expect(record).toMatchObject({
    schemaVersion: 'jsconfuser-vm-sequential.v1',
    ok: true,
    status: 'success',
    input,
    diagnostic: null,
    failedStage: null,
    result: { schemaVersion: 'jsconfuser-vm-standalone.v3' },
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
  const record = decodeJsconfuserVmSequential(input, { postStage: false })
  expect(record).toMatchObject({
    ok: false,
    output: input,
    failedStage: 'outer',
    diagnostic: { stage: 'outer', code: 'outer-declined' },
    stages: { vm: { status: 'pending' } },
  })
})

// A committed two-encoder output: the VM encoder, then the outer encoder (see its generation.json).
const layeredInput = (program, name) =>
  fs.readFileSync(
    path.join(packageRoot, 'test/vm/jsconfuser-vm/layered-inputs', program, name),
    'utf8',
  )
// The program a committed layered input was made from, named by its generation record.
const programOf = (folder) =>
  fs.readFileSync(
    path.join(
      packageRoot,
      'test/vm/jsconfuser-vm/sources',
      JSON.parse(layeredInput(folder, 'generation.json')).source,
      'source.js',
    ),
    'utf8',
  )

function switchCount(source) {
  let count = 0
  traverse(parse(source), {
    SwitchStatement() {
      count++
    },
  })
  return count
}

test('the conditional-increment VM layer decodes on its own', () => {
  const input = fs.readFileSync(
    inputPath('conditional-increment', 'baseline', 1, { listing: true }),
    'utf8',
  )
  const record = decodeJsconfuserVmSequential(input, { postStage: false })
  expect(record.ok).toBe(true)
  expect(record.output).not.toBe(input)
})

// conditional-increment keeps canonical opcodes; counter-total randomizes them under one outer
// option each, so the handlers must be named through the outer layer's re-spelling.
test.each([
  ['conditional-increment', 'complete.js'],
  ['conditional-increment', 'without-string-concealing.js'],
  ['counter-total', 'compact.js'],
  ['counter-total', 'object-extraction.js'],
  ['counter-total', 'moved-declarations.js'],
  ['counter-total', 'minify.js'],
  ['counter-total', 'variable-masking.js'],
])(
  '%s %s: VM preparation recovers the wrapped program without runtime residue',
  (folder, name) => {
    const input = layeredInput(folder, name)
    const record = decodeJsconfuserVmSequential(input, { postStage: false })
    expect(record).toMatchObject({
      ok: true,
      failedStage: null,
      stages: { outer: { ok: true }, vm: { ok: true } },
    })
    expect(record.output).not.toBe(input)
    expect(switchCount(record.stages.outer.output)).toBe(1)
    expect(switchCount(record.output)).toBe(0)
    // The VM payload is the word stream and the constant pool: arrays of literals in the outer
    // stage's output. Residue is one of those arrays surviving into the output; a recovered call's
    // own literal arguments (`Reflect.apply(max, Math, [2, 7])`) are program code, not payload.
    const literalValue = (node) => {
      if (
        ['NumericLiteral', 'StringLiteral', 'BooleanLiteral'].includes(
          node?.type,
        )
      )
        return node.value
      if (node?.type === 'NullLiteral') return null
      if (
        node?.type === 'UnaryExpression' &&
        node.operator === '-' &&
        node.argument.type === 'NumericLiteral'
      )
        return -node.argument.value
      return undefined
    }
    const residue = (source) => {
      const payloads = []
      let installations = 0
      traverse(parse(source), {
        ArrayExpression(path) {
          const values = path.node.elements.map(literalValue)
          if (values.length && !values.includes(undefined))
            payloads.push(JSON.stringify(values))
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
    const outerPayloads = new Set(residue(record.stages.outer.output).payloads)
    expect(outerPayloads.size).toBeGreaterThan(0)
    const { payloads, installations } = residue(record.output)
    expect(payloads.filter((payload) => outerPayloads.has(payload))).toEqual([])
    expect(installations).toBe(0)
    const observe = (source) => {
      const context = { Buffer, performance: { now: () => 0 } }
      context.window = context
      vm.runInNewContext(source, context, { timeout: scriptTimeout })
      return context.TEST_OUTPUT
    }
    const source = programOf(folder)
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
      '--no-post-stage',
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
