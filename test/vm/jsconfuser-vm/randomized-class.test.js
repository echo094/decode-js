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
  parseSuccessfulOutput,
  assertNoVmResidue,
  assertDerivedStateConsistency,
} from './integration/harness.js'

// Canonical word meaning: B's instruction names and operands, the spread sentinel by kind only.
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

const sourceAt = (name) =>
  fs.readFileSync(
    new URL(`fixtures/randomized-class/${name}.js`, import.meta.url),
    'utf8',
  )
for (const kind of ['arithmetic', 'spread', 'exceptionRoutes'])
  for (const seed of [181, 182, 183])
    test(`${kind}/${seed}: canonical meaning and actual recovery`, () => {
      const source = sourceAt(`${kind}-${seed}`),
        ast = parse(source)
      traverse(ast, {})
      const before = JSON.stringify(ast)
      const A = diagnoseContainer(ast),
        baseline = diagnoseContainer(sourceAt(`${kind}.baseline`))
      expect(A.ok, JSON.stringify(A.diagnostic)).toBe(true)
      expect(JSON.stringify(ast)).toBe(before)
      expectConsistentState(ast, source, { sourceType: 'script' })
      expect(meaningOf(A.result)).toEqual(meaningOf(baseline.result))
      expect(A.result.roles.pool.values).toEqual(
        baseline.result.roles.pool.values,
      )
      const B = diagnoseWordcode(A.result)
      expect(B.ok).toBe(true)
      expect(B.result.consumedWords).toBe(A.result.roles.words.values.length)
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

function change(source, recipe) {
  const ast = parse(source)
  let dispatch
  traverse(ast, {
    SwitchStatement(path) {
      dispatch = path
    },
  })
  recipe({ ast, dispatch })
  return generate(ast).code
}
for (const seed of [181, 182, 183]) {
  const source = sourceAt(`arithmetic-${seed}`)
  test(`${seed}: case reordering and complete consistent mapping are structural`, () => {
    const reordered = change(source, ({ dispatch }) => {
      dispatch.node.cases.reverse()
    })
    expect(diagnoseContainer(reordered).ok).toBe(true)
    const alpha = change(source, ({ ast }) => {
      traverse(ast, {
        Program(path) {
          for (const name of Object.keys(path.scope.bindings))
            path.scope.rename(name, `renamed_${name}`)
        },
      })
    })
    expect(diagnoseContainer(alpha).ok).toBe(true)
  })
}

// Consistent full remapping: every case label, every instruction-boundary
// opcode word and the disabled-timing `op = JUMP` literal (the one numeric write of a label to
// the dispatch selector) move together.
function remapped(source) {
  const A = diagnoseContainer(source)
  expect(A.ok).toBe(true)
  const B = diagnoseWordcode(A.result)
  expect(B.ok).toBe(true)
  const words = A.result.roles.words.values
  return change(source, ({ ast, dispatch }) => {
    const remap = new Map(
      dispatch.node.cases
        .filter((item) => item.test)
        .map(({ test }) => [test.value, (test.value + 1) % 65536]),
    )
    const opcode = dispatch.scope.getBinding(dispatch.node.discriminant.name)
    let jumpUses = 0
    traverse(ast, {
      AssignmentExpression(path) {
        const { left, right } = path.node
        if (
          left.type === 'Identifier' &&
          path.scope.getBinding(left.name) === opcode &&
          right.type === 'NumericLiteral' &&
          remap.has(right.value)
        ) {
          jumpUses++
          right.value = remap.get(right.value)
        }
      },
    })
    expect(jumpUses).toBe(1)
    for (const item of dispatch.node.cases)
      if (item.test) item.test.value = remap.get(item.test.value)
    const arrays = []
    traverse(ast, {
      ArrayExpression(path) {
        const { elements } = path.node
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
}
for (const seed of [181, 182, 183])
  test(`${seed}: consistent full remapping admits identical canonical meaning`, () => {
    const source = sourceAt(`arithmetic-${seed}`)
    const original = meaningOf(diagnoseContainer(source).result)
    const shifted = remapped(source)
    const A = diagnoseContainer(shifted)
    expect(A.ok, JSON.stringify(A.diagnostic)).toBe(true)
    expect(meaningOf(A.result)).toEqual(original)
    const result = decodeJsconfuserVm(shifted)
    expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
    expect(result.output).not.toBe(shifted)
  })
