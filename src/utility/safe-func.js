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
  return null
}

function safeReplace(path, value) {
  if (typeof value === 'string') {
    path.replaceWith(t.stringLiteral(value))
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
}
