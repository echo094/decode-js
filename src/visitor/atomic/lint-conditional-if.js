import * as t from '@babel/types'

/**
 * Put a conditional used as a statement back into an `if`:
 *
 *   test ? a : b;          =>   if (test) a; else b;
 *   return test ? a : b;   =>   if (test) return a; else return b;
 *
 * Obfuscators use the ternary to pack a two-branch `if` onto one line. Both forms restore a
 * statement boundary, and each branch keeps the statement kind of the site it replaces -
 * which is what makes the return form safe, since two `return`s preserve the function's
 * completion where two expression statements would silently drop it.
 *
 * **The position gate is the whole safety argument**, and it matters more here than for the
 * logical form because conditionals in value position are extremely common. The node must be
 * the *entire* expression of an `ExpressionStatement`, or the *entire* argument of a
 * `ReturnStatement`. Everything else is a value: a declarator initializer, a call argument,
 * an operand, an arrow's concise body, a property value. Measured over one 432-sample corpus
 * of obfuscated output, this gate matched 435 sites and declined 895 value-position
 * conditionals; without it every one of those 895 would have been rewritten wrongly.
 *
 * A declined site is skipped and traversal continues. Nothing here stops the traversal - on
 * obfuscated input the first declined site typically arrives long before the first match, so
 * halting would abort the pass before it did any work.
 *
 * **A conditional in value position is often one rewrite away from being convertible.** See
 * `convert-conditional-assign.js`, which distributes an assignment into both branches to move
 * the conditional into statement position; run it before this one to reach those sites.
 */
export function createLintConditionalIf(onReverse) {
  // Whether this traversal rewrote anything, so `Program.exit` knows if a crawl is owed. Closure
  // state rather than module-level, since each factory call is its own visitor instance.
  let rewroteSomething = false
  return {
    // The crawl restores an invariant this rewrite breaks: after a pass, the scope information
    // Babel has cached should equal what a fresh parse of that pass's own output would produce.
    // `replaceWith` is handed an `IfStatement` built from the conditional's own `test`,
    // `consequent` and `alternate`, and it registers those reused subtrees' references a second
    // time - the same live node listed twice in `binding.referencePaths`, with nothing detached.
    // Measured on one real sample: 14 duplicate entries, 1462 recorded references against 1448
    // real ones. A later consumer gating a deletion on "have I resolved every reference" then
    // passes that check while a live reference goes unhandled.
    //
    // Program-scoped and once per traversal: crawling a narrower scope *adds* duplicates, by
    // appending to outer-scope bindings that already hold those references. Gated because a crawl
    // is only owed when something moved, and it cannot change the tree.
    Program: {
      enter() {
        rewroteSomething = false
      },
      exit(path) {
        if (rewroteSomething) path.scope.crawl()
      },
    },
    ConditionalExpression: {
      exit(path) {
        const { test, consequent, alternate } = path.node
        const parent = path.parentPath

        if (
          parent.isExpressionStatement() &&
          parent.node.expression === path.node
        ) {
          parent.replaceWith(
            t.ifStatement(
              test,
              t.expressionStatement(consequent),
              t.expressionStatement(alternate),
            ),
          )
          rewroteSomething = true
          if (onReverse) {
            onReverse()
          }
          return
        }

        if (parent.isReturnStatement() && parent.node.argument === path.node) {
          parent.replaceWith(
            t.ifStatement(
              test,
              t.returnStatement(consequent),
              t.returnStatement(alternate),
            ),
          )
          rewroteSomething = true
          if (onReverse) {
            onReverse()
          }
        }
      },
    },
  }
}

export default createLintConditionalIf()
