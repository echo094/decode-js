import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import jcFuncLengthInit from '#visitor/jsconfuser/function-length'

const root = join(__dirname, 'function-length')

test('named-function-declaration', () => {
  const tc = 'named-function-declaration'
  getResult(jcFuncLengthInit(), true, join(root, tc))
})

test('inline-arrow-expression', () => {
  const tc = 'inline-arrow-expression'
  getResult(jcFuncLengthInit(), true, join(root, tc))
})

test('default-length-omitted', () => {
  const tc = 'default-length-omitted'
  getResult(jcFuncLengthInit(), true, join(root, tc))
})

test('not-a-length-wrapper', () => {
  const tc = 'not-a-length-wrapper'
  getResult(jcFuncLengthInit(), false, join(root, tc))
})

test('rgf-shrunk-stub', () => {
  const tc = 'rgf-shrunk-stub'
  getResult(jcFuncLengthInit(), true, join(root, tc))
})
