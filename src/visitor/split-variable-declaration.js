import * as t from '@babel/types'

function splitVariableDeclaration(path) {
  // The scope of a for statement is its body
  if (path.parentPath.isFor()) {
    return
  }
  // The container must be an array
  if (!path.listKey) {
    return
  }
  const kind = path.node.kind
  const list = path.node.declarations
  if (list.length == 1) {
    return
  }
  for (let item of list) {
    path.insertBefore(t.variableDeclaration(kind, [item]))
  }
  path.remove()
  path.scope.crawl()
}

/**
 * Split the VariableDeclaration if it has more than one VariableDeclarator
 *
 * This operation will only be performed when its container is an array
 */
export default {
  VariableDeclaration: splitVariableDeclaration,
}
