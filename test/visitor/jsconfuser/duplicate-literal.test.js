import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deDuplicateLiteralInit from '#visitor/jsconfuser/duplicate-literal'

const root = join(__dirname, 'duplicate-literal')

test('many-values', () => {
  const tc = 'many-values'
  getResult(deDuplicateLiteralInit(), true, join(root, tc))
})

test('undefined-null', () => {
  const tc = 'undefined-null'
  getResult(deDuplicateLiteralInit(), true, join(root, tc))
})

test('negative-number', () => {
  const tc = 'negative-number'
  getResult(deDuplicateLiteralInit(), true, join(root, tc))
})

test('object-key', () => {
  const tc = 'object-key'
  getResult(deDuplicateLiteralInit(), true, join(root, tc))
})

test('nested-function', () => {
  const tc = 'nested-function'
  getResult(deDuplicateLiteralInit(), true, join(root, tc))
})

test('partial-reference', () => {
  const tc = 'partial-reference'
  getResult(deDuplicateLiteralInit(), true, join(root, tc))
})

// Minify re-spells `undefined` as `void 0` and the booleans as `!0`/`!1`, and one
// unrecognized element used to fail the whole array closed.
test('minified-elements', () => {
  const tc = 'minified-elements'
  getResult(deDuplicateLiteralInit(), true, join(root, tc))
})

// An index ControlFlowFlattening rewrote to run through its own state array can't be
// resolved yet, so the array must be left whole rather than half-substituted.
test('cff-shaped-index', () => {
  const tc = 'cff-shaped-index'
  getResult(deDuplicateLiteralInit(), true, join(root, tc))
})

// MovedDeclarations splits the array's own declaration into a hoisted bare `var` plus a
// separate assignment, a spelling the declarator match alone never sees.
test('moved-declaration', () => {
  const tc = 'moved-declaration'
  getResult(deDuplicateLiteralInit(), true, join(root, tc))
})

// An array assigned more than once isn't DuplicateLiteralsRemoval's - its contents can
// change, so no read of it resolves to a fixed element.
test('moved-declaration-reassigned', () => {
  const tc = 'moved-declaration-reassigned'
  getResult(deDuplicateLiteralInit(), false, join(root, tc))
})

// Same rule for the declarator spelling: the initializer's elements say nothing about
// what a read sees once the array has been reassigned.
test('reassigned-declarator', () => {
  const tc = 'reassigned-declarator'
  getResult(deDuplicateLiteralInit(), false, join(root, tc))
})

test('no-match', () => {
  const tc = 'no-match'
  getResult(deDuplicateLiteralInit(), false, join(root, tc))
})

test('non-literal-element', () => {
  const tc = 'non-literal-element'
  getResult(deDuplicateLiteralInit(), false, join(root, tc))
})
