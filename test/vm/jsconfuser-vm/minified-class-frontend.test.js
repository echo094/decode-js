import fs from 'node:fs'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { expectConsistentState } from '../../helper.js'
import { makeContext } from '../../../src/vm/jsconfuser-vm/container-role-helpers.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseMinifiedClassRuntime } from '../../../src/vm/jsconfuser-vm/observe-minified-class-runtime.js'
import { diagnoseMinifiedClassBoot } from '../../../src/vm/jsconfuser-vm/observe-minified-class-boot.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'

const directory = new URL('fixtures/minified-class-frontend/', import.meta.url)
const provenance = JSON.parse(
  fs.readFileSync(new URL('provenance.json', directory), 'utf8'),
)
const read = (seed, kind = 'arithmetic') =>
  fs.readFileSync(
    new URL(`${kind}--minifyClassObfuscation--${seed}.js`, directory),
    'utf8',
  )
function setup(seed) {
  const source = read(seed),
    ast = parse(source),
    context = makeContext(ast)
  const baseline = diagnoseMinifiedClassRuntime(ast)
  expect(baseline.ok).toBe(true)
  const role = (name) => {
    const record = baseline.result.functions.find(
      (record) => record.role === name,
    )
    expect(record).toBeDefined()
    const candidates = context
      .nodes(context.program)
      .filter(({ node, path }) =>
        record.kind === 'helper'
          ? node.type === 'FunctionDeclaration' && node.id.name === record.name
          : node.type === 'FunctionExpression' &&
            path.parentPath.node.left?.property?.name === record.name,
      )
    expect(candidates).toHaveLength(1)
    return candidates[0].node
  }
  return { source, ast, context, baseline, role }
}
function first(state, fn, predicate) {
  const item = state.context.nodes(fn).find(({ node }) => predicate(node))
  expect(item, 'mutation reaches its owned source role').toBeDefined()
  return item.node
}
function refuse(seed, change, code, message) {
  const state = setup(seed)
  change(state)
  const source = generate(state.ast).code
  const result = diagnoseMinifiedClassRuntime(source)
  expect(result).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code, message },
  })
  expect(diagnoseContainer(source).ok).toBe(false)
  expect(decodeJsconfuserVm(source)).toMatchObject({
    ok: false,
    result: null,
    output: source,
  })
}

test('local frozen parser fixtures retain config/seed/pin records', () => {
  expect(provenance.encoderPin).toBe('20c5b96bf57337c568579352758d7685358650de')
  for (const record of provenance.records) {
    expect(record.options.minify).toBe(
      ['minify', 'minifyClassObfuscation'].includes(record.profile),
    )
    expect(record.options.classObfuscation).toBe(
      ['classObfuscation', 'minifyClassObfuscation'].includes(record.profile),
    )
  }
})
for (const seed of [172, 173, 174]) {
  test(`${seed}: complete public A retains exact payload and bounded proof`, () => {
    const source = read(seed),
      graph = diagnoseMinifiedClassRuntime(source),
      a = diagnoseContainer(source)
    expect(graph.ok).toBe(true)
    expect(a.ok).toBe(true)
    expect(a.result.roles.words.values).toEqual(graph.result.boot.words)
    expect(a.result.roles.pool.values).toEqual(graph.result.boot.pool)
    expect(graph.result.proof).toMatchObject({
      publicAdmission: false,
      nativeEquivalence: false,
    })
    expect(diagnoseMinifiedClassBoot(source).result.completeHandlers).not.toBe(
      true,
    )
  })
  test(`${seed}: mandatory exception input reaches structured shared N output`, () => {
    const source = read(seed, 'exceptionRoutes')
    expect(diagnoseContainer(source).ok).toBe(true)
    const result = decodeJsconfuserVm(source)
    expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
    expect(result.output).not.toBe(source)
    expect(result.output).toContain('catch (__recovered_error)')
    expect(result.output).toContain('} finally {')
    expect(result.output).not.toMatch(/__recovered_(?:dispatch|pc|handlers)/)
    expect(result.result.proof).toMatchObject({
      freshJavaScriptEmission: true,
      finalParseValidated: true,
      finalResidueValidated: true,
    })
    const outputAst = parse(result.output)
    traverse(outputAst, {})
    expectConsistentState(outputAst, result.output)
  })
  test(`${seed}: lexical alpha and missing offsets preserve complete ownership`, () => {
    const ast = parse(read(seed))
    let count = 0
    traverse(ast, {
      Scopable(path) {
        for (const name of Object.keys(path.scope.bindings))
          path.scope.rename(name, `renamed_${count++}`)
      },
      enter(path) {
        delete path.node.start
        delete path.node.end
      },
    })
    expect(diagnoseMinifiedClassRuntime(ast).ok).toBe(true)
  })
}

test('172: close method body damage reaches closeFrame connection refusal', () =>
  refuse(
    172,
    (state) => {
      first(
        state,
        state.role('closeUpvalue'),
        (node) => node.type === 'AssignmentExpression',
      ).right = { type: 'NumericLiteral', value: 0 }
    },
    'minified-class-functions',
    'closeFrame: complete owned body is missing or changed',
  ))
test('172: close method fake actual cannot execute', () =>
  refuse(
    172,
    (state) => {
      first(
        state,
        state.role('closeFrame'),
        (node) => node.type === 'CallExpression',
      ).arguments[0] = {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'unprovedEffect' },
        arguments: [],
      }
    },
    'minified-class-functions',
    'closeFrame: complete owned body is missing or changed',
  ))
test('172: close method must belong to the Upvalue constructor', () =>
  refuse(
    172,
    (state) => {
      const fn = state.role('closeUpvalue'),
        definition = state.context.paths.get(fn).parentPath.node
      definition.left.object.object = state.role('VM').id
    },
    'minified-class-ownership',
    'Method is attached to a different constructor',
  ))
test('173: operand dummy field cannot overwrite a live pool', () =>
  refuse(
    173,
    (state) => {
      first(
        state,
        state.role('operand'),
        (node) => node.type === 'AssignmentExpression',
      ).left.property.name = state.baseline.result.boot.fields.pool
    },
    'incomplete-role',
    'LOAD_CONST operand reader has unsupported VM field effects',
  ))
test('173: dummy actual cannot execute before operand consumption', () =>
  refuse(
    173,
    (state) => {
      const fn = state.role('operand'),
        binding = state.context.bindingFor(fn.id)
      first(
        state,
        state.role('run'),
        (node) =>
          node.type === 'CallExpression' &&
          state.context.bindingFor(node.callee) === binding,
      ).arguments[1] = {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'unprovedEffect' },
        arguments: [],
      }
    },
    'incomplete-role',
    'LOAD_CONST reader uses a different VM receiver',
  ))
test('173: actual receiver position survives dummy parameter permutation', () => {
  const state = setup(173),
    fn = state.role('operand'),
    binding = state.context.bindingFor(fn.id)
  for (const { node } of state.context.nodes(state.context.program))
    if (
      node.type === 'CallExpression' &&
      state.context.bindingFor(node.callee) === binding
    )
      node.arguments = [
        node.arguments[1] ?? {
          type: 'UnaryExpression',
          operator: 'void',
          prefix: true,
          argument: { type: 'NumericLiteral', value: 0 },
        },
        node.arguments[0],
      ]
  fn.params.reverse()
  expect(diagnoseMinifiedClassRuntime(generate(state.ast).code).ok).toBe(true)
})
test('174: selected method dummy array cannot collide with a live word field', () =>
  refuse(
    174,
    (state) => {
      first(
        state,
        state.role('constant'),
        (node) =>
          node.type === 'AssignmentExpression' &&
          node.left.type === 'MemberExpression',
      ).left.property.name = state.baseline.result.boot.fields.words
    },
    'incomplete-role',
    'LOAD_CONST constant reader has unsupported VM field effects',
  ))
test('174: selected method prelude rejects an unknown call', () =>
  refuse(
    174,
    (state) => {
      state
        .role('run')
        .body.body.unshift(
          parse('globalThis.unprovedEffect();').program.body[0],
        )
    },
    'incomplete-role',
    'LOAD_CONST dispatch effects are outside the closed entry shape',
  ))
test('174: separate byte buffer must decode the proved pool value', () =>
  refuse(
    174,
    (state) => {
      const constant = state.role('constant'),
        bytes = state.role('bytes'),
        binding = state.context.bindingFor(bytes.id)
      first(
        state,
        constant,
        (node) =>
          node.type === 'CallExpression' &&
          state.context.bindingFor(node.callee) === binding,
      ).arguments[0] = constant.params.at(-1)
    },
    'incomplete-role',
    'LOAD_CONST constant reader body does not implement observed pool decoding',
  ))

test('174: loop counter cannot overwrite the still-live separate byte buffer', () =>
  refuse(
    174,
    (state) => {
      const constant = state.role('constant')
      const loop = first(
        state,
        constant,
        (node) => node.type === 'ForStatement',
      )
      const counter = state.context.bindingFor(loop.init.left)
      const bytes = state.role('bytes')
      const byteCall = first(
        state,
        constant,
        (node) =>
          node.type === 'CallExpression' &&
          state.context.bindingFor(node.callee) ===
            state.context.bindingFor(bytes.id),
      )
      const buffer = state.context.paths.get(byteCall).parentPath.node.left
      expect(counter).toBeDefined()
      expect(buffer.type).toBe('Identifier')
      for (const { node } of state.context.nodes(loop))
        if (
          node.type === 'Identifier' &&
          state.context.bindingFor(node) === counter
        )
          node.name = buffer.name
    },
    'incomplete-role',
    'LOAD_CONST constant reader bindings alias incompatible roles',
  ))
