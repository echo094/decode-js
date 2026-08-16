import * as t from '@babel/types'

/**
 * Put a short-circuit used as a statement back into an `if`:
 *
 *   test && body;   =>   if (test) body;
 *
 * Obfuscators use this to pack a branch onto one line. It is semantics-preserving in both
 * directions at statement level, where the operator's value is discarded either way, and it
 * restores a statement boundary that every statement-level matcher navigates by.
 *
 * **The position gate is the whole safety argument.** The parent must be the
 * `ExpressionStatement` and the node must be its entire expression. That single test excludes
 * every position where the operator is carrying a value rather than a branch - an `if`,
 * `while` or `for` test, an arrow function's concise body, a declarator initializer, a call
 * argument, an operand of an enclosing operator. A site that fails the gate is left alone and
 * traversal continues; nothing here stops the traversal, because on obfuscated input the
 * declined sites vastly outnumber the matched ones and halting on the first would abort the
 * pass before it normalized anything.
 *
 * **Only the outermost `&&` of a chain qualifies**, and that is what makes a chain come out
 * right rather than shredded. `if (c && d) { a(); }` is emitted as `c && d && a();`, which
 * parses as `(c && d) && a()`; reversing the outermost alone recovers `if (c && d) a();`.
 * A nested `&&`'s parent is the `LogicalExpression` above it, so it is never a candidate.
 *
 * **`||` is not handled.** It has no equivalent single-branch `if` form - `a || b` runs `b`
 * when `a` is *falsy*, so the reversal would need a negated test, and a negation this pass
 * introduced is a shape no encoder emitted. Left alone.
 */
export function createLintLogicalIf(onReverse) {
  return {
    LogicalExpression: {
      exit(path) {
        if (path.node.operator !== '&&') {
          return
        }
        const stmt = path.parentPath
        if (
          !stmt.isExpressionStatement() ||
          stmt.node.expression !== path.node
        ) {
          return
        }
        const { left, right } = path.node
        stmt.replaceWith(t.ifStatement(left, t.expressionStatement(right)))
        if (onReverse) {
          onReverse()
        }
      },
    },
  }
}

export default createLintLogicalIf()
