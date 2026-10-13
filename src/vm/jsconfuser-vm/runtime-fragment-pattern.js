import * as t from '@babel/types'

const OMIT = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
])
const EXTERNALS = new WeakMap()

export function cloneRuntimeFragment(nodes) {
  const origins = new WeakMap()
  const associate = (original, cloned) => {
    if (!original || !cloned) return
    origins.set(cloned, original)
    for (const key of t.VISITOR_KEYS[original.type] ?? []) {
      if (Array.isArray(original[key])) {
        original[key].forEach((child, index) =>
          associate(child, cloned[key][index]),
        )
      } else associate(original[key], cloned[key])
    }
  }
  const cloned = nodes.map((node) => {
    const result = t.cloneNode(node, true)
    associate(node, result)
    return result
  })
  return { nodes: cloned, origins }
}

function declaresBinding(path) {
  let current = path
  while (current?.parentPath) {
    const parent = current.parentPath
    if (
      parent.isPattern() ||
      parent.isRestElement() ||
      (parent.isObjectProperty() && parent.parentPath.isObjectPattern())
    ) {
      current = parent
      continue
    }
    return (
      current.listKey === 'params' ||
      (current.key === 'id' &&
        (parent.isVariableDeclarator() ||
          parent.isFunction() ||
          parent.isClass())) ||
      (current.key === 'param' && parent.isCatchClause())
    )
  }
  return false
}

// Local declarations compare by their identity within the fragment. Captured
// references keep their identity in the containing runtime, including shadows.
export function runtimeFragmentPattern(nodes, context, origins = null) {
  const original = (node) => origins?.get(node) ?? node
  const locals = new Map()
  let externals = EXTERNALS.get(context)
  if (!externals) {
    externals = new Map()
    for (const [node, path] of context.paths) {
      if (
        node.type === 'Identifier' &&
        (path.isBindingIdentifier() || path.isReferencedIdentifier())
      ) {
        const binding = context.bindingFor(node)
        if (binding && !externals.has(binding))
          externals.set(binding, externals.size)
      }
    }
    EXTERNALS.set(context, externals)
  }
  const inventory = (value) => {
    if (Array.isArray(value)) {
      value.forEach(inventory)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = original(value)
    const path = context.paths.get(node)
    if (node.type === 'Identifier' && path?.isBindingIdentifier()) {
      const binding = context.bindingFor(node)
      if (binding && declaresBinding(path) && !locals.has(binding))
        locals.set(binding, locals.size)
    }
    for (const key of Object.keys(value))
      if (!OMIT.has(key)) inventory(value[key])
  }
  inventory(nodes)
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical)
    if (!value || typeof value !== 'object') return value
    const result = Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => !OMIT.has(key))
        .map((key) => [key, canonical(value[key])]),
    )
    const node = original(value)
    const path = context.paths.get(node)
    if (
      node.type === 'Identifier' &&
      path &&
      (path.isBindingIdentifier() || path.isReferencedIdentifier())
    ) {
      const binding = context.bindingFor(node)
      if (binding)
        result.name = locals.has(binding)
          ? `local:${locals.get(binding)}`
          : `capture:${externals.get(binding)}`
    }
    return result
  }
  return canonical(nodes)
}
