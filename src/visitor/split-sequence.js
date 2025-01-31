import * as t from '@babel/types'

function doSplit(insertPath, path) {
  const expressions = path.node.expressions
  const lastExpression = expressions.pop()
  while (expressions.length) {
    insertPath.insertBefore(t.expressionStatement(expressions.shift()))
  }
  path.replaceWith(lastExpression)
  insertPath.scope.crawl()
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
 */
export default {
  SequenceExpression: splitSequence,
}
