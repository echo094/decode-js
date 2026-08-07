import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import calculateConstantExp from '#visitor/calculate-constant-exp'

const root = join(__dirname, 'calculate-constant-exp')

test('and-true', () => {
  const tc = 'and-true'
  getResult(calculateConstantExp, true, join(root, tc))
})

test('and-false', () => {
  const tc = 'and-false'
  getResult(calculateConstantExp, true, join(root, tc))
})

test('or-true', () => {
  const tc = 'or-true'
  getResult(calculateConstantExp, true, join(root, tc))
})

test('or-false', () => {
  const tc = 'or-false'
  getResult(calculateConstantExp, true, join(root, tc))
})

test('non-literal-left', () => {
  const tc = 'non-literal-left'
  getResult(calculateConstantExp, false, join(root, tc))
})
