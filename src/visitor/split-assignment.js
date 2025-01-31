import * as t from '@babel/types'

/**
 * Split the AssignmentExpressions. For example:
 *
 * - In the test of IfStatement
 * - In the VariableDeclaration
 */
export default {
  IfStatement(path) {
    if (!path.parentPath.isBlockStatement() && !path.parentPath.isProgram()) {
      return
    }
    let test = path.get('test')
    if (test.isAssignmentExpression()) {
      path.insertBefore(t.expressionStatement(test.node))
      test.replaceWith(test.node.left)
      path.scope.crawl()
      return
    }
    if (test.isMemberExpression()) {
      let object = test.get('object')
      if (object.isAssignmentExpression()) {
        path.insertBefore(t.expressionStatement(object.node))
        object.replaceWith(object.node.left)
      }
      let property = test.get('property')
      if (property.isAssignmentExpression()) {
        path.insertBefore(t.expressionStatement(property.node))
        property.replaceWith(property.node.left)
      }
      path.scope.crawl()
    }
  },
  VariableDeclaration(path) {
    if (!path.parentPath.isBlockStatement() && !path.parentPath.isProgram()) {
      return
    }
    for (let i = 0; i < path.node.declarations.length; ++i) {
      const declaration = path.get(`declarations.${i}`)
      const init = declaration.node.init
      if (!t.isAssignmentExpression(init)) {
        continue
      }
      path.insertBefore(t.ExpressionStatement(init))
      declaration.get('init').replaceWith(init.left)
    }
    path.scope.crawl()
  },
}
