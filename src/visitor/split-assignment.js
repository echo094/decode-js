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

/**
 * Whether this traversal split anything, so the exit handler knows if a crawl is owed. Module-level
 * because a visitor object carries no per-run state; `Program.enter` resets it per run.
 */
let splitSomething = false

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
  splitSomething = true
}

/**
 * Split the AssignmentExpressions. For example:
 *
 * - In the test of IfStatement
 * - In the VariableDeclaration
 *
 * **The crawl restores an invariant this rewrite breaks**: after a pass, the scope information
 * Babel has cached should equal what a fresh parse of that pass's own output would produce. The
 * moved assignment is re-homed by `insertBefore`, and re-homing a subtree registers its references
 * a second time - so a binding can end up listing the same live node twice, with nothing detached.
 * A later consumer that gates a deletion on "have I resolved every reference to this binding" then
 * passes that check while a live reference goes unhandled.
 *
 * **It must be program-scoped**, because a moved assignment can reference bindings in an enclosing
 * scope and crawling only `insertPath.scope` would leave those outer bindings inconsistent - the
 * defect this file was fixed for once already.
 *
 * **Once per traversal rather than once per split**, which is the only thing that changed since:
 * the previous form crawled the whole program on every rewrite, so a sample with many splits paid
 * for the entire program each time. Deferring is safe because nothing in this pass reads scope
 * state - `getInsertPath` walks `parentPath` and tests node types and keys, never a binding - so no
 * later invocation in the same traversal depends on the crawl having already run.
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
  AssignmentExpression: procAssignment,
}
