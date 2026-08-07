import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import jcOpaquePredicates from '#visitor/jsconfuser/opaque-predicates'

const root = join(__dirname, 'opaque-predicates')

test('if-wrap', () => {
  const tc = 'if-wrap'
  getResult(jcOpaquePredicates.dePredicateGenInit(), true, join(root, tc))
})

test('conditional-wrap', () => {
  const tc = 'conditional-wrap'
  getResult(jcOpaquePredicates.dePredicateGenInit(), true, join(root, tc))
})

test('switch-wrap', () => {
  const tc = 'switch-wrap'
  getResult(jcOpaquePredicates.dePredicateGenInit(), true, join(root, tc))
})

test('return-wrap', () => {
  const tc = 'return-wrap'
  getResult(jcOpaquePredicates.dePredicateGenInit(), true, join(root, tc))
})

test('not-empty-dummy', () => {
  const tc = 'not-empty-dummy'
  getResult(jcOpaquePredicates.dePredicateGenInit(), false, join(root, tc))
})
