import * as t from '@babel/types'

import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode
import bindingDef from '../../utility/binding-def.js'
const resolveBindingFunction = bindingDef.resolveBindingFunction

/**
 * Matches PredicateGen's dummy-function anchor (`utils/PredicateGen.ts`): a function
 * created lazily, once per `PredicateGen` instance, and referenced only by `in` checks
 * that are guaranteed to read false since it never gains any own properties.
 *
 * **The reference set is what makes the check sound, not the shape.** `"p" in X` reads
 * false exactly while nothing adds `p` to `X`, so the test is that every reference to the
 * binding is an `in` test's own right operand - never a member base, a callee, or a value
 * handed somewhere that could write to it. The encoder's own spelling (a niladic, empty
 * top-level `FunctionDeclaration`) was only ever a proxy for that, and it is a proxy this
 * decoder's own passes break twice over: `control-flow-graph.js` reconstructs the anchor as
 * `var X;` + `X = function (...r) {}`, so `binding.path` is an init-less declarator and the
 * arity is a rest parameter *we* added. The declaration is therefore read through
 * `resolveBindingFunction`, and the arity is not consulted at all - an empty body's
 * own-property set does not depend on its parameter list.
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
 * Matches `PredicateGen.generateTrueExpression`'s `!("randomProp" in dummyFn)` -
 * OpaquePredicates' only use of PredicateGen (always the true form, wrapping
 * `if`/ternary/`switch case`/`return` tests with `PREDICATE && test`).
 */
function matchPredicateGenTrue(path) {
  const node = path.node
  if (node.operator !== '!') {
    return null
  }
  const inner = node.argument
  if (
    !t.isBinaryExpression(inner) ||
    inner.operator !== 'in' ||
    !t.isStringLiteral(inner.left) ||
    !t.isIdentifier(inner.right)
  ) {
    return null
  }
  const dummyBinding = path.scope.getBinding(inner.right.name)
  if (!isDummyPredicateFn(dummyBinding)) {
    return null
  }
  return { dummyFnName: inner.right.name }
}

/**
 * Current (`fbe3449` onward, verified against the pinned commit): OpaquePredicates
 * folds down to `true`, since the dummy function it's tested against never carries
 * the checked-for property. The `true && test` this leaves behind is unwrapped by
 * the shared `calculate-constant-exp.js`'s LogicalExpression fold, and the
 * `if(true){real}else{fake}` the ReturnStatement variant leaves behind is unwrapped
 * by `prune-if-branch.js` - both already wired into the pipeline right after this.
 * The now-unreferenced dummy function itself is cleaned up here, at `Program: exit`.
 */
function dePredicateGenInit() {
  const cleanupCandidates = new Set()

  return {
    Program: {
      exit(path) {
        path.scope.crawl()
        for (const name of cleanupCandidates) {
          const binding = path.scope.getBinding(name)
          // Same resolution as the matcher: the anchor is as often `var X;` +
          // `X = function (...r) {}` as the declaration the encoder emitted, and
          // `safeDeleteNode` removes a declarator plus its separate write either way.
          if (binding && resolveBindingFunction(binding)) {
            safeDeleteNode(name, binding.path)
          }
        }
      },
    },

    UnaryExpression(path) {
      const match = matchPredicateGenTrue(path)
      if (!match) {
        return
      }
      cleanupCandidates.add(match.dummyFnName)
      path.replaceWith(t.booleanLiteral(true))
    },
  }
}

export default {
  dePredicateGenInit,
}
