import { join } from 'path'
import { expect, test } from 'vitest'
import { getVisitorResult } from '../../helper.js'
import { createUnflattenSwitchDispatch } from '#visitor/obfuscator/unflatten-switch-dispatch'

const root = join(__dirname, 'unflatten-switch-dispatch')

/**
 * The shared helper owns both assertions this suite needs, so it is used rather than reimplemented.
 *
 * - **A declining case needs no golden.** With `fix` false the helper compares the generated tree
 *   against the *input source*, which is what "left exactly as found" means; the input file is its
 *   own expected output. That check is not optional here even though every decline case also
 *   asserts a zero count: a count of zero says the pass reported no change, not that it made none,
 *   and mutate-then-decline is precisely the shared visitor's failure mode this fork exists to
 *   avoid.
 * - **A rewriting case gets the reference-state comparison for free**, which a local helper is
 *   liable to omit: the transformed tree's scope bookkeeping must match a fresh parse of the
 *   expected output, so a missing or mis-scoped `crawl()` fails even when the printed text is
 *   identical. Stale scope state was one of this pass's own two defects, so it is the last check
 *   to hand-roll around.
 *
 * What the helper cannot supply is the `onChange` count, and that is the only reason for the
 * wrapper below. The channel is part of the pass's interface - it is how a caller runs a pipeline
 * to a fixpoint without re-serializing the tree - so a rewrite that forgot to report itself would
 * silently make a fixpoint driver exit a round early. Nothing else pins that.
 */
function run(name, fix) {
  let fired = 0
  getVisitorResult(
    createUnflattenSwitchDispatch(() => fired++),
    fix,
    join(root, name),
  )
  return fired
}

/**
 * Five of the ten cases below pin a **decline**, which is unusual for a fixture set and is the
 * whole point of this suite. The shared `remove-control-flow-ob.js` passes the two original
 * rewrite cases and mishandles every decline case - two by corrupting output silently, one by
 * throwing - so a suite covering only the happy path would not tell the implementations apart.
 */

test('baseline: the controller is a permutation, read left to right', () => {
  // order '2|0|3|1' over cases 0=b,1=return d,2=a,3=c  ->  a(); b(); c(); return d();
  expect(run('baseline', true)).toBe(1)
})

test('merged-declaration: `simplify` fuses the two declarations into one', () => {
  expect(run('merged-declaration', true)).toBe(1)
})

test('not-always-true: an ordinary `while (!done)` loop is left alone', () => {
  // The shared visitor accepts any prefix unary here and deletes the loop, emitting its body
  // straight-line. Declining is the only safe answer: nothing distinguishes this from a real
  // state machine.
  expect(run('not-always-true', false)).toBe(0)
})

test('fallthrough-case: a case without `continue` or `return` is left alone', () => {
  // The shared visitor walks forward into the next case and appends it twice.
  expect(run('fallthrough-case', false)).toBe(0)
})

test('no-increment: a discriminant without `++` is declined, not thrown on', () => {
  // The shared visitor reads `property.argument.name` unguarded and throws, aborting the decode.
  expect(run('no-increment', false)).toBe(0)
})

test('conditional-declaration: a controller initialised under an `if` is left alone', () => {
  // `var` hoists, so a binding lookup resolves it - but the initialisation does not dominate the
  // loop, and rewriting would run statements the original never runs.
  expect(run('conditional-declaration', false)).toBe(0)
})

test('order-mismatch: an order string shorter than the case list is left alone', () => {
  expect(run('order-mismatch', false)).toBe(0)
})

test('directive-empty-case: a case emptied by directive re-hoisting drops out', () => {
  // The encoder produces this on its own, and it is not a corner: control-flow flattening runs at
  // stage 4 and puts a function's leading `'use strict'` into a case like any other statement,
  // then DirectivePlacementTransformer re-emits the directive at the top of the scope during
  // Finalizing - leaving that case with nothing in it. Any flattened function whose body opens
  // with a directive lands here, which is a large slice of real-world input.
  //
  // Found by appending a corpus input carrying a directive: before that, the whole matrix had
  // none, and this pass declined on every cff cell of the new fixture at every column.
  expect(run('directive-empty-case', true)).toBe(1)
})

test('directive-retained-case: only the re-hoisted leading copy drops out', () => {
  // From 5.2.0 Finalizing removes the original directive only from the scope's direct body. When
  // flattening has nested it in a switch case, that copy survives beside the re-hoisted clone.
  // The second identical string is deliberately later in source order and is therefore ordinary
  // executable content; matching by value without the prologue-position gate would delete it too.
  expect(run('directive-retained-case', true)).toBe(1)
})

test('all-cases-empty: a dispatch with nothing in any case removes the loop', () => {
  // Hand-built rather than harvested - the encoder has no reason to flatten a body that holds
  // only a directive - but the branch it covers is ours, and `replaceWithMultiple([])` is not a
  // removal, so without this case the empty path would be untested code.
  expect(run('all-cases-empty', true)).toBe(1)
})
