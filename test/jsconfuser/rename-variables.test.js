import { join } from 'path'
import { test } from 'vitest'
import { getPluginResult } from '../helper.js'
import PluginJsconfuser from '#plugin/jsconfuser.js'

// Fixtures pairing each per-transform decoder with `renameVariables` - the audit tracked
// on checkpoint.md's Next steps ("Audit every transform's decoder for name/suffix-based
// matching"). RenameVariables (Order 30) reassigns every identifier independently, so it
// can coincidentally hand the same name to two unrelated bindings that a decoder never
// has to distinguish when real source names differ. Each fixture here either pins a real
// bug this uncovered, or stands as proof-of-safety for a transform the audit cleared.
// Transforms that run *after* RenameVariables in the encoder's own Order (Finalizer,
// Pack, Integrity - Order 35-37) are out of scope: their own emitted structure is built
// after renaming already happened, so it can never itself have been renamed.

const root = __dirname + '/rename-variables'

// flatten + renameVariables: substituteFlatAccess (flatten.js) splices the outer
// free-variable's captured name in as a bare identifier when resolving a
// `flatParam["prop"]` access. RenameVariables can coincidentally assign that same name
// to one of the flattened function's own (destructured) params, silently capturing the
// reference instead of it resolving outward - wrong runtime result, no error. Fixed by
// renaming the colliding local out of the way first (see flatten.js's
// `substituteFlatAccess`/`isScopeWithin`).
test('flatten', () => {
  const tc = 'flatten'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// lock + renameVariables: audited, cleared. All 6 sub-features (selfDefending,
// antiDebug, tamperProtection incl. countermeasures, startDate/endDate, domainLock)
// combined in one sample - every matcher in lock.js either compares names entirely
// self-contained within one rigid encoder-template shape (never merges/relocates
// code between two independently-renamed scopes the way flatten.js did), so there's
// no coincidental-collision surface for RenameVariables to exploit. 10/10 runtime-
// correct and 5/5 free of any Lock scaffolding residue across fresh runs. Proof-of-
// safety fixture, not a regression pin for a bug.
test('lock', () => {
  const tc = 'lock'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// rgf + renameVariables: audited, cleared. rgf.ts's own encoder-side eligibility rule
// (transforms/rgf.ts, "Does not apply to functions that reference outside variables")
// means an RGF-transformed function is always fully self-contained - unlike flatten.js,
// there's no free-variable substitution step at all for renameVariables to exploit a
// coincidental name collision through. 10/10 runtime-correct, 5/5 residue-free, with
// and without renameVariables, two RGF'd functions in the same sample.
test('rgf', () => {
  const tc = 'rgf'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// dispatcher + renameVariables: audited, cleared. dispatcher.js's own reconstructed
// functions always get a fresh scope.generateUidIdentifier() name (guaranteed
// non-colliding against whatever's already in scope) and are reinserted into the exact
// same block they were extracted from, never a different/independently-renamed scope
// - unlike flatten.js and rgf.js, there's no free-variable substitution or cross-scope
// splice for a coincidental renameVariables collision to corrupt. Two dispatched
// functions sharing an outer free variable (`counter`), 10/10 runtime-correct, 5/5
// residue-free, with and without renameVariables.
test('dispatcher', () => {
  const tc = 'dispatcher'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// deadCode + renameVariables: audited, cleared. matchDeadCodeGuard (dead-code.js) never
// compares an identifier against a hardcoded/fixed name - both name reads
// (`test.right.name`, `call.callee.name`) are only ever used to look up the binding at
// that exact identifier's current (possibly renamed) spelling via `scope.getBinding`,
// and the guard/dummy-fn shapes it matches are purely structural (`"prop" in dummyFn`,
// a 0-param/empty-body FunctionDeclaration). No cross-scope splice like flatten.js's,
// so there's no coincidental-collision surface for RenameVariables to exploit either.
// 10/10 runtime-correct, 5/5 residue-free (0 leftover guards/dummy fns), with and
// without renameVariables.
test('dead-code', () => {
  const tc = 'dead-code'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})
