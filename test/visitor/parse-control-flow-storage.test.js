import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import parseControlFlowStorage from '#visitor/parse-control-flow-storage'

const root = join(__dirname, 'parse-control-flow-storage')

/**
 * The positive cases are real javascript-obfuscator 2.19.0 output, carried through the passes that
 * run ahead of this visitor so each input is what it actually receives. One per wrapper kind the
 * visitor implements, because a single case pins only whichever kind the encoder happened to pick
 * for that source.
 *
 * Until these landed the suite held exactly one case and it was a **decline**, so the resolving
 * path - the only reason anything depends on this visitor - was pinned by nothing committed. What
 * backed it instead was a corpus, which is rebuildable and therefore not coverage.
 *
 * The `fix` cases get the helper's reference-integrity check for free, which matters more here
 * than the printed text: this visitor replaces call sites and removes the storage, so a missing
 * `crawl()` leaves stale reference counts behind output that reads identically.
 */
test('storage-binary', () => {
  // two entries, both binary operators, one nested inside the other's argument list
  getResult(parseControlFlowStorage, true, join(root, 'storage-binary'))
})

test('storage-logical', () => {
  getResult(parseControlFlowStorage, true, join(root, 'storage-logical'))
})

test('storage-call', () => {
  // the call wrapper, and a string-literal storage entry alongside it - the two shapes that make
  // this case cover more than its name suggests
  getResult(parseControlFlowStorage, true, join(root, 'storage-call'))
})

/**
 * A declining case: an object of the right *form* whose function body is not a single `return`, so
 * it is not a control-flow storage and must be left exactly as found. Kept as the counterweight to
 * the three above - together they pin both directions of the gate rather than only the accepting
 * one.
 */
test('object-invalid-1', () => {
  getResult(parseControlFlowStorage, false, join(root, 'object-invalid-1'))
})
