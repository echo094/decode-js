import fs from 'fs'
import { join } from 'path'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import {
  expectConsistentState,
  getVisitorResult as getResult,
} from '../../helper.js'
import inlineControlFlowStorage from '#visitor/obfuscator/inline-control-flow-storage'

const root = join(__dirname, 'inline-control-flow-storage')

/**
 * The fork carries its own copy of the shared visitor's cases rather than reading them across from
 * `test/visitor/parse-control-flow-storage/`.
 *
 * Two reasons, and the second is why sharing a directory was wrong rather than merely untidy. The
 * fork claims to accept everything the shared matcher accepts, and a claim about one
 * implementation cannot be pinned by fixtures another one is run against — the wrapper cases below
 * are what makes that claim falsifiable here. And the shared directory would otherwise hold cases
 * the shared visitor *fails*, so adding a directory glob to its suite — the natural next step —
 * would read as a regression in a visitor nobody had touched.
 */
test('storage-binary', () => {
  getResult(inlineControlFlowStorage, true, join(root, 'storage-binary'))
})

test('storage-logical', () => {
  getResult(inlineControlFlowStorage, true, join(root, 'storage-logical'))
})

test('storage-call', () => {
  getResult(inlineControlFlowStorage, true, join(root, 'storage-call'))
})

test('storage-optional-call preserves optional semantics', () => {
  getResult(inlineControlFlowStorage, true, join(root, 'storage-optional-call'))
})

test('object-invalid-1', () => {
  getResult(inlineControlFlowStorage, false, join(root, 'object-invalid-1'))
})

/**
 * The two cases the fork exists for: the numeric entry `stringArrayCallsTransform` emits from
 * `3.2.0`, and the preflight that keeps a partial match from freezing an ordinary object's values.
 */
test('numeric storage values are replaced and removed with fresh bindings', () => {
  const input = fs.readFileSync(join(root, 'storage-numeric.js'), 'utf-8')
  const expected = fs
    .readFileSync(join(root, 'storage-numeric.fix.js'), 'utf-8')
    .trimEnd()
  const ast = parse(input)
  traverse(ast, inlineControlFlowStorage)
  expect(generate(ast).code).toBe(expected)
  expectConsistentState(ast, expected)
})

test('unsupported member writes leave numeric storage untouched', () => {
  const input = fs.readFileSync(join(root, 'storage-numeric-write.js'), 'utf-8')
  const ast = parse(input)
  const expected = generate(ast).code
  traverse(ast, inlineControlFlowStorage)
  expect(generate(ast).code).toBe(expected)
  expectConsistentState(ast)
})

test('unsupported optional member calls leave storage untouched', () => {
  const input = fs.readFileSync(
    join(root, 'storage-optional-member.js'),
    'utf-8',
  )
  const ast = parse(input)
  const expected = generate(ast).code
  traverse(ast, inlineControlFlowStorage)
  expect(generate(ast).code).toBe(expected)
  expectConsistentState(ast)
})

test('optional member storage references leave storage untouched', () => {
  const input = fs.readFileSync(
    join(root, 'storage-optional-reference.js'),
    'utf-8',
  )
  const ast = parse(input)
  const expected = generate(ast).code
  traverse(ast, inlineControlFlowStorage)
  expect(generate(ast).code).toBe(expected)
  expectConsistentState(ast)
})

test('nested ordinary storage calls replace from the inside out', () => {
  getResult(inlineControlFlowStorage, true, join(root, 'storage-nested-call'))
})
