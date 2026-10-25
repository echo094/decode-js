import fs from 'node:fs'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { diagnoseReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
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
    test(`${kind}/${seed}: A, B and public source with consistent state`, () => {
      const source = sourceAt(kind, seed),
        ast = parse(source, { sourceType: 'script' })
      traverse(ast, {})
      expectConsistentState(ast, source, { sourceType: 'script' })
      const before = JSON.stringify(ast),
        a = diagnoseContainer(ast)
      expect(a.ok, JSON.stringify(a.diagnostic)).toBe(true)
      expect(JSON.stringify(ast)).toBe(before)
      expectConsistentState(ast, source, { sourceType: 'script' })
      const b = diagnoseWordcode(a.result)
      expect(b.ok).toBe(true)
      expect(b.result.consumedWords).toBe(a.result.roles.words.values.length)
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
