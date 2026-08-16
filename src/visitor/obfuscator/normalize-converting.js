import generator from '@babel/generator'
import traverse from '@babel/traverse'

import logger from '../../utility/logger.js'
import calculateConstantExp from '../calculate-constant-exp.js'
import mergeObject from '../merge-object.js'
import { createCollapsePropertyShorthand } from '../atomic/collapse-property-shorthand.js'
import { createUncomputeMember } from '../atomic/uncompute-member.js'
import { createUncomputePropertyKey } from '../atomic/uncompute-property-key.js'

const debugLog = logger.debugLog

/**
 * Undo javascript-obfuscator's `Converting` stage: put every re-spelled literal, property name
 * and object literal back into the form it was written in.
 *
 * That stage holds eleven transformers, and ten of them rewrite a single node in place - a
 * boolean into `!![]`, a number into hexadecimal or an arithmetic tree, a property name into a
 * computed string, a string into a chain of chunks. None of those rewrites is specific to this
 * obfuscator, so none of the reversals lives here: they are plain visitors under `src/visitor/`
 * that any plugin may compose.
 *
 * **This file is scheduling and nothing else**, which is the same division
 * `normalize-statements.js` already draws. What is obfuscator-specific is not how to fold a
 * constant - it is knowing that these particular reversals unlock each other, in which order,
 * and that the group has to run to a fixpoint.
 */

/**
 * Strip the `raw` spelling from numeric literals.
 *
 * `NumberLiteralTransformer` is the one member of its stage that changes no AST node at all: it
 * writes the literal's `raw` and leaves `value` untouched. So there is nothing to match and
 * nothing to fold - discarding `extra` *is* the entire reversal, and a generator then prints the
 * value in decimal.
 *
 * **Scoped to numbers on purpose.** String literals also carry a `raw`, and theirs holds the
 * escape spelling that the `Finalizing` stage produced; that is a different transform with its
 * own reversal, so this pass leaves string literals alone rather than quietly absorbing it.
 */
function stripNumericRaw(ast) {
  let count = 0
  traverse(ast, {
    NumericLiteral: ({ node }) => {
      if (node.extra) {
        delete node.extra
        count++
      }
    },
  })
  return count
}

/**
 * Run the group to a fixpoint.
 *
 * **Iteration is required rather than tidy, and it is measurable.** The reversals expose each
 * other's input, because the encoder's own transforms compose: with `splitStrings` on, a
 * property name is emitted as a *chain* - `o['\x66\x6c' + '\x61\x67']` - so it is not a string
 * literal at all until the chain has been folded, and a member-un-computing pass looking for a
 * string key finds nothing. Measured on one corpus cell (`2.19.0/objects__all-on.js`): the
 * count of un-computable member reads is 33 before folding and 365 after. So a pass that ran
 * once, in any order, would leave roughly nine tenths of that shape behind.
 *
 * **Order within a round, and what each step feeds:**
 *
 *   1. strip numeric `raw`        - no dependencies; cheapest first
 *   2. fold constant expressions  - turns `!![]` into `true`, arithmetic trees into numbers, and
 *                                   chunk chains into whole strings, which is what creates the
 *                                   string keys steps 3 and 4 need
 *   3. un-compute member reads    - `o["foo"]` into `o.foo`
 *   4. un-compute property keys   - `["foo"](){}` into `foo(){}`
 *   5. merge extracted objects    - reassembles `var t = {}; t.a = 1; ...` into one literal,
 *                                   which is easiest once 3 and 4 have made the writes dotted
 *   6. collapse shorthand         - last, because it only ever acts on what 4 produced
 *
 * **One ordering here is a convenience, not a constraint, and it is recorded as such.** Step 5
 * accepts both a string and an identifier property, so it does not in fact require steps 3 and 4
 * to have run. It is scheduled after them because the merged output then reads dotted, not
 * because the reverse order fails. Anything asserting a stricter dependency should reverse the
 * two and measure, rather than inherit this comment.
 *
 * `maxRounds` is a runaway guard rather than a tuning knob: the loop exits as soon as a round
 * changes nothing, and hitting the cap means either pathological nesting or two rewrites
 * oscillating, both of which are worth reporting.
 */
export default function normalizeConverting(ast, maxRounds = 10) {
  // Termination is decided by comparing the whole tree between rounds, not by counting what the
  // rewrites report. Two of the six - `calculateConstantExp` and `mergeObject` - are shared
  // visitors with no change signal to offer, and §3.3 forbids editing a shared visitor to add
  // one. Counting only the passes that *can* report would exit a round early whenever those two
  // were the only ones to fire, silently leaving their consequences unprocessed. A generated
  // comparison costs one serialization per round and cannot be wrong about whether the tree
  // moved.
  let previous = null
  let rounds = 0
  for (; rounds < maxRounds; rounds++) {
    const noted = { atomic: 0 }
    const bump = () => {
      noted.atomic++
    }

    stripNumericRaw(ast)
    traverse(ast, calculateConstantExp)
    traverse(ast, createUncomputeMember(bump))
    traverse(ast, createUncomputePropertyKey(bump))
    traverse(ast, mergeObject)
    traverse(ast, createCollapsePropertyShorthand(bump))

    const current = generator(ast, { compact: true }).code
    if (current === previous) {
      break
    }
    previous = current
  }
  if (rounds >= maxRounds) {
    debugLog(`normalize-converting: hit the ${maxRounds}-round cap`)
  }
  return ast
}
