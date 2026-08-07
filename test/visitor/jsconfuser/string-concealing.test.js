import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import stringConcealingModule from '#visitor/jsconfuser/string-concealing'

const { deStringConcealingInit } = stringConcealingModule
const root = join(__dirname, 'string-concealing')

test('simple', () => {
  const tc = 'simple'
  getResult(deStringConcealingInit(), true, join(root, tc))
})

test('multi-block', () => {
  const tc = 'multi-block'
  getResult(deStringConcealingInit(), true, join(root, tc))
})

// The same wrapper as `simple`, in the spelling it actually has by the time this pass
// runs on a preset sample: the wrapper and the decode function are both split
// declarations holding function *expressions*, the wrapper body opens with a
// declaration-only var, and both the inner callee and the call sites go through
// `(1, fn)`. Decodes to byte-identical output.
test('expression-wrapper', () => {
  const tc = 'expression-wrapper'
  getResult(deStringConcealingInit(), true, join(root, tc))
})

test('not-a-wrapper', () => {
  const tc = 'not-a-wrapper'
  getResult(deStringConcealingInit(), false, join(root, tc))
})
