import * as t from '@babel/types'

// Deep clones of `nodes`, each mapped to its original in `origins` (a new map unless one is given).
export function cloneRuntimeFragment(nodes, origins = new WeakMap()) {
  const cloned = nodes.map((node) => {
    const result = t.cloneNode(node, true)
    // A deep clone has its original's shape, so the two trees list their nodes in the same order.
    const originals = preorder(node)
    preorder(result).forEach((copy, index) =>
      origins.set(copy, originals[index]),
    )
    return result
  })
  return { nodes: cloned, origins }
}

// Every node of `root`, in pre-order.
function preorder(root) {
  const list = []
  t.traverseFast(root, (node) => void list.push(node))
  return list
}
