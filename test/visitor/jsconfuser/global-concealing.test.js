import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deGlobalConcealingInit from '#visitor/jsconfuser/global-concealing'

const root = join(__dirname, 'global-concealing')

test('simple', () => {
  const tc = 'simple'
  getResult(deGlobalConcealingInit(), true, join(root, tc))
})

test('multiple-refs', () => {
  const tc = 'multiple-refs'
  getResult(deGlobalConcealingInit(), true, join(root, tc))
})

// Same program as `simple`, with `var globalVar = getGlobalVarFn()` split the way
// MovedDeclarations (encoder Order 25) spells it. The expected output is byte-identical
// to `simple`'s: the split must not cost the sniffer, whose name is only readable from
// that initializer.
test('moved-declaration-split', () => {
  const tc = 'moved-declaration-split'
  getResult(deGlobalConcealingInit(), true, join(root, tc))
})

// The switch function held as `var f;` + `f = function (…) {…}` rather than as its own
// declaration - what the CFF decode hands back on a `high` sample, and the spelling that
// made this visitor never fire at all while it was keyed on `FunctionDeclaration`. Expected
// output byte-identical to `moved-declaration-split`'s: how the holder is spelled must not
// change what the pass produces.
test('assigned-holder', () => {
  const tc = 'assigned-holder'
  getResult(deGlobalConcealingInit(), true, join(root, tc))
})

// One case arriving in `Minify`'s dot spelling (`globalVar.decoyName1`) among computed ones.
// The matcher is all-or-nothing, so requiring the computed form cost the whole function - a
// single minified case among forty left an entire GlobalConcealing layer undecoded. Expected
// output byte-identical to `simple`'s.
// The *sniffer* held as a merged `var …;` plus a separate `getGlobalVarFn = function …`,
// which is how the CFF decode re-emits it (see control-flow.md item 4). The rewrite and the
// switch-fn/globalVar deletions never depended on that spelling; only the sniffer's own
// cleanup did, and an `isFunctionDeclaration()` gate there left ~770B of getGlobal
// scaffolding at zero references on 39 of 96 corpus samples. Expected output byte-identical
// to `assigned-holder`'s.
test('assigned-sniffer', () => {
  const tc = 'assigned-sniffer'
  getResult(deGlobalConcealingInit(), true, join(root, tc))
})

test('minified-member-key', () => {
  const tc = 'minified-member-key'
  getResult(deGlobalConcealingInit(), true, join(root, tc))
})

// Same holder spelling, written twice. The second write means the call sites are not all
// reading the function this match was built from, so `resolveBindingFunction` fails closed
// and nothing is rewritten - the guard that makes accepting the assigned form safe.
test('reassigned-holder', () => {
  const tc = 'reassigned-holder'
  getResult(deGlobalConcealingInit(), false, join(root, tc))
})

test('not-a-wrapper', () => {
  const tc = 'not-a-wrapper'
  getResult(deGlobalConcealingInit(), false, join(root, tc))
})
