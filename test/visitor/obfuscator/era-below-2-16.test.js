import { join } from 'path'
import { test } from 'vitest'
import traverse from '@babel/traverse'
import generate from '@babel/generator'

import normalizeStatements from '#visitor/obfuscator/normalize-statements'
import decodeStringArray from '#visitor/obfuscator/string-array'
import normalizeConverting from '#visitor/obfuscator/normalize-converting'
import inlineControlFlowStorage from '#visitor/obfuscator/inline-control-flow-storage'
import calculateConstantExp from '#visitor/calculate-constant-exp'
import pruneIfBranch from '#visitor/prune-if-branch'
import { createUnflattenSwitchDispatch } from '#visitor/obfuscator/unflatten-switch-dispatch'
import unlockEnv from '#visitor/obfuscator/unlock-env'
import { getPipelineResult } from '../../helper.js'

const root = join(__dirname, 'era-below-2-16')

/**
 * One case per string-array era below `2.16.0`, so those eras stop being measured only by a corpus
 * that can be rebuilt.
 *
 * **Why these four and not one per column.** Seven corpus columns sit below `2.16.0`, but they
 * carry only four distinct string-array era combinations - the wrapper moves at `2.12.0` and again
 * at `2.15.4`, the rotator at `2.10.0`, and the scope wrapper not at all in this range:
 *
 *   2.9.6    wrapper var-fn-expression, rotate counter-loop
 *   2.11.1   wrapper var-fn-expression, rotate compare-loop
 *   2.15.3   wrapper fn-declaration
 *   2.15.5   wrapper self-replacing
 *
 * A fifth column would pin a shape one of these already covers.
 *
 * **These are pipeline-level rather than plugin-level, and only one of the two original reasons
 * still holds.** The existing `obfuscator` plugin throws below the `2.16.0` boundary, so it cannot
 * decode any of them - that stands. `obfuscatorx` now has an entry and could drive them, so what
 * keeps them here is a choice: running the passes directly is what lets a case assert the
 * composition rather than the entry, and the entry's own end-to-end coverage lives in
 * `test/obfuscatorx/`, which carries `2.9.6` as one of its two cases.
 * Pipeline level is the only place these eras are reachable at all.
 *
 * **The input is raw encoder output and the passes run here, on one AST.** Writing an intermediate
 * to disk and reading it back restores exactly the state a real pipeline never has - the failure
 * that cost a whole unit's certification once already.
 *
 * **What the goldens show, and it is the point of committing all four.** Three of the four are
 * byte-identical apart from one renamed identifier, which `renameIdentifiers` makes irreversible
 * by design. So four different encoder eras decode to the same program: the collapse claim as an
 * artifact rather than an argument. `2.9.6` and `2.11.1` coincide exactly, their generated name
 * landing identically under the corpus's pinned seed.
 *
 * Each golden was written by a builder that refuses unless the decoded output **runs** and
 * reproduces the pre-obfuscation source's own output, and unless the source itself reproduces it -
 * so a golden cannot be certified against a broken expectation. `<name>.src.js` is kept beside each
 * pair so the decoded-to-source size ratio stays computable; nothing in the suite reads it.
 */

// The pipeline's own order. The fixpoint is required rather than tidy: storage inlining re-opens
// Converting work that has already reported clean, so one sweep is not enough.
const group = (ast) => {
  let previous = null
  for (let round = 0; round < 8; round++) {
    normalizeConverting(ast)
    traverse(ast, calculateConstantExp)
    traverse(ast, inlineControlFlowStorage)
    traverse(ast, calculateConstantExp)
    traverse(ast, pruneIfBranch)
    traverse(
      ast,
      createUnflattenSwitchDispatch(() => {}),
    )
    const cur = generate(ast, { compact: true }).code
    if (cur === previous) break
    previous = cur
  }
}

const passes = [normalizeStatements, decodeStringArray, group, unlockEnv]

test('2.9.6 — wrapper var-fn-expression, rotate counter-loop', () => {
  getPipelineResult(passes, true, join(root, '2.9.6-baseline-strings'))
})

test('2.11.1 — wrapper var-fn-expression, rotate compare-loop', () => {
  getPipelineResult(passes, true, join(root, '2.11.1-baseline-strings'))
})

test('2.15.3 — wrapper fn-declaration', () => {
  getPipelineResult(passes, true, join(root, '2.15.3-baseline-strings'))
})

test('2.15.5 — wrapper self-replacing', () => {
  getPipelineResult(passes, true, join(root, '2.15.5-baseline-strings'))
})
