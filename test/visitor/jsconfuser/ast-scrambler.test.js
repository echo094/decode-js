import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deAstScramblerInit from '#visitor/jsconfuser/ast-scrambler'

const root = join(__dirname, 'ast-scrambler')

test('simple', () => {
  const tc = 'simple'
  getResult(deAstScramblerInit(), true, join(root, tc))
})

test('nested-function', () => {
  const tc = 'nested-function'
  getResult(deAstScramblerInit(), true, join(root, tc))
})

test('not-a-wrapper', () => {
  const tc = 'not-a-wrapper'
  getResult(deAstScramblerInit(), false, join(root, tc))
})
