const isIntersect = (path, bindings) => {
  path.scope.crawl()
  for (const key of Object.keys(bindings)) {
    if (path.scope.hasBinding(key)) {
      return true
    }
  }
  return false
}

/**
 * Avoid nested blocks.
 *
 * This is slightly different from the @putout/plugin-remove-nested-blocks :
 * https://github.com/coderaiser/putout/issues/224#issuecomment-2614051528
 */
export default {
  BlockStatement: (path) => {
    const { parentPath } = path
    if (!parentPath.isBlockStatement() && !parentPath.isProgram()) {
      return
    }
    let valid = path.container.length === 1
    if (!isIntersect(parentPath, path.scope.bindings)) {
      valid = true
    }
    if (!valid) {
      return
    }
    path.replaceWithMultiple(path.node.body)
    path.scope.crawl()
  },
}
