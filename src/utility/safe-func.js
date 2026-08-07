import * as t from '@babel/types'

function safeDeleteNode(name, path) {
  let binding
  if (path.isFunctionDeclaration()) {
    binding = path.parentPath.scope.getBinding(name)
  } else {
    binding = path.scope.getBinding(name)
  }
  if (!binding) {
    return false
  }
  binding.scope.crawl()
  binding = binding.scope.getBinding(name)
  // The re-crawl can invalidate the binding it was meant to refresh. A caller that resolved
  // its target before a pass rewrote the enclosing body is holding a binding registered
  // against the *old* body; the crawl rebuilds from the new one, and if the name did not
  // survive the rewrite the re-lookup finds nothing. That is the same state as the entry
  // guard above - no such binding - so it gets the same answer, rather than dereferencing
  // undefined. Anything doing scope work after a wrapper-body rewrite reaches here.
  if (!binding) {
    return false
  }
  if (binding.references) {
    return false
  }
  for (const item of binding.constantViolations) {
    item.remove()
  }
  const decl = binding.path
  if (decl.removed) {
    return true
  }
  if (!decl.isVariableDeclarator() && !decl.isFunctionDeclaration()) {
    return true
  }
  binding.path.remove()
  return true
}

function safeGetLiteral(path) {
  if (path.isUnaryExpression()) {
    if (path.node.operator === '-' && path.get('argument').isNumericLiteral()) {
      return -1 * path.get('argument').node.value
    }
    return null
  }
  if (path.isLiteral()) {
    return path.node.value
  }
  return null
}

function safeGetName(path) {
  if (path.isIdentifier()) {
    return path.node.name
  }
  if (path.isLiteral()) {
    return path.node.value
  }
  if (path.isUnaryExpression()) {
    return safeGetLiteral(path)
  }
  return null
}

/**
 * Drops the brackets from a `["text"]` member/property key once the expression inside it has
 * been resolved to a plain string.
 *
 * The encoder had no choice about the brackets: a concealed key is emitted as
 * `[decode(start, len)]`, and a call cannot sit in a non-computed key slot. Substituting the
 * literal back restores the text but not the spelling, and a matcher written against the
 * encoder's own `{ key() {} }` form then declines - which is how the whole Flatten
 * scope-object layer survived on 45 of 96 corpus samples.
 *
 * Un-computing is a pure spelling change for every key but two, and both change meaning:
 *   - `{ ["__proto__"]: v }` defines an own property; `{ "__proto__": v }` sets the
 *     prototype instead. (Method definitions are exempt - the special case is scoped to
 *     `PropertyName : AssignmentExpression`.)
 *   - `class C { ["constructor"]() {} }` is an ordinary method; without the brackets it
 *     becomes the class constructor. `static ["prototype"]` is a runtime error un-computed
 *     and a SyntaxError computed, so it is left alone too.
 */
function uncomputeStringKey(keyPath) {
  const owner = keyPath.parentPath
  if (!owner || keyPath.key !== 'key' || !owner.node.computed) {
    return
  }
  if (
    !owner.isObjectProperty() &&
    !owner.isObjectMethod() &&
    !owner.isClassMethod() &&
    !owner.isClassProperty()
  ) {
    return
  }
  const name = keyPath.node.value
  if (owner.isObjectProperty() && name === '__proto__') {
    return
  }
  if (
    (owner.isClassMethod() || owner.isClassProperty()) &&
    (name === 'constructor' || (owner.node.static && name === 'prototype'))
  ) {
    return
  }
  owner.node.computed = false
}

function safeReplace(path, value) {
  if (typeof value === 'string') {
    path.replaceWith(t.stringLiteral(value))
    uncomputeStringKey(path)
    return
  }
  if (typeof value === 'number') {
    path.replaceWith(t.numericLiteral(value))
    return
  }
  path.replaceWithSourceString(value)
}

export default {
  safeDeleteNode,
  safeGetLiteral,
  safeGetName,
  safeReplace,
  uncomputeStringKey,
}
