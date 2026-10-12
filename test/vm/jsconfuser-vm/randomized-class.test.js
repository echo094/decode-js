import fs from 'node:fs'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { test, expect } from 'vitest'
import { diagnoseClassRuntime } from '../../../src/vm/jsconfuser-vm/analyze-class-runtime.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import { expectConsistentState } from '../../helper.js'
import {
  parseSuccessfulOutput,
  assertNoVmResidue,
  assertDerivedStateConsistency,
} from './integration/harness.js'

const sourceAt = (name) =>
  fs.readFileSync(
    new URL(`fixtures/randomized-class/${name}.js`, import.meta.url),
    'utf8',
  )
for (const kind of ['arithmetic', 'spread', 'exceptionRoutes'])
  for (const seed of [181, 182, 183])
    test(`${kind}/${seed}: complete semantic mapping, canonical words and actual recovery`, () => {
      const source = sourceAt(`${kind}-${seed}`),
        ast = parse(source)
      traverse(ast, {})
      const before = JSON.stringify(ast),
        graph = diagnoseClassRuntime(ast, { randomized: true })
      expect(graph.ok, JSON.stringify(graph.diagnostic)).toBe(true)
      expect(Object.keys(graph.result.layout.opcodes)).toHaveLength(61)
      expect(graph.result.layout.sentinel).toBeGreaterThan(65535)
      const A = diagnoseContainer(ast),
        baseline = diagnoseContainer(sourceAt(`${kind}.baseline`))
      expect(A.ok, JSON.stringify(A.diagnostic)).toBe(true)
      expect(JSON.stringify(ast)).toBe(before)
      expectConsistentState(ast, source, { sourceType: 'script' })
      expect(A.result.roles.words.values).toEqual(
        baseline.result.roles.words.values,
      )
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
  const graph = diagnoseClassRuntime(source, { randomized: true })
  expect(graph.ok).toBe(true)
  const ast = parse(source)
  let dispatch
  traverse(ast, {
    SwitchStatement(path) {
      dispatch = path
    },
  })
  const handler = (role) =>
    dispatch
      .get('cases')
      .find(
        (path) => path.node.test?.value === graph.result.layout.opcodes[role],
      )
  recipe({ ast, dispatch, handler, layout: graph.result.layout })
  return generate(ast).code
}
function refused(source, code) {
  const a = diagnoseContainer(source)
  expect(a).toMatchObject({ ok: false, result: null, diagnostic: { code } })
  expect(a.diagnostic.code).not.toBe('deliberately-wrong-diagnostic')
  expect(decodeJsconfuserVm(source)).toMatchObject({
    ok: false,
    result: null,
    output: source,
    diagnostic: { code: 'container-declined' },
  })
}
for (const seed of [181, 182, 183]) {
  const source = sourceAt(`arithmetic-${seed}`)
  test(`${seed}: changed live label reaches source word/mapping refusal`, () => {
    const damaged = change(source, ({ handler, layout }) => {
      const occupied = new Set(Object.values(layout.opcodes))
      let unused = 0
      while (occupied.has(unused)) unused++
      handler('LOAD_CONST').node.test.value = unused
    })
    refused(damaged, 'randomized-class-wordcode')
  })
  test(`${seed}: duplicated labels reach allocation refusal`, () => {
    refused(
      change(source, ({ handler }) => {
        handler('ADD').node.test.value = handler('SUB').node.test.value
      }),
      'randomized-class-layout',
    )
  })
  test(`${seed}: damaged semantic handler reaches complete case refusal`, () => {
    refused(
      change(source, ({ handler }) => {
        handler('ADD').traverse({
          BinaryExpression(path) {
            if (path.node.operator === '+') path.node.operator = '-'
          },
        })
      }),
      'randomized-class-case',
    )
  })
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
// opcode word and the disabled-timing `op = JUMP` literal move together. The
// literal is an owned opcode use, so leaving it behind damages the contract.
function remapped(source, { includeJumpUse = true } = {}) {
  const A = diagnoseContainer(source)
  expect(A.ok).toBe(true)
  const B = diagnoseWordcode(A.result)
  expect(B.ok).toBe(true)
  const words = A.result.roles.words.values
  return change(source, ({ ast, dispatch, layout }) => {
    const remap = new Map(
      Object.values(layout.opcodes).map((value) => [
        value,
        (value + 1) % 65536,
      ]),
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
          right.value === layout.opcodes.JUMP
        ) {
          jumpUses++
          if (includeJumpUse) right.value = remap.get(right.value)
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
  test(`${seed}: consistent full remapping admits identical canonical words`, () => {
    const source = sourceAt(`arithmetic-${seed}`)
    const original = diagnoseContainer(source).result.roles.words.values
    const shifted = remapped(source)
    const A = diagnoseContainer(shifted)
    expect(A.ok, JSON.stringify(A.diagnostic)).toBe(true)
    expect(A.result.roles.words.values).toEqual(original)
    const result = decodeJsconfuserVm(shifted)
    expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
    expect(result.output).not.toBe(shifted)

    const stale = remapped(source, { includeJumpUse: false })
    refused(stale, 'randomized-class-case')
    expect(diagnoseContainer(stale).diagnostic.message).toContain(
      'layout OP.JUMP changed between uses',
    )
  })
