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
} from '../support/harness.js'
import { inputPath } from '../support/cells.js'
import { scriptTimeout } from '../../../helper.js'

// An input cell's encoded program, named `<source>/<profile>/<seed>`.
const encodedInput = (name) => {
  const [source, profile, seed] = name.split('/')
  return fs.readFileSync(inputPath(source, profile, Number(seed)), 'utf8')
}

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
  'f-debugger-order/baseline/1',
  'constant-arithmetic/classObfuscation/1',
  'constant-arithmetic/classObfuscation+minify/169',
  'constant-arithmetic/randomizeOpcodes+classObfuscation/181',
  'constant-arithmetic/randomizeOpcodes+classObfuscation+minify/191',
])('%s: deleting DEBUGGER leaves the same complete recovered output', (name) => {
  const source = encodedInput(name)
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
  const record = decodeVm(encodedInput('f-debugger-order/baseline/1'))
  expect(record.ok).toBe(true)
  expect(counts(record.output)).toEqual({
    debugger: 0,
    noOp: 0,
    dispatchSwitch: 0,
  })
  const window = {}
  vm.runInNewContext(record.output, { window }, { timeout: scriptTimeout })
  expect(Array.from(window.TEST_OUTPUT)).toEqual(['before', 'after'])
})
