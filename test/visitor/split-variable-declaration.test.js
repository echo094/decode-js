import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import splitVariableDeclaration from '#visitor/split-variable-declaration'

const root = join(__dirname, 'split-variable-declaration')

// The declarators re-homed into new declarations reference the outer binding `x`.
test('multi-declarator-valid', () => {
  getResult(splitVariableDeclaration, true, join(root, 'multi-declarator-valid'))
})

test('single-declarator-invalid', () => {
  getResult(splitVariableDeclaration, false, join(root, 'single-declarator-invalid'))
})

// The scope of a for statement is its body, so the declaration is left alone.
test('for-init-invalid', () => {
  getResult(splitVariableDeclaration, false, join(root, 'for-init-invalid'))
})
