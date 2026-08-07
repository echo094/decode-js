import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deCalculatorInit from '#visitor/jsconfuser/calculator'

const root = join(__dirname, 'calculator')

test('all-operators', () => {
  const tc = 'all-operators'
  getResult(deCalculatorInit(), true, join(root, tc))
})

// The dispatch function held as a merged `var f, …;` plus a separate `f = function …`,
// which is what the CFF decode hands back on a `high` sample. Keyed on `FunctionDeclaration`
// this visitor never ran on that spelling at all - the whole Calculator layer stood with live
// `f("key", 1, 2)` call sites. Same defect and same fix as global-concealing.js's.
test('assigned-holder', () => {
  const tc = 'assigned-holder'
  getResult(deCalculatorInit(), true, join(root, tc))
})

// Same holder spelling, written twice: the call sites are then not all reading the function
// this match was built from, so `resolveBindingFunction` fails closed and nothing is
// rewritten. The guard that makes accepting the assigned form safe.
test('reassigned-holder', () => {
  const tc = 'reassigned-holder'
  getResult(deCalculatorInit(), false, join(root, tc))
})

test('not-a-dispatch-fn', () => {
  const tc = 'not-a-dispatch-fn'
  getResult(deCalculatorInit(), false, join(root, tc))
})

test('unrecognized-key', () => {
  const tc = 'unrecognized-key'
  getResult(deCalculatorInit(), false, join(root, tc))
})
