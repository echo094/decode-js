import * as t from '@babel/types'

/**
 * Distribute an assignment into both branches of a conditional:
 *
 *   r = t ? a : b   =>   t ? r = a : r = b
 *
 * On its own this is a wash. Its purpose is positional: a conditional in *value* position
 * cannot become an `if` statement, and this moves it into statement position where it can.
 * So it is a prerequisite for conditional-to-if conversion rather than a simplification in
 * its own right, and it is worth nothing unless that conversion runs after it.
 *
 * Only an `AssignmentExpression` parent is distributed. A `VariableDeclarator`
 * (`var r = t ? a : b`) is deliberately left alone: making that convertible means hoisting
 * the declaration out of its initializer, which changes where the binding is introduced.
 * That is a scope decision, not this visitor's.
 *
 * The assignment target is cloned into each branch rather than shared, so the two branches
 * do not alias one node.
 *
 * **Not safe for every target.** A target with its own side effects or an unstable value -
 * `obj[i++] = t ? a : b` - would have that effect duplicated into both branches. The guard is
 * that only one branch ever executes, so the effect still happens exactly once; what changes
 * is that it is now evaluated *after* the test rather than before it. Where the test reads
 * what the target expression writes, that is observable.
 */
export function createConvertConditionalAssign(onConvert) {
  return {
    ConditionalExpression: {
      exit(path) {
        const parent = path.parent
        if (!t.isAssignmentExpression(parent) || parent.right !== path.node) {
          return
        }
        const { test, consequent, alternate } = path.node
        const { operator, left } = parent
        path.parentPath.replaceWith(
          t.conditionalExpression(
            test,
            t.assignmentExpression(operator, t.cloneNode(left), consequent),
            t.assignmentExpression(operator, t.cloneNode(left), alternate),
          ),
        )
        if (onConvert) {
          onConvert()
        }
      },
    },
  }
}

export default createConvertConditionalAssign()
