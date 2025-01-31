function pruneIfBranch(path) {
  function clear(path, toggle) {
    // 判定成立
    if (toggle) {
      path.replaceWith(path.node.consequent)
      return
    }
    // 判定不成立
    if (!path.node.alternate) {
      path.remove()
      return
    }
    path.replaceWith(path.node.alternate)
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
