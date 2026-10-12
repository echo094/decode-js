import fs from 'node:fs'
import vm from 'node:vm'
import generate from '@babel/generator'
import { parse } from '@babel/parser'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { materializeMinifiedEncodedBytecode } from '../../../src/vm/jsconfuser-vm/materialize-minified-encoded-bytecode.js'
import { diagnoseMinifiedRuntime } from '../../../src/vm/jsconfuser-vm/observe-minified-runtime.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

function fixture(file) {
  return fs.readFileSync(
    new URL(
      `fixtures/minified-encoded-bytecode-exceptions/${file}`,
      import.meta.url,
    ),
    'utf8',
  )
}

const source = fixture('source.js')
const encoded = fixture('encoded.js')
const record = JSON.parse(fixture('qualification.json'))

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test('materializes the proved minified decoding loop into numeric wordcode', () => {
  const ast = parse(encoded, { sourceType: 'script' })
  const loop = ast.program.body.at(-2)
  expect(loop.type).toBe('ForStatement')
  const projected = materializeMinifiedEncodedBytecode(ast)
  expect(ast.program.body.at(-2)).toBe(loop)
  expect(diagnoseMinifiedRuntime(projected).ok).toBe(true)
  const container = diagnoseContainer(encoded)
  expect(container.ok).toBe(true)
  expect(container.result.roles.words.values.length).toBeGreaterThan(0)

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(encoded)).toEqual(observe(source))
  expect(observe(decoded.result.output)).toEqual(observe(source))
  expect(record.status).toBe('accepted')
  expect(record.effectObservation.components).toEqual({
    minify: true,
    encodeBytecode: true,
  })
})

test('declines a changed byte loop, payload or boot connection atomically', () => {
  for (const damage of [
    (ast) => {
      ast.program.body.at(-2).update.operator = '--'
    },
    (ast) => {
      ast.program.body.at(-2).init.declarations[1].init.arguments[0].value =
        '*bad'
    },
    (ast) => {
      ast.program.body.at(-1).expression.arguments[0].arguments[0].name =
        ast.program.body.at(-2).init.declarations[1].id.name
    },
  ]) {
    const ast = parse(encoded, { sourceType: 'script' })
    damage(ast)
    const changed = generate(ast).code
    expect(changed).not.toBe(encoded)
    expect(diagnoseContainer(changed).ok).toBe(false)
    expect(diagnoseStandalone(changed)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'container-declined' },
    })
  }
})
