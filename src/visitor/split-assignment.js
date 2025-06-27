import * as t from '@babel/types'

function getInsertPath(path) {
  let insertPath = path
  let parent = insertPath.parentPath
  let needSplit = false
  while (parent && !parent.isBlockStatement() && !parent.isProgram()) {
    let valid = false
    if (parent.isAssignmentExpression()) {
      valid = true
      needSplit = true
    }
    if (parent.isCallExpression()) {
      if (insertPath.key === 'callee') {
        valid = true
        needSplit = true
      }
    }
    if (parent.isExpressionStatement()) {
      valid = true
    }
    if (parent.isIfStatement()) {
      if (insertPath.key === 'test') {
        valid = true
        needSplit = true
      }
    }
    if (parent.isMemberExpression()) {
      valid = true
      needSplit = true
    }
    if (parent.isVariableDeclarator()) {
      if (insertPath.key === 'init') {
        valid = true
        needSplit = true
      }
    }
    if (parent.isVariableDeclaration()) {
      if (insertPath.key === 0) {
        valid = true
        needSplit = true
      }
    }
    if (!valid) {
      return undefined
    }
    insertPath = parent
    parent = insertPath.parentPath
  }
  if (!needSplit) {
    return undefined
  }
  return insertPath
}

function procAssignment(path) {
  const insertPath = getInsertPath(path)
  if (!insertPath) {
    return
  }
  insertPath.insertBefore(t.expressionStatement(path.node))
  path.replaceWith(path.node.left)
  insertPath.scope.crawl()
}

/**
 * Split the AssignmentExpressions. For example:
 *
 * - In the test of IfStatement
 * - In the VariableDeclaration
 */
export default {
  AssignmentExpression: procAssignment,
}
