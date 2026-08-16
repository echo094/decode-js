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
  // Clone the target rather than re-using it. `path.node` has just been re-homed into the inserted
  // statement, so `path.node.left` is already live there; handing that same node object back here
  // would leave one node reachable at two positions - measured as two such nodes on one real
  // sample. That is not a bookkeeping wart a crawl can repair, because the tree really does hold it
  // twice: a later pass replacing both occurrences finds the second one's parent slot already
  // rewritten, resyncs to a null key, and throws inside Babel's validator.
  path.replaceWith(t.cloneNode(path.node.left, true))
  // Crawl from the program scope: a moved assignment can reference bindings in
  // an enclosing scope, so crawling only insertPath.scope would leave those
  // outer bindings with stale reference counts.
  insertPath.scope.getProgramParent().crawl()
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
