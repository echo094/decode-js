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

// calculator + renameVariables: audited, CONFIRMED AFFECTED and fixed. The dispatch
// FunctionDeclaration's own scope (fnPath.scope) includes its own params, so
// RenameVariables can coincidentally assign the dispatch function the exact same name
// as its own first param (`function S5tLFcy(S5tLFcy, a, b) { ... }`, reproduced here).
// `fnPath.scope.getBinding(fnName)` then resolved to the shadowing *param* binding
// instead of the function's own declaration binding one scope out - its
// referencePaths never include the real call sites, so no call got rewritten and the
// (still-referenced-elsewhere) dispatch function survived undeleted: runtime-correct
// but 100% undecoded, invisible to a residual-signature check that only looks for a
// missing switch. Fixed by resolving from `fnPath.scope.parent` instead, which skips
// the function's own scope and finds the declaration's real binding in whichever
// block actually contains it (see calculator.js).
test('calculator', () => {
  const tc = 'calculator'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// globalConcealing + renameVariables: same vulnerable code shape as calculator.js
// (fnPath.scope.getBinding(fnName) from the switch function's own scope, which
// includes its own param), hardened defensively even though 128 empirical runs
// across two source shapes never triggered a live self-collision. Root cause of
// the difference: GlobalConcealing prepends three declarations in a fixed order
// (globalVar init, the sniffer fn, then the switch fn), so RenameVariables' own
// name-reuse algorithm (renameVariables.ts's "possible" set, populated in
// Program-defined-order) always offers the sniffer function's placeholder name to
// the switch fn's param before ever reaching the switch fn's own name - an
// encoder-ordering coincidence, not a documented guarantee, and not a reason to
// leave the same code shape that broke Calculator unfixed. Hardened via the
// identical fnPath.scope.parent fix. 10/10 runtime-correct, 5/5 residue-free with
// and without renameVariables both before and after the hardening (no behavior
// change in the non-colliding case).
test('global-concealing', () => {
  const tc = 'global-concealing'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// opaquePredicates + renameVariables: audited, cleared - and unlike Lock/RGF/Dispatcher,
// provably safe by construction rather than just by absence of a cross-scope splice.
// matchPredicateGenTrue's `path` (the `!("key" in dummyFn)` test) always sits inside the
// scope that references dummyFn, by definition - it *is* that reference's own location.
// RenameVariables' own reuse algorithm (renameVariables.ts's "possible" set) only ever
// offers an ancestor scope's renamed name to a descendant scope when that name is NOT
// referenced anywhere in the descendant's subtree; since every scope from `path` up to
// Program necessarily contains the dummyFn reference in its own subtree (path is nested
// inside all of them), dummyFn's own new name can never legally become a reuse candidate
// along that exact chain - the mechanism that broke Calculator/GlobalConcealing (a
// function's own name being free for its own body to reuse, because it doesn't
// self-reference) structurally cannot occur here. 20/20 runtime-correct, 20/20
// residue-free (regex for a surviving `"key" in name` guard) across fresh runs with
// renameVariables, three predicate sites across sibling/nested/loop scopes in one sample.
// No code change.
test('opaque-predicates', () => {
  const tc = 'opaque-predicates'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// stringSplitting + renameVariables: audited, cleared - the decoder side
// (calculate-constant-exp.js's calculateBinaryExpression) is pure literal folding over
// BinaryExpression/UnaryExpression/LogicalExpression nodes and never reads an
// identifier's name at all, so there's no name-based matching for RenameVariables to
// collide with in the first place (a stronger guarantee than the structural-only
// clears above - this one doesn't even look at bindings). Confirmed empirically too:
// the frozen sample below coincidentally renames a function and its own parameter to
// the exact same identifier (`function BxHPT53(BxHPT53)`, the same shape that broke
// calculator.js/global-concealing.js), and still decodes every split-string chain back
// to a single literal with zero residue, because the fold never inspects that name.
// 10/10 runtime-correct, 5/5 residue-free (no leftover `+ ""`-chain concatenation),
// with and without renameVariables. No code change.
test('string-splitting', () => {
  const tc = 'string-splitting'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})
