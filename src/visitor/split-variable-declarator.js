import * as t from '@babel/types'

function splitVariableDeclarator(path) {
  const parent = path.parentPath
  // The container must be an array
  if (!parent.listKey) {
    return
  }
  if (!path.get('init').isSequenceExpression()) {
    return
  }
  const exps = path.node.init.expressions
  const last = exps.pop()
  for (let exp of exps) {
    parent.insertBefore(t.expressionStatement(exp))
  }
  path.get('init').replaceWith(last)
  parent.scope.crawl()
}

/**
 * Split the init of VariableDeclarator if it's a SequenceExpression
 *
 * ```javascript
 * // From
 * var aa = (a, b);
 * // To
 * a
 * var aa = b;
 * ```
 */
export default {
  VariableDeclarator: splitVariableDeclarator,
}
