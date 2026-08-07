/**
 * Resolving a binding to what it actually *defines*, rather than to one spelling of its
 * declaration.
 *
 * `binding.path` is only the definition site for the plainest spelling. Two encoder
 * mechanisms routinely move it elsewhere while leaving the binding intact, and a matcher
 * written as "a binding whose path is a FunctionDeclaration" - the rename-proof idiom this
 * decoder uses throughout - fails closed on both:
 *
 *   - a declaration split into `var X;` + `X = <value>;`, where `binding.path` is a
 *     declarator with a null `init` and the value is in the binding's single write;
 *   - a name hoisted onto the enclosing function's parameter list, where `binding.kind`
 *     reads 'param', `binding.path` is the parameter's own `Identifier`, and the real
 *     definition is demoted to a `constantViolations` entry.
 *
 * Fail-closed throughout: a binding written more than once has no single definition, so
 * these return null rather than pick one. "Left alone" is always safe; a guess is not.
 */
import * as t from '@babel/types'

/**
 * The single value a binding holds, as both node and path, or null.
 */
function resolveBindingValue(binding) {
  if (!binding || !binding.path) {
    return null
  }
  const declPath = binding.path
  if (declPath.isVariableDeclarator() && declPath.node.init) {
    // A declarator with an initializer defines its value outright; a further write would
    // mean the name does not hold one single thing.
    if (binding.constantViolations.length !== 0) {
      return null
    }
    return { node: declPath.node.init, path: declPath.get('init') }
  }
  if (binding.constantViolations.length !== 1) {
    return null
  }
  const write = binding.constantViolations[0]
  if (!write.isAssignmentExpression() || write.node.operator !== '=') {
    return null
  }
  const right = write.get('right')
  return right.node ? { node: right.node, path: right } : null
}

/**
 * The function a binding names, whatever spelling it arrived in: a `FunctionDeclaration`
 * (whether at `binding.path` or demoted to a constant violation by parameter hoisting), or a
 * function-valued declarator/assignment. Returns the `Function`'s own NodePath, or null.
 */
function resolveBindingFunction(binding) {
  if (!binding || !binding.path) {
    return null
  }
  if (binding.path.isFunctionDeclaration()) {
    return binding.path
  }
  // A hoisted parameter's declaration survives as a write, and for a packed function
  // declaration that write is the FunctionDeclaration itself rather than an assignment.
  if (binding.kind === 'param') {
    const decls = binding.constantViolations.filter((v) =>
      v.isFunctionDeclaration(),
    )
    if (decls.length === 1) {
      return decls[0]
    }
  }
  const value = resolveBindingValue(binding)
  if (!value || !t.isFunction(value.node)) {
    return null
  }
  return value.path
}

export default {
  resolveBindingValue,
  resolveBindingFunction,
}
