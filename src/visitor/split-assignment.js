import * as t from '@babel/types'

/**
 * The operands of `parent` evaluated before its child at `key`; hoisting the child's assignment
 * moves it ahead of them.
 *
 * - `x = <child>` only resolves `x`; `x op= <child>` reads `x` first.
 * - `o[k] = <child>` evaluates `o` and `k` first; `o[k] op= <child>` also reads `o[k]`.
 * - `<obj>[<child>]` evaluates `<obj>` first.
 */
function earlierOperands(parent, key) {
  if (parent.isAssignmentExpression() && key === 'right') {
    const left = parent.get('left')
    const plain = parent.node.operator === '='
    if (left.isIdentifier()) {
      return plain ? [] : [left]
    }
    if (left.isMemberExpression() && plain) {
      return left.node.computed
        ? [left.get('object'), left.get('property')]
        : [left.get('object')]
    }
    return [left]
  }
  if (parent.isMemberExpression() && key === 'property') {
    return [parent.get('object')]
  }
  return []
}

/**
 * Whether evaluating `operand` before or after the assignment `asg` gives the same result with the
 * same effects: a literal, `this`, or a variable other than the target that the assignment cannot
 * write (its right side is pure, or the variable is never reassigned). Anything else - a member
 * read may run a getter, a call anything - is not.
 */
function isInert(operand, asg, rightIsPure) {
  if (operand.isIdentifier()) {
    if (operand.node.name === asg.node.left.name) {
      return false
    }
    if (rightIsPure) {
      return true
    }
    return operand.scope.getBinding(operand.node.name)?.constant === true
  }
  return (
    operand.isStringLiteral() ||
    operand.isNumericLiteral() ||
    operand.isBooleanLiteral() ||
    operand.isNullLiteral() ||
    operand.isBigIntLiteral() ||
    operand.isThisExpression()
  )
}

/**
 * The statement to insert the assignment `path` before, or undefined to leave it in place.
 *
 * The split leaves `left` behind as the value and runs the assignment before everything else in the
 * statement, so it is only equivalent when:
 *
 * - `left` is an Identifier: reading it back has no effect and yields the assigned value. A member
 *   target would evaluate its object and key a second time (`var e = a[a.length] = v`).
 * - Every operand that ran before the assignment is inert to it (`a[i] = i = 1` would index with
 *   the new `i`).
 *
 * Anything else is left in place: a split that kept behaviour would need a temporary, which this
 * pass does not introduce.
 */
function getInsertPath(path) {
  if (!t.isIdentifier(path.node.left)) {
    return undefined
  }
  const rightIsPure = path.scope.isPure(path.node.right)
  let insertPath = path
  let parent = insertPath.parentPath
  let needSplit = false
  while (parent && !parent.isBlockStatement() && !parent.isProgram()) {
    for (const operand of earlierOperands(parent, insertPath.key)) {
      if (!isInert(operand, path, rightIsPure)) {
        return undefined
      }
    }
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
