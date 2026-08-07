import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deRgf from '#visitor/jsconfuser/rgf'

const root = join(__dirname, 'rgf')

test('function-declaration', () => {
  const tc = 'function-declaration'
  getResult(deRgf, true, join(root, tc))
})

test('function-expression', () => {
  const tc = 'function-expression'
  getResult(deRgf, true, join(root, tc))
})

test('global-reference', () => {
  const tc = 'global-reference'
  getResult(deRgf, true, join(root, tc))
})

test('nested-functions', () => {
  const tc = 'nested-functions'
  getResult(deRgf, true, join(root, tc))
})

test('multiple-functions', () => {
  const tc = 'multiple-functions'
  getResult(deRgf, true, join(root, tc))
})

test('outside-scope-guard', () => {
  const tc = 'outside-scope-guard'
  getResult(deRgf, false, join(root, tc))
})
