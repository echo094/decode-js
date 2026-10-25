import fs from 'node:fs'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { test, expect } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import { expectConsistentState } from '../../helper.js'
import {
  assertNoVmResidue,
  assertDerivedStateConsistency,
  parseSuccessfulOutput,
} from './integration/harness.js'

const sourceAt = (name) =>
  fs.readFileSync(
    new URL(`fixtures/randomized-class/${name}.js`, import.meta.url),
    'utf8',
  )
// Canonical word meaning: readWordcode's instruction names and operands, the spread sentinel by
// kind only.
function meaningOf(container) {
  return diagnoseWordcode(container).result.instructions.map(
    ({ name, operands }) => ({
      name,
      operands: operands.map((operand) =>
        operand.kind === 'spread-sentinel' ? { kind: operand.kind } : operand,
      ),
    }),
  )
}
for (const kind of ['arithmetic', 'spread', 'exceptionRoutes'])
  for (const seed of [191, 192, 193])
    test(`${kind}/${seed}: randomized minified canonical meaning and actual recovery`, () => {
      const source = sourceAt(`${kind}-minified-${seed}`),
        ast = parse(source)
      traverse(ast, {})
      const before = JSON.stringify(ast)
      const A = diagnoseContainer(ast),
        baseline = diagnoseContainer(sourceAt(`${kind}.baseline`))
      expect(A.ok, JSON.stringify(A.diagnostic)).toBe(true)
      expect(meaningOf(A.result)).toEqual(meaningOf(baseline.result))
      expect(A.result.roles.pool.values).toEqual(
        baseline.result.roles.pool.values,
      )
      expect(diagnoseWordcode(A.result).result.consumedWords).toBe(
        A.result.roles.words.values.length,
      )
      expect(JSON.stringify(ast)).toBe(before)
      expectConsistentState(ast, source, { sourceType: 'script' })
      const result = decodeJsconfuserVm(source)
      expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
      expect(result.output).not.toBe(source)
      expect(result.result.finalJavaScriptSemantics).toBe(false)
      expect(result.result.proof).toMatchObject({
        freshJavaScriptEmission: true,
        freshSimplificationState: true,
        finalParseValidated: true,
        finalResidueValidated: true,
      })
      const output = parseSuccessfulOutput(result.output)
      expect(assertNoVmResidue(output).ok).toBe(true)
      expect(assertDerivedStateConsistency(output, result.output).ok).toBe(true)
    })
function damaged(seed, recipe) {
  const ast = parse(sourceAt(`arithmetic-minified-${seed}`))
  let dispatch
  traverse(ast, {
    SwitchStatement(path) {
      dispatch = path
    },
  })
  recipe({ ast, dispatch })
  return generate(ast).code
}
for (const seed of [191, 192, 193]) {
  test(`${seed}: alpha bindings and case order admit`, () => {
    const source = damaged(seed, ({ ast, dispatch }) => {
      dispatch.node.cases.reverse()
      traverse(ast, {
        Program(p) {
          for (const name of Object.keys(p.scope.bindings))
            p.scope.rename(name, `renamed_${name}`)
        },
      })
    })
    expect(diagnoseContainer(source).ok).toBe(true)
  })
}

// Consistent full remapping: every case label and every instruction-boundary
// opcode word move together. Closure folds the disabled-timing branch, so the
// minified source has no other owned opcode use to remap.
for (const seed of [191, 192, 193])
  test(`${seed}: consistent full remapping admits identical canonical meaning`, () => {
    const original = diagnoseContainer(sourceAt(`arithmetic-minified-${seed}`))
    expect(original.ok).toBe(true)
    const B = diagnoseWordcode(original.result)
    expect(B.ok).toBe(true)
    const words = original.result.roles.words.values
    const source = damaged(seed, ({ ast, dispatch }) => {
      const remap = new Map(
        dispatch.node.cases
          .filter((item) => item.test)
          .map(({ test }) => [test.value, (test.value + 1) % 65536]),
      )
      for (const item of dispatch.node.cases)
        if (item.test) item.test.value = remap.get(item.test.value)
      const arrays = []
      traverse(ast, {
        ArrayExpression(p) {
          const { elements } = p.node
          if (
            elements.length === words.length &&
            elements.every((element) => element?.type === 'NumericLiteral')
          )
            arrays.push(elements)
        },
      })
      expect(arrays).toHaveLength(1)
      for (const { pc } of B.result.instructions) {
        expect(remap.has(arrays[0][pc].value)).toBe(true)
        arrays[0][pc].value = remap.get(arrays[0][pc].value)
      }
    })
    const A = diagnoseContainer(source)
    expect(A.ok, JSON.stringify(A.diagnostic)).toBe(true)
    expect(meaningOf(A.result)).toEqual(meaningOf(original.result))
    const result = decodeJsconfuserVm(source)
    expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
    expect(result.output).not.toBe(source)
  })
