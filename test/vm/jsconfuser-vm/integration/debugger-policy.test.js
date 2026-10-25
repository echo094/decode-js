import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { expect, test } from 'vitest'
import decodeVm from '../../../../src/plugin/jsconfuser-vm.js'
import {
  assertNoVmResidue,
  assertDerivedStateConsistency,
  parseSuccessfulOutput,
} from './harness.js'

const fixture = (name) =>
  fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

function counts(source) {
  const result = { debugger: 0, noOp: 0, dispatchSwitch: 0 }
  traverse(parseSuccessfulOutput(source), {
    DebuggerStatement() {
      result.debugger++
    },
    ExpressionStatement(path) {
      if (
        path.node.expression.type === 'UnaryExpression' &&
        path.node.expression.operator === 'void'
      )
        result.noOp++
    },
    SwitchStatement() {
      result.dispatchSwitch++
    },
  })
  return result
}

test.each([
  'corpus/raw/f-debugger-order/encoded.js',
  'class-runtime-boot/encoded.js',
  'minified-class-boot/encoded-169.js',
  'randomized-class/arithmetic-181.js',
  'randomized-class/arithmetic-minified-191.js',
])('%s: deleting DEBUGGER leaves the same complete recovered output', (name) => {
  const source = fixture(name)
  const intact = decodeVm(source)
  expect(intact.ok, JSON.stringify(intact.diagnostic)).toBe(true)
  const ast = parse(source)
  let removed = 0
  traverse(ast, {
    DebuggerStatement(path) {
      removed++
      path.remove()
    },
  })
  expect(removed).toBe(1)
  const input = generate(ast).code
  const record = decodeVm(input)
  expect(record.ok, JSON.stringify(record.diagnostic)).toBe(true)
  expect(record.output).not.toBe(input)
  expect(record.output).toBe(intact.output)
  expect(counts(record.output)).toEqual({
    debugger: 0,
    noOp: 0,
    dispatchSwitch: 0,
  })
  const outputAst = parseSuccessfulOutput(record.output)
  expect(assertNoVmResidue(outputAst).ok).toBe(true)
  expect(assertDerivedStateConsistency(outputAst, record.output).ok).toBe(true)
})

test('DEBUGGER wordcode disappears while before/after effects retain their order', () => {
  const record = decodeVm(fixture('corpus/raw/f-debugger-order/encoded.js'))
  expect(record.ok).toBe(true)
  expect(counts(record.output)).toEqual({
    debugger: 0,
    noOp: 0,
    dispatchSwitch: 0,
  })
  const window = {}
  vm.runInNewContext(record.output, { window }, { timeout: 1000 })
  expect(Array.from(window.TEST_OUTPUT)).toEqual(['before', 'after'])
})
