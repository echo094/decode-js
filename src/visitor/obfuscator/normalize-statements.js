import traverse from '@babel/traverse'

import logger from '../../utility/logger.js'
import lintIfStatement from '../lint-if-statement.js'
import splitSequence from '../split-sequence.js'
import splitVariableDeclaration from '../split-variable-declaration.js'
import { createConvertConditionalAssign } from '../atomic/convert-conditional-assign.js'
import { createLintConditionalIf } from '../atomic/lint-conditional-if.js'
import { createLintLogicalIf } from '../atomic/lint-logical-if.js'
import { createSplitIfTestSequence } from '../atomic/split-if-test-sequence.js'

const debugLog = logger.debugLog

/**
 * Undo javascript-obfuscator's `Simplifying` stage: put statement-level control flow that was
 * packed into operators back into statements.
 *
 * That stage collapses a block's trailing run of statements into one comma expression, and
 * rewrites an `if` whose branches collapsed that way into `&&`, `?:`, or a de-braced branch.
 * Semantics are untouched; what it destroys is the statement boundary. Since every later
 * matcher navigates by statement boundaries, this runs first - it is a precondition for the
 * rest of the pipeline, not a cosmetic finish.
 *
 * **This file is scheduling and nothing else.** Every rewrite lives in a single-purpose
 * visitor under `src/visitor/`, each reusable on its own and each carrying its own safety
 * argument. What is obfuscator-specific is which of them run, in what order, and that they
 * run to a fixpoint - so that is all this file holds.
 */

/**
 * Run the normalization group to a fixpoint.
 *
 * **Iteration is required, not tidiness.** The rewrites unlock each other, because the
 * encoder nests its own outputs. `if (t) { x(); if (c) { a(); } else { b(); } }` is emitted as
 * `t && (x(), c ? a() : b());` - a conditional inside a sequence inside a `&&`. Nothing can
 * reach that conditional until the `&&` is reversed, which creates a statement; re-bracing
 * then gives that statement a block; only then can the sequence split; only then is the
 * conditional in statement position. Each round peels one layer, so the round count is the
 * nesting depth rather than a constant. Measured on that example: three rounds.
 *
 * **Order within a round is what makes one round do as much as possible**, and each step
 * feeds the next:
 *
 *   1. distribute assignments into conditionals   - turns value position into statement position
 *   2. re-brace `if` branches                     - gives 3 and 4 a statement list to insert into
 *   3. split sequences in statement/return        - exposes packed statements
 *   4. split sequences in `if` tests              - the position 3 does not cover
 *   5. reverse `&&` and `?:` in statement position - the reversals themselves
 *
 * Step 5 last is deliberate: it is what creates the brace-less branches and fresh statement
 * positions that step 2 and step 3 of the *next* round act on.
 *
 * `maxRounds` is a runaway guard, not a tuning knob. The loop exits as soon as a round
 * reverses nothing, and a file hitting the cap means either pathological nesting or a rewrite
 * oscillating - both worth knowing about, so it is reported.
 */
function normalizeStatements(ast, maxRounds = 8) {
  const total = {
    logical: 0,
    conditional: 0,
    assign: 0,
    sequence: 0,
    rounds: 0,
    cappedOut: false,
  }

  for (let round = 0; round < maxRounds; round += 1) {
    let changed = 0

    traverse(
      ast,
      createConvertConditionalAssign(() => (total.assign += 1)),
    )
    traverse(ast, lintIfStatement)
    traverse(ast, splitSequence)
    traverse(ast, splitVariableDeclaration)
    traverse(
      ast,
      createSplitIfTestSequence(() => (total.sequence += 1)),
    )
    traverse(
      ast,
      createLintConditionalIf(() => {
        total.conditional += 1
        changed += 1
      }),
    )
    traverse(
      ast,
      createLintLogicalIf(() => {
        total.logical += 1
        changed += 1
      }),
    )

    total.rounds = round + 1
    if (!changed) {
      break
    }
    if (round === maxRounds - 1) {
      total.cappedOut = true
    }
  }

  debugLog(
    `[obfuscatorx] normalize-statements: ${total.conditional} conditional, ` +
      `${total.logical} logical, ${total.assign} assign-distributed, ` +
      `${total.sequence} if-test sequences, in ${total.rounds} round(s)` +
      (total.cappedOut
        ? ' — HIT THE ROUND CAP, output may still be packed'
        : ''),
  )
  return total
}

export default normalizeStatements
