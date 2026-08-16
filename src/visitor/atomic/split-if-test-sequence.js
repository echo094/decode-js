import * as t from '@babel/types'

/**
 * Hoist all but the last expression out of a sequence used as an `if` test:
 *
 *   if ((a, b)) …   =>   a; if (b) …
 *
 * A sequence in the test position hides every expression but the last from statement-level
 * reading, and the hidden ones are frequently the interesting part - assignments an obfuscator
 * folded into the test to get them off their own line.
 *
 * This is the gap in `split-sequence.js`, which covers a sequence in `ExpressionStatement`,
 * `ReturnStatement` and first-`VariableDeclarator` position but not this one. The two are
 * complementary and are meant to run together.
 *
 * **Requires the `if` to be in a statement list**, because the reversal inserts siblings
 * before it. An `if` that is itself an unbraced branch of another `if` has nowhere to insert;
 * it is left alone here and becomes eligible once `lint-if-statement.js` has given it a block,
 * which is why these two want to run in the same loop rather than once each.
 *
 * Order within the sequence is preserved, and the hoisted expressions still evaluate before
 * the test - so this is safe even when they have side effects the test depends on.
 */
export function createSplitIfTestSequence(onSplit) {
  return {
    IfStatement: {
      enter(path) {
        const test = path.node.test
        if (!t.isSequenceExpression(test) || !path.inList) {
          return
        }
        const rest = test.expressions.slice()
        const last = rest.pop()
        path.insertBefore(
          rest.map((expression) => t.expressionStatement(expression)),
        )
        path.get('test').replaceWith(last)
        if (onSplit) {
          onSplit()
        }
      },
    },
  }
}

export default createSplitIfTestSequence()
