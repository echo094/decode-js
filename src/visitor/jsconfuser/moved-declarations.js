import * as t from '@babel/types'

/**
 * Reverses MovedDeclarations' (Order 25) *function-parameter packing*.
 *
 * `transforms/identifier/movedDeclarations.ts`'s `FunctionDeclaration.exit` handler takes a
 * `FunctionDeclaration` that is a direct child of an enclosing function's body, retypes it
 * to an anonymous `FunctionExpression`, appends its name to the enclosing function's
 * parameter list, prepends a guarded re-assignment, and removes the original declaration:
 *
 *   function outer(a, b) {           ->   function outer(a, b, inner) {
 *     function inner(x) { ... }             if (!inner) {
 *     ...                                     inner = function (x) { ... };
 *   }                                       }
 *                                           ...
 *                                         }
 *
 * The guard exists because the packed slot is a real parameter: a caller *could* supply it,
 * in which case the supplied value wins. No caller ever does - the encoder appends the slot
 * beyond the function's original arity purely as a hiding place - so the guard is always
 * taken and the rewrite is reversible by restoring the declaration and dropping the slot.
 *
 * This matters well beyond readability. Any decoder pass that identifies structure by
 * looking for a `FunctionDeclaration` stops seeing it once MovedDeclarations has packed it
 * away - which is how a packed ControlFlowFlattening `_main` made the entire CFF decode for
 * that block fail closed while staying runtime-correct.
 *
 * Fail-closed: every condition below must hold, or the statement is left exactly as-is.
 */

/**
 * Matches the guarded re-assignment `if (!X) { X = function (...) {...}; }` the encoder
 * prepends, returning `{ name, fnExpr }` or `null`. The consequent is accepted as either a
 * block or a bare statement (`minify` strips braces from a single-statement consequent).
 */
function matchPackedFunctionGuard(stmtPath) {
  if (!stmtPath.isIfStatement() || stmtPath.node.alternate) {
    return null
  }
  const test = stmtPath.get('test')
  if (!test.isUnaryExpression({ operator: '!' }) || test.node.prefix !== true) {
    return null
  }
  const guarded = test.get('argument')
  if (!guarded.isIdentifier()) {
    return null
  }
  const name = guarded.node.name

  const consequent = stmtPath.get('consequent')
  const inner = consequent.isBlockStatement()
    ? consequent.get('body')
    : [consequent]
  if (inner.length !== 1 || !inner[0].isExpressionStatement()) {
    return null
  }
  const expr = inner[0].get('expression')
  if (!expr.isAssignmentExpression({ operator: '=' })) {
    return null
  }
  if (!expr.get('left').isIdentifier({ name })) {
    return null
  }
  const fnExpr = expr.get('right')
  // The encoder always clears the id when it retypes the declaration, so a *named* function
  // expression here is somebody else's code, not a packed declaration.
  if (!fnExpr.isFunctionExpression() || fnExpr.node.id) {
    return null
  }
  return { name, fnExpr }
}

/**
 * Locates `name` in `fnPath`'s parameter list and confirms it behaves like a packed slot:
 * a plain `Identifier` param (never a pattern or default - `movedDeclarations.ts` pushes a
 * bare identifier for a packed function), whose only assignment anywhere is the guard's own.
 * Anything else means the slot carries a real value, and restoring a declaration would
 * change what the name resolves to.
 *
 * Returns the parameter's index, or `-1`.
 */
function findPackedParameter(fnPath, name, assignPath) {
  const params = fnPath.get('params')
  const index = params.findIndex((p) => p.isIdentifier({ name }))
  if (index === -1) {
    return -1
  }
  const binding = fnPath.scope.getBinding(name)
  if (!binding || binding.kind !== 'param') {
    return -1
  }
  const writes = binding.constantViolations
  if (writes.length !== 1 || writes[0].node !== assignPath.node) {
    return -1
  }
  return index
}

/**
 * The highest argument count any call of `fnPath` passes, or `null` when that cannot be
 * established for every call site at once - an unresolvable binding, a reference that is not
 * the callee of a call or a `new` (the function is aliased, stored, or invoked through
 * `.apply`, so its arity is unknowable here), or a spread argument (whose count is only
 * known at runtime).
 *
 * All-or-nothing on purpose: this decides whether a parameter may be spliced out without
 * renumbering a positional argument somebody actually passes, and one unexamined call site
 * is enough to make that unsound.
 */
function maxArgumentsAtCallSites(fnPath) {
  const name = fnPath.isFunctionDeclaration() ? fnPath.node.id?.name : null
  if (!name) {
    return null
  }
  // A FunctionDeclaration's own name is bound in its parent scope. The binding may itself be
  // a packed parameter (this pass has not necessarily reached the enclosing function yet),
  // which is fine - only `referencePaths` is read, and those are the references to the name
  // either way.
  const binding = fnPath.parentPath.scope.getBinding(name)
  if (!binding) {
    return null
  }
  if (binding.referencePaths.length === 0) {
    // No call site to read an arity from. A Program-level function can still be called from
    // outside this file entirely (an entry point, an export), so its argument counts are not
    // knowable here; one bound inside a function that never references it cannot be reached
    // at all, and no argument ever lands in any of its slots.
    return binding.scope.path.isProgram() ? null : 0
  }
  let max = 0
  for (const ref of binding.referencePaths) {
    // `new F(a, b)` binds its arguments to F's parameters exactly as `F(a, b)` does, so it
    // reads an arity just as well - and it is the common spelling here, since the encoder's
    // own harnesses construct as often as they call.
    const isCall =
      ref.parentPath.isCallExpression() || ref.parentPath.isNewExpression()
    if (ref.key !== 'callee' || !isCall) {
      return null
    }
    const args = ref.parentPath.node.arguments
    if (args.some((arg) => t.isSpreadElement(arg))) {
      return null
    }
    max = Math.max(max, args.length)
  }
  return max
}

/**
 * Fresh closure state per call, same reasoning as duplicate-literal.js: RGF re-invokes the
 * whole pipeline on each eval-wrapped sub-program, so module-level state would leak.
 */
export default function deMovedDeclarationsInit() {
  return {
    Function: {
      exit(path) {
        const body = path.get('body')
        if (!body.isBlockStatement()) {
          return
        }

        let changed = false
        // Call sites don't change while this body is rewritten, so resolve them once.
        let maxArgs
        const callerReach = () => {
          if (maxArgs === undefined) {
            maxArgs = maxArgumentsAtCallSites(path)
          }
          return maxArgs
        }
        // The encoder `prepend`s each guard, so with several packed declarations they stack
        // at the top of the body in reverse packing order. Walk the whole body anyway
        // rather than only index 0 - `prepend` is the only placement the encoder uses, but
        // the shape check is what establishes identity, not the position.
        for (const stmt of body.get('body')) {
          const match = matchPackedFunctionGuard(stmt)
          if (!match) {
            continue
          }
          const assignPath = match.fnExpr.parentPath
          const index = findPackedParameter(path, match.name, assignPath)
          if (index === -1) {
            continue
          }

          const fnNode = match.fnExpr.node
          stmt.replaceWith(
            t.functionDeclaration(
              t.identifier(match.name),
              fnNode.params,
              fnNode.body,
              fnNode.generator,
              fnNode.async,
            ),
          )
          // Drop the now-dead slot. Splicing one out of the middle renumbers every parameter
          // after it, so that is only sound while no call site reaches that far - which is
          // the norm, since the encoder appends packed slots beyond the function's original
          // arity, but has to be established rather than assumed. The last parameter needs no
          // such check: removing it renumbers nothing.
          //
          // Leaving the slot is *not* harmless, which this comment claimed until the residual
          // StringConcealing wrappers were traced back to it. A parameter and a restored
          // declaration of the same name are one binding, and Babel resolves it to the
          // parameter: `binding.kind` reads 'param', `binding.path` is the parameter's own
          // Identifier, and the restored `function name(...) {...}` is demoted to a
          // `constantViolations` entry. Every downstream pass that identifies structure as
          // "a binding whose path is a FunctionDeclaration" - which is the rename-proof
          // idiom this decoder is built on throughout - therefore stops seeing a declaration
          // that is right there in the body, and fails closed on it.
          const reach =
            index === path.node.params.length - 1 ? 0 : callerReach()
          if (reach !== null && reach <= index) {
            path.node.params.splice(index, 1)
          }
          changed = true
        }

        if (changed) {
          path.scope.crawl()
        }
      },
    },
  }
}
