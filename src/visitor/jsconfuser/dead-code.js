import * as t from '@babel/types'

import safeFunc from '../../utility/safe-func.js'
import bindingDef from '../../utility/binding-def.js'
const safeDeleteNode = safeFunc.safeDeleteNode
const resolveBindingFunction = bindingDef.resolveBindingFunction

/**
 * Matches PredicateGen's dummy-function anchor - see opaque-predicates.js's
 * `isDummyPredicateFn` for the same test, kept independent here since DeadCode's
 * guard is matched and removed as one self-contained unit, not folded through the
 * shared calculate-constant-exp.js/prune-if-branch.js pipeline.
 */
function isDummyPredicateFn(binding) {
  if (!binding) {
    return false
  }
  const fnPath = resolveBindingFunction(binding)
  if (!fnPath || fnPath.node.body.body.length !== 0) {
    return false
  }
  return binding.referencePaths.every(
    (ref) =>
      ref.key === 'right' &&
      ref.parentPath &&
      t.isBinaryExpression(ref.parentPath.node, { operator: 'in' }),
  )
}

/**
 * The identifier a call actually reaches, unwrapping the `(1, f)()` spelling - the same call
 * with `this` pinned to undefined.
 *
 * The wrapper is the encoder's: ControlFlowFlattening rewrites a direct call's callee into a
 * member expression and wraps it, `X.Y.Z()` -> `(1, X.Y.Z)()`, precisely so the member call
 * keeps its receiver. What reaches this matcher is not that shape though - it is
 * `(1, <bare Identifier>)()`, which no encoder stage ever emits, and which exists because our
 * own ControlFlowFlattening decode resolves the member expression back to a plain identifier
 * without removing the wrapper that was only there for it.
 *
 * Stepping out to the sequence expression is only sound while what it discards is inert, so
 * every expression before the callee has to be a literal; anything else is a side effect that
 * removing the call would drop.
 */
function calleeIdentifier(call) {
  const callee = call.callee
  if (t.isIdentifier(callee)) {
    return callee
  }
  if (
    t.isSequenceExpression(callee) &&
    callee.expressions.slice(0, -1).every((e) => t.isLiteral(e))
  ) {
    const last = callee.expressions[callee.expressions.length - 1]
    return t.isIdentifier(last) ? last : null
  }
  return null
}

/**
 * Matches DeadCode's guard (`transforms/deadCode.ts`): a never-taken
 * `if ("randomProp" in dummyFn) { deadFnName() }` wrapping a hoisted dead-code
 * helper function. The predicate is always false (the dummy function never gains
 * own properties), so the whole guard - and the helper it calls, once
 * unreferenced - can be removed outright.
 *
 * The consequent is allowed to be empty as well as to hold the call. Once the predicate is
 * established as PredicateGen's, the branch is unreachable whatever is left inside it, and an
 * earlier pass having already removed the call is not a reason to keep the `if` around it.
 */
function matchDeadCodeGuard(path) {
  const { test, consequent, alternate } = path.node
  if (alternate) {
    return null
  }
  if (
    !t.isBinaryExpression(test) ||
    test.operator !== 'in' ||
    !t.isStringLiteral(test.left) ||
    !t.isIdentifier(test.right)
  ) {
    return null
  }
  const dummyBinding = path.scope.getBinding(test.right.name)
  if (!isDummyPredicateFn(dummyBinding)) {
    return null
  }

  const common = {
    dummyFnName: test.right.name,
    dummyFnScope: dummyBinding.scope,
  }

  const body = t.isBlockStatement(consequent) ? consequent.body : [consequent]
  if (body.length === 0) {
    return common
  }
  if (body.length !== 1 || !t.isExpressionStatement(body[0])) {
    return null
  }
  const call = body[0].expression
  if (!t.isCallExpression(call) || call.arguments.length !== 0) {
    return null
  }
  const callee = calleeIdentifier(call)
  if (!callee) {
    return null
  }
  // Resolved from the binding rather than from `binding.path` alone: by the time this pass
  // runs the helper is as often `var X;` + `X = function () {…}` as the FunctionDeclaration
  // the encoder emitted, and reading only the declaration shape left the guard - and the
  // whole helper body behind it - in place on most of a `high` corpus.
  const deadFnBinding = path.scope.getBinding(callee.name)
  if (!resolveBindingFunction(deadFnBinding)) {
    return null
  }

  return {
    ...common,
    deadFnName: callee.name,
    deadFnScope: deadFnBinding.scope,
  }
}

export default function deDeadCodeInit() {
  // The dead function can live in any block (Program or any function body,
  // per `Block: exit` on the encode side), so each candidate's own governing
  // scope has to be captured at match time - a nested one isn't reachable
  // from the Program's own scope at `Program: exit`.
  const cleanupCandidates = []

  return {
    Program: {
      exit() {
        for (const { name, scope } of cleanupCandidates) {
          scope.crawl()
          const binding = scope.getBinding(name)
          // Same resolution as the matcher, for the same reason - and `safeDeleteNode`
          // removes a declarator plus its separate write as readily as a declaration.
          if (binding && resolveBindingFunction(binding)) {
            safeDeleteNode(name, binding.path)
          }
        }
      },
    },

    IfStatement(path) {
      const match = matchDeadCodeGuard(path)
      if (!match) {
        return
      }
      // An emptied-out guard has no helper left to collect - only the dummy anchor.
      if (match.deadFnName) {
        cleanupCandidates.push({
          name: match.deadFnName,
          scope: match.deadFnScope,
        })
      }
      cleanupCandidates.push({
        name: match.dummyFnName,
        scope: match.dummyFnScope,
      })
      path.remove()
    },
  }
}
