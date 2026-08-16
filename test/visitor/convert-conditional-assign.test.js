import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import convertConditionalAssign from '#visitor/atomic/convert-conditional-assign'

const root = join(__dirname, 'convert-conditional-assign')

// Distributing the assignment is positional, not simplifying: it moves a conditional out of
// value position so lint-conditional-if can reach it.

test('assignment-valid', () => {
  getResult(convertConditionalAssign, true, join(root, 'assignment-valid'))
})

// The target is cloned into both branches rather than shared.
test('member-target-valid', () => {
  getResult(convertConditionalAssign, true, join(root, 'member-target-valid'))
})

test('compound-valid', () => {
  getResult(convertConditionalAssign, true, join(root, 'compound-valid'))
})

// Distributing into a declarator would mean hoisting the declaration out of its
// initializer - a scope change, and a different decision from this one.
test('declarator-invalid', () => {
  getResult(convertConditionalAssign, false, join(root, 'declarator-invalid'))
})

// Already in statement position; lint-conditional-if owns this one.
test('statement-invalid', () => {
  getResult(convertConditionalAssign, false, join(root, 'statement-invalid'))
})
