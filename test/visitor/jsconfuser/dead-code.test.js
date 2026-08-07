import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deDeadCodeInit from '#visitor/jsconfuser/dead-code'

const root = join(__dirname, 'dead-code')

test('program-level', () => {
  const tc = 'program-level'
  getResult(deDeadCodeInit(), true, join(root, tc))
})

test('nested-in-function', () => {
  const tc = 'nested-in-function'
  getResult(deDeadCodeInit(), true, join(root, tc))
})

test('not-a-guard-real-call', () => {
  const tc = 'not-a-guard-real-call'
  getResult(deDeadCodeInit(), false, join(root, tc))
})

test('not-a-guard-nonempty-dummy', () => {
  const tc = 'not-a-guard-nonempty-dummy'
  getResult(deDeadCodeInit(), false, join(root, tc))
})

test('not-a-guard-args', () => {
  const tc = 'not-a-guard-args'
  getResult(deDeadCodeInit(), false, join(root, tc))
})

test('not-a-guard-unresolvable-callee', () => {
  const tc = 'not-a-guard-unresolvable-callee'
  getResult(deDeadCodeInit(), false, join(root, tc))
})
