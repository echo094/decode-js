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

function pruneIfBranch(path) {
  function clear(path, toggle) {
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
 * The code must be reloaded to update the references
 */
export default {
  IfStatement: pruneIfBranch,
  ConditionalExpression: pruneIfBranch,
}
