import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import splitVarDeclarator from '#visitor/split-variable-declarator'

const root = join(__dirname, 'split-variable-declarator')

test('parent-invalid', () => {
  const tc = 'parent-invalid'
  getResult(splitVarDeclarator, false, join(root, tc))
})

test('init-invalid', () => {
  const tc = 'init-invalid'
  getResult(splitVarDeclarator, false, join(root, tc))
})

test('init-valid-1', () => {
  const tc = 'init-valid-1'
  getResult(splitVarDeclarator, true, join(root, tc))
})
