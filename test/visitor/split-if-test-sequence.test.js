import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import splitIfTestSequence from '#visitor/atomic/split-if-test-sequence'

const root = join(__dirname, 'split-if-test-sequence')

// The gap split-sequence.js does not cover: it handles ExpressionStatement, ReturnStatement
// and first-VariableDeclarator position, but not an `if` test.

test('simple-valid', () => {
  getResult(splitIfTestSequence, true, join(root, 'simple-valid'))
})

test('three-valid', () => {
  getResult(splitIfTestSequence, true, join(root, 'three-valid'))
})

test('not-sequence-invalid', () => {
  getResult(splitIfTestSequence, false, join(root, 'not-sequence-invalid'))
})

// The inner `if` is a branch, not a list element, so there is nowhere to insert before it.
// It becomes eligible only once lint-if-statement.js has given it a block.
test('not-in-list-invalid', () => {
  getResult(splitIfTestSequence, false, join(root, 'not-in-list-invalid'))
})
