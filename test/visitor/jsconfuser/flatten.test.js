import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deFlatten from '#visitor/jsconfuser/flatten'

const root = join(__dirname, 'flatten')

test('simple-value', () => {
  const tc = 'simple-value'
  getResult(deFlatten, true, join(root, tc))
})

test('nested-chain', () => {
  const tc = 'nested-chain'
  getResult(deFlatten, true, join(root, tc))
})

test('strict-mode', () => {
  const tc = 'strict-mode'
  getResult(deFlatten, true, join(root, tc))
})

test('default-param', () => {
  const tc = 'default-param'
  getResult(deFlatten, true, join(root, tc))
})

test('typeof-and-call', () => {
  const tc = 'typeof-and-call'
  getResult(deFlatten, true, join(root, tc))
})

test('function-expression', () => {
  const tc = 'function-expression'
  getResult(deFlatten, true, join(root, tc))
})

test('object-method', () => {
  const tc = 'object-method'
  getResult(deFlatten, true, join(root, tc))
})

// The same wrapper with its flat-object declarator split the way MovedDeclarations (encoder
// Order 25, after Flatten's Order 2) spells it, which happens on roughly half of `high` runs.
// Expected output byte-identical to `object-method`'s: a body-length test read the split as a
// different pattern and declined, so the wrapper is matched through the binding instead.
test('moved-declaration-split', () => {
  const tc = 'moved-declaration-split'
  getResult(deFlatten, true, join(root, tc))
})

test('not-a-wrapper', () => {
  const tc = 'not-a-wrapper'
  getResult(deFlatten, false, join(root, tc))
})
