import { join } from 'path'
import { test } from 'vitest'
import { getPipelineResult } from '../../helper.js'
import { decodeRgf } from '#plugin/jsconfuser.js'

// The plugin's RGF step: find the array, decode each sub-program with the plugin, put it back.
const getResult = (fix, input) => getPipelineResult([decodeRgf], fix, input)

const root = join(__dirname, 'rgf')

test('function-declaration', () => {
  const tc = 'function-declaration'
  getResult(true, join(root, tc))
})

test('function-expression', () => {
  const tc = 'function-expression'
  getResult(true, join(root, tc))
})

test('global-reference', () => {
  const tc = 'global-reference'
  getResult(true, join(root, tc))
})

test('nested-functions', () => {
  const tc = 'nested-functions'
  getResult(true, join(root, tc))
})

test('multiple-functions', () => {
  const tc = 'multiple-functions'
  getResult(true, join(root, tc))
})

test('outside-scope-guard', () => {
  const tc = 'outside-scope-guard'
  getResult(false, join(root, tc))
})
