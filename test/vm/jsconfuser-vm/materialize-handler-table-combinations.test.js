import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { materializeHandlerTable } from '../../../src/vm/jsconfuser-vm/materialize-handler-table.js'
import { diagnoseAliasedRuntime } from '../../../src/vm/jsconfuser-vm/observe-aliased-runtime.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

function fixture(name, file) {
  return fs.readFileSync(
    new URL(`fixtures/${name}/${file}`, import.meta.url),
    'utf8',
  )
}

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

const tenOptions = [
  'stringConcealing',
  'controlFlowFlattening',
  'dispatcher',
  'concealConstants',
  'antiInstrumentation',
  'specializedOpcodes',
  'macroOpcodes',
  'aliasedOpcodes',
  'shuffleOpcodes',
  'handlerTable',
]

test.each([
  ['alias-handler-table-exceptions', ['aliasedOpcodes', 'handlerTable']],
  ['handler-table-alias-stack-exceptions', tenOptions],
])(
  'materializes and decodes %s',
  (name, options) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const record = JSON.parse(fixture(name, 'qualification.json'))
    const ast = parse(encoded, { sourceType: 'script' })
    const originalBodyLength = ast.program.body.length
    const materialized = materializeHandlerTable(ast)
    expect(ast.program.body).toHaveLength(originalBodyLength)
    expect(diagnoseContainer(materialized).ok).toBe(true)
    expect(diagnoseContainer(encoded).ok).toBe(true)
    const dispatches = []
    traverse(materialized, {
      SwitchStatement(path) {
        if (path.node.cases.some(({ test }) => test?.type === 'NumericLiteral'))
          dispatches.push(path.node)
      },
    })
    expect(dispatches).toHaveLength(1)
    const numericCases = dispatches[0].cases.filter(
      ({ test }) => test?.type === 'NumericLiteral',
    )
    expect(numericCases.length).toBeGreaterThan(0)
    const firstName =
      numericCases[0].consequent[0].body[0].declarations?.[0]?.id?.name
    expect(['fp', 'regs', 'base']).not.toContain(firstName)

    const decoded = diagnoseStandalone(encoded)
    expect(decoded.ok).toBe(true)
    const output = parseSuccessfulOutput(decoded.result.output)
    expect(assertNoVmResidue(output).ok).toBe(true)
    expect(
      assertDerivedStateConsistency(output, decoded.result.output).ok,
    ).toBe(true)
    const expected = observe(source)
    expect(observe(encoded)).toEqual(expected)
    expect(observe(decoded.result.output)).toEqual(expected)
    expect(record.status).toBe('accepted')
    expect(record.effectObservation.observed).toBe(true)
    for (const option of options)
      expect(record.effectObservation.components[option]).toBe(true)
  },
)

test('declines a missing numeric handler in the lifted table', () => {
  const encoded = fixture('alias-handler-table-exceptions', 'encoded.js')
  const damaged = encoded.replace('VMPrototype[61] =', 'VMPrototype[999] =')
  expect(damaged).not.toBe(encoded)
  expect(diagnoseContainer(damaged)).toMatchObject({ ok: false, result: null })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'container-declined' },
  })
})

test('declines a changed alias body after table materialization', () => {
  const encoded = fixture('alias-handler-table-exceptions', 'encoded.js')
  const damaged = encoded.replace(
    'regs[base + dst] = this._constant(_operands[1], _operands[2]);',
    'regs[base + dst] = this._constant(_operands[1], _operands[2]) + 1;',
  )
  expect(damaged).not.toBe(encoded)
  expect(diagnoseContainer(damaged).ok).toBe(true)
  const materialized = materializeHandlerTable(
    parse(damaged, { sourceType: 'script' }),
  )
  expect(diagnoseAliasedRuntime(materialized)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'alias-runtime' },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})
