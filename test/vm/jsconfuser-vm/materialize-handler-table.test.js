import fs from 'node:fs'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { materializeHandlerTable } from '../../../src/vm/jsconfuser-vm/materialize-handler-table.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import generate from '@babel/generator'

const fixture = fs.readFileSync(
  new URL('fixtures/handler-table-boot/encoded.js', import.meta.url),
  'utf8',
)

function parsed() {
  return parse(fixture, {
    sourceType: 'script',
    allowReturnOutsideFunction: true,
  })
}

function handler(ast, role) {
  return ast.program.body.find((statement) => {
    const expression = statement.expression
    return (
      expression?.type === 'AssignmentExpression' &&
      expression.left?.object?.name === 'VMPrototype' &&
      expression.left.property?.property?.name === role
    )
  })
}

test('connects independently renamed handler frame aliases to the outer bindings', () => {
  const ast = parsed()
  const scopes = new Set()
  traverse(ast, {
    enter(path) {
      scopes.add(path.scope)
    },
  })
  let index = 0
  for (const scope of scopes) {
    for (const name of ['fp', 'regs', 'base']) {
      if (scope.hasOwnBinding(name))
        scope.rename(name, `frame_alias_${index++}`)
    }
  }
  const materialized = materializeHandlerTable(ast)
  expect(diagnoseContainer(materialized).ok).toBe(true)
  expect(diagnoseStandalone(generate(ast).code).ok).toBe(true)
})

test('materializes the pinned handler table without changing the input AST', () => {
  const ast = parsed()
  const bodyLength = ast.program.body.length
  const normalized = materializeHandlerTable(ast)
  expect(ast.program.body).toHaveLength(bodyLength)
  expect(handler(ast, 'ADD')).toBeDefined()
  expect(normalized.program.body).toHaveLength(bodyLength - 62)
  expect(diagnoseContainer(ast)).toMatchObject({
    ok: true,
    result: {
      schemaVersion: 'jsconfuser-vm-container.v1',
      encoding: 'numeric-u32',
      roles: { op: { values: { ADD: 11 } } },
    },
  })
})

test('declines missing, duplicate, or early-returning handlers atomically', () => {
  const missing = parsed()
  missing.program.body.splice(
    missing.program.body.indexOf(handler(missing, 'ADD')),
    1,
  )
  const duplicate = parsed()
  handler(duplicate, 'ADD').expression.left.property.property.name = 'SUB'
  const returning = parsed()
  handler(returning, 'ADD').expression.right.body.body.unshift({
    type: 'ReturnStatement',
    argument: null,
  })
  for (const ast of [missing, duplicate, returning]) {
    expect(() => materializeHandlerTable(ast)).toThrow()
    expect(diagnoseContainer(ast)).toMatchObject({ ok: false, result: null })
  }
})

test('declines a disconnected dynamic dispatch or injected frame local', () => {
  const disconnected = parsed()
  traverse(disconnected, {
    CallExpression(path) {
      if (
        path.node.callee?.object?.type !== 'ThisExpression' ||
        path.node.callee?.property?.name !== 'op'
      ) {
        return
      }
      path.node.callee.property.name = 'missingOpcode'
      path.stop()
    },
  })
  const injected = parsed()
  handler(
    injected,
    'ADD',
  ).expression.right.body.body[0].declarations[0].init.property.name = 'globals'
  const slot = parsed()
  handler(
    slot,
    'ADD',
  ).expression.right.body.body[1].declarations[0].init.property.right.object.name =
    'OTHER_SLOTS'
  for (const ast of [disconnected, injected, slot]) {
    expect(() => materializeHandlerTable(ast)).toThrow()
    expect(diagnoseContainer(ast)).toMatchObject({ ok: false, result: null })
  }
})
