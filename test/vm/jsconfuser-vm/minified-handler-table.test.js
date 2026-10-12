import fs from 'node:fs'
import vm from 'node:vm'
import generate from '@babel/generator'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  diagnoseMinifiedHandlerTable,
  diagnoseMinifiedRuntime,
} from '../../../src/vm/jsconfuser-vm/observe-minified-runtime.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

function fixture(file) {
  return fs.readFileSync(
    new URL(
      `fixtures/minified-handler-table-exceptions/${file}`,
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

test('proves the minified numeric handler table and decodes its wordcode', () => {
  expect(diagnoseMinifiedRuntime(encoded).ok).toBe(false)
  const observed = diagnoseMinifiedHandlerTable(encoded)
  expect(observed.ok).toBe(true)
  expect(observed.result.words.length).toBeGreaterThan(0)
  expect(diagnoseContainer(encoded).ok).toBe(true)

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
    handlerTable: true,
  })
})

test('accepts consistent minifier binding renaming', () => {
  const ast = parse(encoded, { sourceType: 'script' })
  const alias = ast.program.body.find(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.declarations[0]?.init?.type === 'MemberExpression' &&
      statement.declarations[0].init.property.name === 'prototype',
  ).declarations[0].id.name
  traverse(ast, {
    Program(path) {
      path.scope.rename(alias, 'RenamedHandlerPrototype')
    },
  })
  expect(diagnoseMinifiedHandlerTable(generate(ast).code).ok).toBe(true)
})

test('declines changed handler keys, bodies and dispatch atomically', () => {
  for (const damage of [
    (ast) => {
      const handler = ast.program.body.find(
        (statement) =>
          statement.type === 'ExpressionStatement' &&
          statement.expression?.left?.computed &&
          statement.expression.left.property?.value === 0,
      ).expression
      handler.left.property.value = 61
    },
    (ast) => {
      const handler = ast.program.body.find(
        (statement) =>
          statement.type === 'ExpressionStatement' &&
          statement.expression?.left?.computed &&
          statement.expression.left.property?.value === 0,
      ).expression
      handler.right.body.body.push(t.emptyStatement())
    },
    (ast) => {
      const runName = ast.program.body.at(-1).expression.callee.name
      const run = ast.program.body.find(
        (statement) =>
          statement.type === 'FunctionDeclaration' &&
          statement.id.name === runName,
      )
      traverse(ast, {
        CallExpression(path) {
          const callee = path.node.callee
          if (
            path.findParent((parent) => parent.node === run) &&
            callee.type === 'MemberExpression' &&
            callee.computed &&
            callee.object.name === run.params[0].name &&
            path.node.arguments.length === 0
          ) {
            callee.property = t.binaryExpression(
              '+',
              callee.property,
              t.numericLiteral(1),
            )
            path.stop()
          }
        },
      })
    },
  ]) {
    const ast = parse(encoded, { sourceType: 'script' })
    damage(ast)
    const changed = generate(ast).code
    expect(diagnoseMinifiedHandlerTable(changed).ok).toBe(false)
    expect(diagnoseStandalone(changed)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'container-declined' },
    })
  }
})
