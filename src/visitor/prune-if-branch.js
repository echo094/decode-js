/**
 * A statement that owns a block-scoped binding, so the `{ ... }` around it is load-bearing.
 * `FunctionDeclaration` counts: it is block-scoped under strict mode, and the sloppy-mode
 * web-compat hoisting out of a block is not something to re-decide here.
 */
function declaresLexically(stmt) {
  return (
    (stmt.type === 'VariableDeclaration' && stmt.kind !== 'var') ||
    stmt.type === 'ClassDeclaration' ||
    stmt.type === 'FunctionDeclaration'
  )
}

/**
 * Put a surviving branch in the `if`'s place, splicing a `BlockStatement` into the parent
 * statement list instead of leaving the block itself behind.
 *
 * A bare `{ ... }` is transparent unless it declares something lexically, but it is not
 * invisible to a matcher: `deFlatten`'s `matchWrapper` reads the wrapper's *last statement*
 * and requires a `return <call>`, so a pruned `if` around that return failed the match and
 * left an entire Flatten scope-object layer undecoded. Only splice where it is sound - in a
 * statement list, with no block-scoped declaration to relocate.
 */
function replaceWithBranch(path, branch) {
  if (
    branch.type !== 'BlockStatement' ||
    !path.inList ||
    branch.body.some(declaresLexically)
  ) {
    path.replaceWith(branch)
    return
  }
  if (branch.body.length === 0) {
    path.remove()
    return
  }
  path.replaceWithMultiple(branch.body)
}

/**
 * Whether this traversal detached anything, so the exit handler knows if a crawl is owed.
 *
 * Module-level because a visitor object carries no per-run state. Safe because every consumer
 * invokes this as a standalone, synchronous `traverse(ast, pruneIfBranch)` and `Program.enter`
 * resets it at the start of each run.
 */
let detachedSomething = false

function pruneIfBranch(path) {
  function clear(path, toggle) {
    detachedSomething = true
    // 判定成立
    if (toggle) {
      replaceWithBranch(path, path.node.consequent)
      return
    }
    // 判定不成立
    if (!path.node.alternate) {
      path.remove()
      return
    }
    replaceWithBranch(path, path.node.alternate)
  }
  // 判断判定是否恒定
  const test = path.node.test
  const types = ['StringLiteral', 'NumericLiteral', 'BooleanLiteral']
  if (test.type === 'BinaryExpression') {
    if (
      types.indexOf(test.left.type) !== -1 &&
      types.indexOf(test.right.type) !== -1
    ) {
      const left = JSON.stringify(test.left.value)
      const right = JSON.stringify(test.right.value)
      clear(path, eval(left + test.operator + right))
    }
  } else if (types.indexOf(test.type) !== -1) {
    clear(path, eval(JSON.stringify(test.value)))
  }
}

/**
 * Prune the branch if the test is constant
 *
 * Removing a branch detaches its subtree, and Babel leaves every *other* binding's
 * `referencePaths` pointing into it. Such a reference reports `removed === false` and its cached
 * parent chain still reaches a Program, so only node reachability can see the difference — which
 * is why this went unnoticed long enough to be documented as a caller's problem rather than
 * repaired here. It is not a caller's problem. Of the four consuming plugins, three re-parse the
 * whole program immediately after calling this visitor (`// 刷新代码`) — the same repair written
 * out three times — and the fourth does not re-parse at all, so it carried the exposure with
 * nothing answering for it. A fifth consumer, composing on a single AST, inherited stale bindings
 * and emitted code that threw.
 *
 * So the invariant is restored where it is broken: one `scope.crawl()` on the way out, and only
 * when something was actually detached. A crawl cannot change the tree — it rebuilds cached scope
 * information — so this is invisible to output and costs nothing on a traversal that pruned
 * nothing.
 */
export default {
  Program: {
    enter() {
      detachedSomething = false
    },
    exit(path) {
      if (detachedSomething) path.scope.crawl()
    },
  },
  IfStatement: pruneIfBranch,
  ConditionalExpression: pruneIfBranch,
}
