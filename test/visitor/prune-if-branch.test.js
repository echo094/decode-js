import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import pruneIfBranch from '#visitor/prune-if-branch'

const root = join(__dirname, 'prune-if-branch')

/**
 * This visitor had no committed coverage at all, and four plugins consume it. The cases below
 * are written around the shape that made that worth fixing: javascript-obfuscator's dead-code
 * injection emits `if ('<rand5>' <===|!==> '<rand5>')` with the real block on the taken side, so
 * this visitor - together with constant folding - IS the whole reversal of that transform. All
 * four spellings the encoder can emit are covered, since the operator and whether the two strings
 * match are drawn independently.
 *
 * The last two cases are the ones that pin behaviour a naive implementation would get wrong:
 * a surviving branch is *spliced* into the parent statement list rather than planted whole, except
 * where it owns a lexical declaration that would change meaning if relocated.
 */

test('dci-taken-consequent: a true test splices the consequent, block and all', () => {
  getResult(pruneIfBranch, true, join(root, 'dci-taken-consequent'))
})

test('dci-taken-alternate: a false test splices the alternate', () => {
  getResult(pruneIfBranch, true, join(root, 'dci-taken-alternate'))
})

test('dci-not-equal-same: `!==` over two equal strings is false, so the alternate wins', () => {
  getResult(pruneIfBranch, true, join(root, 'dci-not-equal-same'))
})

test('falsy-no-alternate: a false test with no `else` removes the statement outright', () => {
  getResult(pruneIfBranch, true, join(root, 'falsy-no-alternate'))
})

test('conditional-expression: the same folding applies to a ternary', () => {
  getResult(pruneIfBranch, true, join(root, 'conditional-expression'))
})

test('lexical-branch-kept: a branch owning `let`/`const` keeps its block', () => {
  // Splicing these into the parent list would move block-scoped bindings into the enclosing
  // scope. The residue is one redundant nesting level, which delete-nested-blocks removes as a
  // separate cleanup - the trade is deliberate and this case is what pins it.
  getResult(pruneIfBranch, true, join(root, 'lexical-branch-kept'))
})

test('outer-reference-in-dead-branch: removing a branch leaves no stale reference behind', () => {
  // The case the other six cannot express, and the one a whole pipeline was defeated by: the dead
  // branch references a binding declared OUTSIDE it. The existing cases stay clean only because
  // their dead branches declare what they use, so the bindings leave with the branch.
  //
  // The output text is correct either way - `var keep = 1; return keep;` - so nothing about the
  // generated code can catch this. What it asserts is `keep`'s binding no longer holding a
  // referencePath into the subtree that was removed, which is the invariant every other visitor
  // here is already held to and which four consuming plugins have had to pay a reload for.
  getResult(pruneIfBranch, true, join(root, 'outer-reference-in-dead-branch'))
})

test('non-constant-test: a test that is not statically decidable is left alone', () => {
  // No golden: with `fix` false the helper compares against the input source, which is what
  // "left exactly as found" means for a declining case.
  getResult(pruneIfBranch, false, join(root, 'non-constant-test'))
})
