import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import lintIfStatement from '#visitor/lint-if-statement'

const root = join(__dirname, 'lint-if-statement')

// Each case keeps a reference to an outer binding (`x`) inside the branch being re-braced.
// That is deliberate: the branch is re-homed into a new BlockStatement, and the helper's
// reference-state check is what catches the re-homing being recorded twice.
test('unbraced-both-valid', () => {
  getResult(lintIfStatement, true, join(root, 'unbraced-both-valid'))
})

test('unbraced-consequent-valid', () => {
  getResult(lintIfStatement, true, join(root, 'unbraced-consequent-valid'))
})

test('braced-invalid', () => {
  getResult(lintIfStatement, false, join(root, 'braced-invalid'))
})
