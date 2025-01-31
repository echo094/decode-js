import { join } from 'path'
import { test } from 'vitest'
import getResult from '../helper.js'
import splitAssignment from '#visitor/split-assignment'

const root = join(__dirname, 'split-assignment')

test('if-invalid', () => {
  const tc = 'if-invalid'
  getResult(splitAssignment, false, join(root, tc))
})

test('if-assignment-valid', () => {
  const tc = 'if-assignment-valid'
  getResult(splitAssignment, true, join(root, tc))
})

test('if-member-valid', () => {
  const tc = 'if-member-valid'
  getResult(splitAssignment, true, join(root, tc))
})

test('variable-invalid', () => {
  const tc = 'variable-invalid'
  getResult(splitAssignment, false, join(root, tc))
})

test('variable-valid', () => {
  const tc = 'variable-valid'
  getResult(splitAssignment, true, join(root, tc))
})
