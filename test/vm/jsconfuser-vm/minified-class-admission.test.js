import fs from 'node:fs'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { diagnoseReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { diagnoseMinifiedClassRuntime } from '../../../src/vm/jsconfuser-vm/observe-minified-class-runtime.js'
import { diagnoseMinifiedClassBoot } from '../../../src/vm/jsconfuser-vm/observe-minified-class-boot.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import { expectConsistentState } from '../../helper.js'
import {
  parseSuccessfulOutput,
  assertDerivedStateConsistency,
  assertNoVmResidue,
} from './integration/harness.js'

const sourceAt = (kind, seed) =>
  fs.readFileSync(
    new URL(
      `fixtures/${kind === 'arithmetic' ? 'minified-class-boot' : `minified-class-runtime/${kind}`}/encoded-${seed}.js`,
      import.meta.url,
    ),
    'utf8',
  )
const select = (ast, type, predicate) => {
  let selected
  traverse(ast, {
    [type](path) {
      if (!selected && predicate(path)) selected = path
    },
  })
  expect(selected, `${type} selector reaches source`).toBeDefined()
  return selected
}
function damaged(source, change) {
  const ast = parse(source, { sourceType: 'script' })
  change(ast)
  return generate(ast).code
}
function expectPublicDecline(source, code) {
  expect(decodeJsconfuserVm(source)).toMatchObject({
    ok: false,
    result: null,
    output: source,
    diagnostic: { code },
  })
}

for (const kind of ['arithmetic', 'exceptions', 'nested-strings'])
  for (const seed of [169, 170, 171]) {
    test(`${kind}/${seed}: complete-only A, B and public source with consistent state`, () => {
      const source = sourceAt(kind, seed),
        ast = parse(source, { sourceType: 'script' })
      traverse(ast, {})
      expectConsistentState(ast, source, { sourceType: 'script' })
      const before = JSON.stringify(ast),
        graph = diagnoseMinifiedClassRuntime(ast),
        a = diagnoseContainer(ast)
      expect(graph.ok).toBe(true)
      expect(a.ok, JSON.stringify(a.diagnostic)).toBe(true)
      expect(a.result.roles.words.values).toEqual(graph.result.boot.words)
      expect(a.result.roles.pool.values).toEqual(graph.result.boot.pool)
      expect(a.result.roles.scalars.MAIN_REG_COUNT.value).toBe(
        graph.result.boot.root.regCount,
      )
      expect(JSON.stringify(ast)).toBe(before)
      expectConsistentState(ast, source, { sourceType: 'script' })
      const b = diagnoseWordcode(a.result)
      expect(b.ok).toBe(true)
      expect(b.result.consumedWords).toBe(graph.result.boot.words.length)
      const result = decodeJsconfuserVm(source)
      expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
      expect(result.output).not.toBe(source)
      expect(result.output).toBe(result.result.output)
      expect(result.result.proof).toMatchObject({
        noTargetExecution: true,
        freshJavaScriptEmission: true,
        freshSimplificationState: true,
        finalParseValidated: true,
        finalResidueValidated: true,
      })
      const outputAst = parseSuccessfulOutput(result.output)
      expect(assertNoVmResidue(outputAst).ok).toBe(true)
      expect(assertDerivedStateConsistency(outputAst, result.output).ok).toBe(
        true,
      )
      expect(Object.isFrozen(a.result.roles.pool.values)).toBe(true)
      expect(Object.isFrozen(result)).toBe(true)
    })
  }

for (const seed of [169, 170, 171]) {
  test(`${seed}: changed ADD reaches named A refusal after bounded boot success`, () => {
    const source = sourceAt('arithmetic', seed)
    const changed = damaged(source, (ast) => {
      const handler = select(
        ast,
        'SwitchCase',
        (path) => path.node.test?.value === 11,
      )
      let operator
      handler.traverse({
        BinaryExpression(path) {
          if (path.node.operator === '+') operator = path
        },
      })
      expect(operator).toBeDefined()
      operator.node.operator = '-'
    })
    expect(diagnoseMinifiedClassBoot(changed).ok).toBe(true)
    const expected = {
      code: 'minified-class-handler',
      message: 'ADD: complete handler body or connection changed',
    }
    expect(diagnoseContainer(changed)).toEqual({
      ok: false,
      result: null,
      diagnostic: expected,
    })
    expect(diagnoseContainer(changed).diagnostic).not.toEqual({
      ...expected,
      message: 'SUB: complete handler body or connection changed',
    })
    expectPublicDecline(changed, 'container-declined')
  })
  test(`${seed}: catch state reaches named complete-entry refusal`, () => {
    const source = sourceAt('exceptions', seed)
    const changed = damaged(source, (ast) => {
      const clause = select(ast, 'CatchClause', () => true)
      let slot
      clause.traverse({
        NumericLiteral(path) {
          if (!slot && path.node.value === 5) slot = path
        },
      })
      expect(slot).toBeDefined()
      slot.node.value = 6
    })
    expect(diagnoseMinifiedClassBoot(changed).ok).toBe(true)
    expect(diagnoseContainer(changed)).toEqual({
      ok: false,
      result: null,
      diagnostic: {
        code: 'minified-class-entry',
        message: 'Complete entry/dispatch/exception/completion effects changed',
      },
    })
    expectPublicDecline(changed, 'container-declined')
  })
}

test('payload source damage passes A before exact B/C refusals', () => {
  const source = sourceAt('exceptions', 169),
    a = diagnoseContainer(source).result,
    words = a.roles.words.values
  const changeWords = (change) =>
    damaged(source, (ast) => {
      const array = select(
        ast,
        'ArrayExpression',
        (path) =>
          path.node.elements.length === words.length &&
          path.node.elements.every((item, i) => item.value === words[i]),
      )
      change(array.node.elements)
    })
  const unknown = changeWords((elements) => {
    elements[0].value = 0xffffffff
  })
  const unknownA = diagnoseContainer(unknown)
  expect(unknownA.ok).toBe(true)
  expect(diagnoseWordcode(unknownA.result).diagnostic).toEqual({
    code: 'unknown-opcode',
    message: 'Unknown opcode 4294967295 at pc 0',
  })
  expectPublicDecline(unknown, 'wordcode-declined')
  const truncated = changeWords((elements) => {
    elements.pop()
  })
  expect(diagnoseContainer(truncated).ok).toBe(true)
  expect(
    diagnoseWordcode(diagnoseContainer(truncated).result).diagnostic,
  ).toEqual({
    code: 'truncated-instruction',
    message: 'RETURN at 177 is missing a operand',
  })
  expectPublicDecline(truncated, 'wordcode-declined')
  const b = diagnoseWordcode(a).result,
    branch = b.instructions.find((item) => item.name === 'JUMP_IF_FALSE')
  expect(branch).toBeDefined()
  const badTarget = changeWords((elements) => {
    elements[branch.pc + 2].value = branch.pc + 1
  })
  const cA = diagnoseContainer(badTarget),
    cB = diagnoseWordcode(cA.result)
  expect(cA.ok).toBe(true)
  expect(cB.ok).toBe(true)
  expect(diagnoseReferences(cA.result, cB.result).diagnostic).toEqual({
    code: 'invalid-label-reference',
    message: 'JUMP_IF_FALSE@87 targets non-boundary pc 88',
  })
  expectPublicDecline(badTarget, 'references-declined')
})

function firstWithin(path, type, predicate = () => true) {
  let selected
  path.traverse({
    [type](candidate) {
      if (!selected && predicate(candidate.node)) selected = candidate
    },
  })
  expect(selected, `${type} mutation reaches selected role`).toBeDefined()
  return selected
}
function setup(seed) {
  const source = sourceAt('arithmetic', seed),
    graph = diagnoseMinifiedClassRuntime(source).result
  const ast = parse(source),
    functions = []
  traverse(ast, {
    Function(path) {
      functions.push(path)
    },
  })
  return {
    source,
    graph,
    ast,
    handler: (opcode) =>
      select(ast, 'SwitchCase', (path) => path.node.test?.value === opcode),
    owned(role) {
      const info = graph.functions.find((item) => item.role === role)
      const path = functions.find((path) =>
        info.kind === 'method'
          ? path.parentPath.isAssignmentExpression() &&
            path.parentPath.node.left.property.name === info.name
          : path.node.id?.name === info.name,
      )
      expect(path, `owned ${role} selected by complete graph`).toBeDefined()
      return path
    },
  }
}
function completeRefusal(state, code, message) {
  expect(diagnoseContainer(state.source).ok).toBe(true)
  const source = generate(state.ast).code
  expect(diagnoseMinifiedClassBoot(source).ok).toBe(true)
  const result = diagnoseContainer(source)
  expect(result).toEqual({
    ok: false,
    result: null,
    diagnostic: { code, message },
  })
  expect(result.diagnostic).not.toEqual({
    code,
    message: `${message} wrong control`,
  })
  expectPublicDecline(source, 'container-declined')
}
for (const seed of [169, 170, 171]) {
  test(`${seed}: value-list, closure-shell and finalizer damage reach normal A`, () => {
    let state = setup(seed)
    const call = firstWithin(
      state.handler(9),
      'CallExpression',
      (node) => node.callee.property?.name === 'set',
    )
    const args = call.node.arguments
    call.node.arguments = [
      { type: 'SequenceExpression', expressions: args.slice(0, 2) },
      ...args.slice(2),
    ]
    completeRefusal(
      state,
      'minified-class-handler',
      'SET_PROP: complete handler body or connection changed',
    )
    state = setup(seed)
    firstWithin(state.handler(47), 'ThisExpression').replaceWith({
      type: 'NullLiteral',
    })
    completeRefusal(
      state,
      'minified-class-handler',
      'MAKE_CLOSURE: complete handler body or connection changed',
    )
    state = setup(seed)
    firstWithin(state.handler(59), 'ObjectProperty').node.key.name =
      'changedRecordField'
    completeRefusal(
      state,
      'minified-class-entry',
      'Complete entry/dispatch/exception/completion effects changed',
    )
  })
  test(`${seed}: fixed-field collision refuses while legal whole-field alpha passes`, () => {
    const rename = (state, replacement) => {
      const field = state.graph.fields.descriptorField
      let count = 0
      traverse(state.ast, {
        MemberExpression(path) {
          if (!path.node.computed && path.node.property.name === field) {
            path.node.property.name = replacement
            count++
          }
        },
        ObjectProperty(path) {
          if (!path.node.computed && path.node.key.name === field) {
            path.node.key.name = replacement
            count++
          }
        },
      })
      expect(count).toBeGreaterThan(0)
    }
    const legal = setup(seed)
    rename(legal, 'legalDescriptor')
    expect(diagnoseContainer(generate(legal.ast).code).ok).toBe(true)
    const collision = setup(seed)
    rename(collision, 'prototype')
    completeRefusal(
      collision,
      'minified-class-ownership',
      'Renamed field overlaps fixed semantic member',
    )
  })
  for (const role of ['Upvalue', 'closeFrame'])
    test(`${seed}: ${role} extra effect reaches normal A owned-body refusal`, () => {
      const state = setup(seed)
      state
        .owned(role)
        .node.body.body.push(parse('opaqueEffect()').program.body[0])
      completeRefusal(
        state,
        'minified-class-functions',
        `${role}: complete owned body is missing or changed`,
      )
    })
}
