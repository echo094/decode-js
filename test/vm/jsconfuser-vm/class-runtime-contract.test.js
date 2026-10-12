import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { expect, test } from 'vitest'
import { diagnoseClassRuntime } from '../../../src/vm/jsconfuser-vm/analyze-class-runtime.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { materializeHandlerTable } from '../../../src/vm/jsconfuser-vm/materialize-handler-table.js'
import { EXPECTED_OPCODES } from '../../../src/vm/jsconfuser-vm/container-role-helpers.js'

const fixture = fs.readFileSync(
  new URL('fixtures/class-runtime-boot/encoded.js', import.meta.url),
  'utf8',
)

function changedCase(opcode, change, input = fixture) {
  const ast = typeof input === 'string' ? parse(input) : input
  let changed = false
  traverse(ast, {
    SwitchCase(path) {
      if (path.node.test?.value !== opcode) return
      change(path)
      changed = true
      path.stop()
    },
  })
  expect(changed).toBe(true)
  return generate(ast).code
}

function assertDecline(source, code, role) {
  expect(diagnoseClassRuntime(source)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code, message: expect.stringContaining(role) },
  })
  expect(diagnoseContainer(source)).toMatchObject({ ok: false, result: null })
  expect(diagnoseStandalone(source)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'container-declined' },
  })
}

function replaceOne(path, predicate) {
  let changed = false
  path.traverse({
    enter(inner) {
      if (
        !changed &&
        (inner.node.type !== 'Identifier' || inner.isReferencedIdentifier()) &&
        predicate(inner.node)
      ) {
        inner.replaceWith(t.numericLiteral(0))
        changed = true
        inner.skip()
      }
    },
  })
  expect(changed).toBe(true)
}

test('rejects the ADD operand substitution that changes the published value', () => {
  const damaged = fixture.replace(
    '= a + regs[base + this.Q({}, 90)]',
    '= 0 + regs[base + this.Q({}, 90)]',
  )
  expect(damaged).not.toBe(fixture)
  const window = {}
  vm.runInNewContext(
    damaged,
    { window, Buffer, performance: { now: () => 0 } },
    { timeout: 1000 },
  )
  expect(window.TEST_OUTPUT).toBe(3)
  assertDecline(
    damaged,
    'class-runtime-opcodes',
    'Opcode 11: complete semantic contract',
  )
})

test.each(Object.entries(EXPECTED_OPCODES))(
  'rejects added side effects in the complete %s handler',
  (_, opcode) => {
    const damaged = changedCase(opcode, (path) => {
      const body =
        path.node.consequent[0]?.type === 'BlockStatement'
          ? path.node.consequent[0].body
          : path.node.consequent
      body.unshift(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(
              t.identifier('globalThis'),
              t.identifier('CONTRACT_DAMAGE'),
            ),
            t.booleanLiteral(true),
          ),
        ),
      )
    })
    assertDecline(
      damaged,
      'class-runtime-opcodes',
      `Opcode ${opcode}: complete semantic contract`,
    )
  },
)

test.each([
  [
    'load destination',
    0,
    (node) =>
      node.type === 'CallExpression' && node.callee?.property?.name === 'Q',
  ],
  [
    'global store value',
    6,
    (node) => node.type === 'MemberExpression' && node.object?.name === 'regs',
  ],
  [
    'binary source',
    11,
    (node) => node.type === 'Identifier' && node.name === 'a',
  ],
  [
    'exponent source',
    60,
    (node) => node.type === 'Identifier' && node.name === 'a',
  ],
  [
    'unary source',
    32,
    (node) =>
      node.type === 'MemberExpression' &&
      node.object?.name === 'regs' &&
      node.property?.right?.type === 'CallExpression',
  ],
  [
    'conditional source',
    40,
    (node) =>
      node.type === 'CallExpression' && node.callee?.property?.name === 'Q',
  ],
  [
    'call argument value',
    42,
    (node) =>
      node.type === 'MemberExpression' &&
      node.object?.name === 'regs' &&
      node.property?.right?.type === 'CallExpression',
  ],
  [
    'return source',
    45,
    (node) =>
      node.type === 'MemberExpression' &&
      node.object?.name === 'regs' &&
      node.property?.right?.type === 'CallExpression',
  ],
  [
    'array count',
    48,
    (node) => node.type === 'Identifier' && node.name === 'count',
  ],
  [
    'object pair value',
    49,
    (node) =>
      node.type === 'MemberExpression' &&
      node.object?.name === 'regs' &&
      node.property?.right?.type === 'CallExpression',
  ],
  [
    'iterator exit target',
    53,
    (node) => node.type === 'Identifier' && node.name === 'exitTarget',
  ],
  [
    'rewrite destination',
    56,
    (node) => node.type === 'Identifier' && node.name === 'destPc',
  ],
])('rejects changed %s provenance', (_, opcode, predicate) => {
  const damaged = changedCase(opcode, (path) => {
    replaceOne(path, predicate)
  })
  assertDecline(damaged, 'class-runtime-opcodes', `Opcode ${opcode}`)
})

test('rejects disconnected closure metadata', () => {
  const damaged = changedCase(47, (path) => {
    let changed = false
    path.traverse({
      ObjectProperty(inner) {
        if (inner.node.key.name !== 'M') return
        inner.node.value = t.identifier('paramCount')
        changed = true
        inner.stop()
      },
    })
    expect(changed).toBe(true)
  })
  assertDecline(damaged, 'class-runtime-opcodes', 'Opcode 47')
})

test.each([
  [
    'frame argument roles',
    'regs[fp + 2] = retDst;',
    'regs[fp + 2] = args;',
    'class-runtime-methods',
    '_pushFrame',
  ],
  [
    'upvalue close order',
    'this.v = this.U[this.N];\n  this.Y = true;',
    'this.Y = true;\n  this.v = this.U[this.N];',
    'class-runtime-methods',
    '_close',
  ],
  [
    'run return source',
    'if (!this.G) return this.U[0];',
    'if (!this.G) return this.U[1];',
    'class-runtime-methods',
    'run',
  ],
])('rejects changed %s', (_, before, after, code, role) => {
  const damaged = fixture.replace(before, after)
  expect(damaged).not.toBe(fixture)
  assertDecline(damaged, code, role)
})

test('rejects a changed root call argument and an added top-level effect', () => {
  const ast = parse(fixture)
  const root = ast.program.body.at(-1).expression
  root.arguments[root.arguments.length - 1] = t.arrayExpression([])
  assertDecline(generate(ast).code, 'class-runtime-boot', 'boot')
  assertDecline(
    `${fixture}\nglobalThis.CONTRACT_DAMAGE = true;`,
    'class-runtime-boot',
    'unaccounted top-level effect',
  )
})

test('rejects handler operand damage after class/table/alias materialization and renaming', () => {
  const source = fs.readFileSync(
    new URL(
      'fixtures/class-handler-alias-stack-exceptions/encoded.js',
      import.meta.url,
    ),
    'utf8',
  )
  const ast = materializeHandlerTable(parse(source))
  const scopes = new Set()
  traverse(ast, {
    enter(path) {
      scopes.add(path.scope)
    },
  })
  let index = 0
  for (const scope of scopes)
    for (const name of Object.keys(scope.bindings))
      scope.rename(name, `contract_binding_${index++}`)
  expect(diagnoseClassRuntime(ast).ok).toBe(true)
  const damaged = changedCase(
    11,
    (path) => {
      let changed = false
      path.traverse({
        BinaryExpression(inner) {
          if (
            inner.node.operator !== '+' ||
            inner.parent.type !== 'AssignmentExpression' ||
            inner.parent.right !== inner.node
          )
            return
          inner.node.left = t.numericLiteral(0)
          changed = true
          inner.stop()
        },
      })
      expect(changed).toBe(true)
    },
    ast,
  )
  assertDecline(
    damaged,
    'class-runtime-opcodes',
    'Opcode 11: complete semantic contract',
  )
}, 30000)

test('rejects a fake stash with prototype semantics', () => {
  const damaged = fixture.replace(
    'this.ad = fake_13;',
    'this.__proto__ = fake_13;',
  )
  expect(damaged).not.toBe(fixture)
  assertDecline(
    damaged,
    'class-runtime-methods',
    'VM: complete semantic contract',
  )
})

test('rejects a renamed constructor that captures a host builtin', () => {
  const ast = parse(fixture)
  traverse(ast, {
    Program(path) {
      path.scope.rename('VM', 'Reflect')
      path.stop()
    },
  })
  assertDecline(
    generate(ast).code,
    'class-runtime-opcodes',
    'Opcode 9: complete semantic contract',
  )
})

test('rejects a changed inherited closure capture value', () => {
  const damaged = changedCase(47, (path) => {
    let changed = false
    path.traverse({
      IfStatement(inner) {
        if (inner.node.test?.property?.name !== 'K') return
        inner.node.alternate.body[0].expression.arguments[0] =
          t.numericLiteral(0)
        changed = true
        inner.stop()
      },
    })
    expect(changed).toBe(true)
  })
  assertDecline(
    damaged,
    'class-runtime-opcodes',
    'Opcode 47: complete semantic contract',
  )
})

test('rejects an extra declaration initializer in a retained payload statement', () => {
  const damaged = fixture.replace(
    'var CONSTANTS = [',
    'var discarded = (window.CONTRACT_DAMAGE = true), CONSTANTS = [',
  )
  expect(damaged).not.toBe(fixture)
  assertDecline(damaged, 'class-runtime-boot', 'unaccounted declaration effect')
})

test('rejects an altered prototype installation operator', () => {
  const damaged = fixture.replace(
    'VM.prototype.Q = function',
    'VM.prototype.Q += function',
  )
  expect(damaged).not.toBe(fixture)
  assertDecline(
    damaged,
    'class-runtime-methods',
    '_operand: complete semantic contract',
  )
})

test('rejects a changed exception delivery frame', () => {
  const damaged = fixture.replace(
    'regs[hBase + h.f] = err;',
    'regs[handledFrame + h.f] = err;',
  )
  expect(damaged).not.toBe(fixture)
  assertDecline(
    damaged,
    'class-runtime-methods',
    'run: complete semantic contract',
  )
})

test.each(['async function decodeBytecode', 'function* decodeBytecode'])(
  'rejects a decoder that changes its return protocol: %s',
  (replacement) => {
    const damaged = fixture.replace('function decodeBytecode', replacement)
    expect(damaged).not.toBe(fixture)
    assertDecline(
      damaged,
      'class-runtime-boot',
      'numeric decoder is not synchronous',
    )
  },
)
