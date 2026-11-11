import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import splitAssignment from '#visitor/split-assignment'

const root = join(__dirname, 'split-assignment')

test('call-valid-1', () => {
  const tc = 'call-valid-1'
  getResult(splitAssignment, true, join(root, tc))
})

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

test('member-valid-1', () => {
  const tc = 'member-valid-1'
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

test('assignment-member-name-valid', () => {
  const tc = 'assignment-member-name-valid'
  getResult(splitAssignment, true, join(root, tc))
})

// The split reads the target back and runs the assignment before the rest of its statement: a
// member target or an earlier operand reading the target would change behaviour (issue #225).

test('variable-member-target-invalid', () => {
  const tc = 'variable-member-target-invalid'
  getResult(splitAssignment, false, join(root, tc))
})

test('if-member-target-invalid', () => {
  const tc = 'if-member-target-invalid'
  getResult(splitAssignment, false, join(root, tc))
})

test('variable-update-key-invalid', () => {
  const tc = 'variable-update-key-invalid'
  getResult(splitAssignment, false, join(root, tc))
})

test('assignment-member-left-invalid', () => {
  const tc = 'assignment-member-left-invalid'
  getResult(splitAssignment, false, join(root, tc))
})

test('member-property-invalid', () => {
  const tc = 'member-property-invalid'
  getResult(splitAssignment, false, join(root, tc))
})

test('compound-left-invalid', () => {
  const tc = 'compound-left-invalid'
  getResult(splitAssignment, false, join(root, tc))
})

test('call-right-invalid', () => {
  const tc = 'call-right-invalid'
  getResult(splitAssignment, false, join(root, tc))
})

test('member-getter-invalid', () => {
  const tc = 'member-getter-invalid'
  getResult(splitAssignment, false, join(root, tc))
})
