import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deDispatcherInit from '#visitor/jsconfuser/dispatcher'

const root = join(__dirname, 'dispatcher')

test('simple-call', () => {
  const tc = 'simple-call'
  getResult(deDispatcherInit(), true, join(root, tc))
})

// The dispatcher held as `var d = function (…) {…}` rather than as its own declaration -
// what ControlFlowFlattening leaves when nothing afterwards splits it into the assignment
// form, and what an ordinary source would write. Expected output byte-identical to
// `simple-call`'s: the holder's spelling must not decide whether the pass fires.
test('declarator-held', () => {
  const tc = 'declarator-held'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('object-wrapped-call', () => {
  const tc = 'object-wrapped-call'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('new-wrapped-call', () => {
  const tc = 'new-wrapped-call'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('non-call-reference', () => {
  const tc = 'non-call-reference'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('non-call-reference-wrapped', () => {
  const tc = 'non-call-reference-wrapped'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('zero-arg-call', () => {
  const tc = 'zero-arg-call'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('nested-functions', () => {
  const tc = 'nested-functions'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('spread-args', () => {
  const tc = 'spread-args'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('spread-params', () => {
  const tc = 'spread-params'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('multiple-functions', () => {
  const tc = 'multiple-functions'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('preserve-function-length-ref', () => {
  const tc = 'preserve-function-length-ref'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('unreferenced-fn-length-helper', () => {
  const tc = 'unreferenced-fn-length-helper'
  getResult(deDispatcherInit(), true, join(root, tc))
})

test('not-a-wrapper', () => {
  const tc = 'not-a-wrapper'
  getResult(deDispatcherInit(), false, join(root, tc))
})

test('masked-fns-entry', () => {
  const tc = 'masked-fns-entry'
  getResult(deDispatcherInit(), true, join(root, tc))
})

// The unpack line is not at `body[0]`: an initializer-less `var` sits ahead of it, which is
// what `unmaskStack`'s unshifted locals and MovedDeclarations' block hoist both produce.
test('displaced-unpack', () => {
  const tc = 'displaced-unpack'
  getResult(deDispatcherInit(), true, join(root, tc))
})

// VariableMasking rewrites the unpack declaration into a bare assignment, leaving the
// pattern's names declared separately. Those declarators must be dropped as the names are
// promoted to parameters, or every restored parameter is shadowed by a same-named local.
test('assign-unpack', () => {
  const tc = 'assign-unpack'
  getResult(deDispatcherInit(), true, join(root, tc))
})

// What may sit above the unpack line is decided by execution order, not declaration order:
// a hoisted FunctionDeclaration and a closure assignment evaluate nothing, so a read of the
// promoted slot inside either one happens when it is *called*, which is after the line.
test('inert-above-unpack', () => {
  const tc = 'inert-above-unpack'
  getResult(deDispatcherInit(), true, join(root, tc))
})

// The other side of that rule: an `if` above the unpack line can run arbitrary code, so the
// read really could reach the slot early. Decline the whole dispatcher.
test('live-stmt-above-unpack', () => {
  const tc = 'live-stmt-above-unpack'
  getResult(deDispatcherInit(), false, join(root, tc))
})

// Reconstruction lifts entry bodies out to where the dispatcher stood, so an entry
// capturing the dispatcher's own `fnLengths` parameter cannot be rebuilt - decline rather
// than emit a program that throws.
test('entry-captures-dispatcher-scope', () => {
  const tc = 'entry-captures-dispatcher-scope'
  getResult(deDispatcherInit(), false, join(root, tc))
})

test('antitooling-stripped-fn-length', () => {
  const tc = 'antitooling-stripped-fn-length'
  getResult(deDispatcherInit(), true, join(root, tc))
})
