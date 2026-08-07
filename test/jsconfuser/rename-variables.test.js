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
