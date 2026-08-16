import * as t from '@babel/types'

/**
 * Whether this traversal split anything, so the exit handler knows if a crawl is owed. Module-level
 * because a visitor object carries no per-run state; `Program.enter` resets it per run.
 */
let splitSomething = false

function doSplit(insertPath, path) {
  const expressions = path.node.expressions
  const lastExpression = expressions.pop()
  while (expressions.length) {
    insertPath.insertBefore(t.expressionStatement(expressions.shift()))
  }
  path.replaceWith(lastExpression)
  splitSomething = true
}

function splitSequence(path) {
  let { parentPath } = path
  if (parentPath.isVariableDeclarator()) {
    // Skip if it's not the first VariableDeclarator
    if (parentPath.key !== 0) {
      return
    }
    let insertPath = parentPath.parentPath
    // Skip if the container of the VariableDeclaration is not an array
    if (!insertPath.listKey) {
      return
    }
    doSplit(insertPath, path)
    return
  }
  if (parentPath.isReturnStatement()) {
    if (!parentPath.listKey) {
      return
    }
    doSplit(parentPath, path)
    return
  }
  if (parentPath.isExpressionStatement()) {
    if (!parentPath.listKey) {
      return
    }
    doSplit(parentPath, path)
    return
  }
}

/**
 * The sequenceExpressions inside certain statements are splitted if possible:
 *
 * - VariableDeclarator
 * - ReturnStatement
 * - ExpressionStatement
 *
 * **The crawl restores an invariant this rewrite breaks**: after a pass, the scope information
 * Babel has cached should equal what a fresh parse of that pass's own output would produce.
 * `insertBefore` and `replaceWith` are both handed expressions lifted out of the existing sequence,
 * and re-homing a subtree registers its references a second time - so `binding.referencePaths`
 * lists the same live node twice and `binding.references` counts it twice, with nothing detached.
 * Measured on one real sample: 32 duplicate entries, 1480 recorded references against 1448 real
 * ones. A later consumer that gates a deletion on "have I resolved every reference" then passes
 * that check while a live reference goes unhandled, and deletes a declaration still in use.
 *
 * It replaces a `scope.crawl()` that used to run inside `doSplit`, which was wrong twice over: it
 * fired once per split rather than once per traversal, and it was scoped to the insertion point's
 * scope rather than the program's - and crawling a narrower scope *adds* duplicates, by appending
 * to outer-scope bindings that already hold those references.
 */
export default {
  Program: {
    enter() {
      splitSomething = false
    },
    exit(path) {
      if (splitSomething) path.scope.crawl()
    },
  },
  SequenceExpression: splitSequence,
}
