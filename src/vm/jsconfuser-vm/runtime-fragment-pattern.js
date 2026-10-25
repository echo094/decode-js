import * as t from '@babel/types'

// Deep clones of `nodes`, each mapped to its original in `origins` (a new map unless one is given).
export function cloneRuntimeFragment(nodes, origins = new WeakMap()) {
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
