const t = require('@babel/types')

/**
 * Delete unused variables with the following exceptions:
 *
 * - ForOfStatement
 * - ForInStatement
 *
 */
module.exports = {
  VariableDeclarator: (path) => {
    const { node, scope } = path
    const name = node.id.name
    const binding = scope.getBinding(name)
    if (!binding || binding.referenced || !binding.constant) {
      return
    }
    const up1 = path.parentPath
    const up2 = up1?.parentPath
    if (t.isForOfStatement(up2)) {
      return
    }
    if (t.isForInStatement(up2)) {
      return
    }
    console.log(`Unused variable: ${name}`)
    if (up1.node.declarations.length === 1) {
      up1.remove()
      up1.scope.crawl()
    } else {
      path.remove()
      scope.crawl()
    }
  },
}
