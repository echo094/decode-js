import { join } from 'path'
import { test } from 'vitest'
import traverse from '@babel/traverse'

import normalizeStatements from '#visitor/obfuscator/normalize-statements'
import decodeStringArray from '#visitor/obfuscator/string-array'
import normalizeConverting from '#visitor/obfuscator/normalize-converting'
import inlineControlFlowStorage from '#visitor/obfuscator/inline-control-flow-storage'
import calculateConstantExp from '#visitor/calculate-constant-exp'
import pruneIfBranch from '#visitor/prune-if-branch'
import { createUnflattenSwitchDispatch } from '#visitor/obfuscator/unflatten-switch-dispatch'
import unlockEnv from '#visitor/obfuscator/unlock-env'
import { getPipelineResult } from '../../helper.js'

/**
 * The one case that runs `unlock-env` on a tree the earlier passes have actually rewritten, in
 * memory, rather than on a re-parse of their output.
 *
 * **This is not a duplicate of `unlock-env.test.js`.** Those cases pin the pass's matchers, and
 * every one of them parses a pre-baked file — so no earlier pass has detached anything and the
 * tree is pristine by construction. That is precisely the state a real pipeline never has. Run on
 * one AST, this pass declined on every cell combining debug protection with control-flow
 * flattening, deleting the calls controller while leaving the guard, and the output threw a
 * `ReferenceError`. The corpus census and runtime equivalence both read clean beforehand, because
 * both were measured across a re-parse.
 *
 * So the input here is **raw encoder output** and the passes run inside the test. Writing the
 * intermediate to disk and reading it back would restore exactly the state that hid the defect.
 *
 * The input is `2.9.6` `all-on`, the smallest cell in the corpus that reproduces. The golden was
 * written by a builder that refuses unless the result **runs** and reproduces the pre-obfuscation
 * source's output, and unless no anti-tamper residue remains — a residue count alone cannot
 * separate "stripped" from "deleted too much", since both drive it to zero.
 *
 * **This case is coupled to the passes ahead of it on purpose.** An upstream change that moves
 * decoded output breaks it, and that is the point: the dependency is the thing under test.
 */
test('unlock-env strips debug protection on a tree the pipeline has rewritten', () => {
  // The pipeline's own order, and the fixpoint the U4+U5 group needs: storage inlining re-opens
  // Converting work that had already reported clean, so one sweep is not enough.
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
      const current = JSON.stringify(ast.program)
      if (current === previous) break
      previous = current
    }
  }

  getPipelineResult(
    [normalizeStatements, decodeStringArray, group, unlockEnv],
    true,
    join(__dirname, 'unlock-env-pipeline', 'debug-protection-flattened'),
  )
})
