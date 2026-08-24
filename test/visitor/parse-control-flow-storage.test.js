import fs from 'fs'
import { join } from 'path'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import {
  expectConsistentState,
  getVisitorResult as getResult,
} from '../helper.js'
import parseControlFlowStorage from '#visitor/parse-control-flow-storage'

const root = join(__dirname, 'parse-control-flow-storage')

test('object-invalid-1', () => {
  const tc = 'object-invalid-1'
  getResult(parseControlFlowStorage, false, join(root, tc))
})

test('nested-delegating-wrapper-outer-first', () => {
  const tc = 'nested-delegating-wrapper-outer-first'
  const input = fs.readFileSync(join(root, `${tc}.js`), 'utf-8')
  const expected = fs
    .readFileSync(join(root, `${tc}.fix.js`), 'utf-8')
    .trimEnd()
  const ast = parse(input)
  traverse(ast, parseControlFlowStorage)
  expect(generate(ast).code).toBe(expected)
  expectConsistentState(ast, expected)
})
