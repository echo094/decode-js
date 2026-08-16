import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import lintLogicalIf from '#visitor/atomic/lint-logical-if'

const root = join(__dirname, 'lint-logical-if')

test('statement-valid', () => {
  getResult(lintLogicalIf, true, join(root, 'statement-valid'))
})

// `if (c && d) { f(); }` is emitted as `c && d && f();`. Only the outermost `&&` is a
// candidate, so reversing it recovers the original test rather than shredding the chain.
test('chain-valid', () => {
  getResult(lintLogicalIf, true, join(root, 'chain-valid'))
})

// Every position below is a test or a value, not a statement. These are the cases that make
// the position gate load-bearing rather than decorative.

test('if-test-invalid', () => {
  getResult(lintLogicalIf, false, join(root, 'if-test-invalid'))
})

test('while-test-invalid', () => {
  getResult(lintLogicalIf, false, join(root, 'while-test-invalid'))
})

test('for-test-invalid', () => {
  getResult(lintLogicalIf, false, join(root, 'for-test-invalid'))
})

// Reads statement-like but is an expression: rewriting it would need a block body.
test('arrow-body-invalid', () => {
  getResult(lintLogicalIf, false, join(root, 'arrow-body-invalid'))
})

test('declarator-invalid', () => {
  getResult(lintLogicalIf, false, join(root, 'declarator-invalid'))
})

// `||` has no single-branch `if` form - the reversal would need a negated test.
test('or-invalid', () => {
  getResult(lintLogicalIf, false, join(root, 'or-invalid'))
})
