import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { materializeHandlerTable } from '../../../src/vm/jsconfuser-vm/materialize-handler-table.js'
import { diagnoseClassRuntime } from '../../../src/vm/jsconfuser-vm/analyze-class-runtime.js'
import { diagnoseAliasedRuntime } from '../../../src/vm/jsconfuser-vm/observe-aliased-runtime.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

const dir = new URL(
  'fixtures/class-handler-alias-stack-exceptions/',
  import.meta.url,
)
const source = fs.readFileSync(new URL('source.js', dir), 'utf8')
const encoded = fs.readFileSync(new URL('encoded.js', dir), 'utf8')
const record = JSON.parse(fs.readFileSync(new URL('qualification.json', dir)))

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test('decodes the eleven-effect class and handler-table stack', () => {
  const ast = materializeHandlerTable(parse(encoded, { sourceType: 'script' }))
  const classRuntime = diagnoseClassRuntime(ast)
  expect(classRuntime.ok).toBe(true)
  expect(classRuntime.result.root.opcodeCases).toBeGreaterThan(61)
  expect(classRuntime.result.pool.values.some((value) => value < 0)).toBe(true)
  expect(diagnoseContainer(encoded).ok).toBe(true)

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  const expected = observe(source)
  expect(observe(encoded)).toEqual(expected)
  expect(observe(decoded.result.output)).toEqual(expected)
  expect(record.status).toBe('accepted')
  expect(record.effectObservation.observed).toBe(true)
  expect(
    Object.values(record.effectObservation.components).every(Boolean),
  ).toBe(true)
})

test('declines a changed inlined numeric handler key', () => {
  const damaged = encoded.replace('VMPrototype[0] =', 'VMPrototype[999] =')
  expect(damaged).not.toBe(encoded)
  expect(diagnoseContainer(damaged)).toMatchObject({ ok: false, result: null })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'container-declined' },
  })
})

test('declines an altered class fake argument in an alias case', () => {
  const ast = materializeHandlerTable(parse(encoded, { sourceType: 'script' }))
  const container = diagnoseContainer(ast)
  expect(container.ok).toBe(true)
  const operand = container.result.roles.methods.vm.operand.name
  let changed = false
  traverse(ast, {
    SwitchCase(path) {
      if (path.node.test?.value !== 133) return
      path.traverse({
        CallExpression(call) {
          if (changed || call.node.callee?.property?.name !== operand) return
          call.node.arguments[0] = t.identifier('unknownRuntimeValue')
          changed = true
        },
      })
      path.stop()
    },
  })
  expect(changed).toBe(true)
  expect(diagnoseAliasedRuntime(ast)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'alias-runtime' },
  })
  expect(diagnoseStandalone(generate(ast).code)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})

test('declines a changed concealed-constant reader', () => {
  const damaged = encoded.replace('0x9e3779b9', '0x9e3779b8')
  expect(damaged).not.toBe(encoded)
  const ast = materializeHandlerTable(parse(damaged, { sourceType: 'script' }))
  expect(diagnoseClassRuntime(ast)).toMatchObject({
    ok: false,
    diagnostic: {
      code: 'class-runtime-methods',
      message: expect.stringContaining('_constant'),
    },
  })
  expect(diagnoseContainer(ast)).toMatchObject({ ok: false, result: null })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'container-declined' },
  })
})
