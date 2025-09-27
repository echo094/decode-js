import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
const traverse = _traverse.default
import * as t from '@babel/types'

function checkNode(node) {
  if (t.isExpressionStatement(node)) {
    node = node.expression
  }
  if (node?.callee?.callee?.name !== 'Function') {
    return undefined
  }
  if (node?.callee?.arguments?.length !== 2) {
    return undefined
  }
  if (node?.callee?.arguments[0].type !== 'StringLiteral') {
    return undefined
  }
  if (node?.callee?.arguments[1].type !== 'StringLiteral') {
    return undefined
  }
  if (node?.arguments?.length !== 1) {
    return undefined
  }
  if (node?.arguments[0].type !== 'ObjectExpression') {
    return undefined
  }
  const obj = {}
  for (const item of node.arguments[0].properties) {
    if (item.kind === 'get') {
      obj[item.key.value] = item.body.body[0].argument
    } else {
      obj[item.key.value] = item.body.body[0].argument.left
    }
  }
  return {
    objectName: node?.callee?.arguments[0].value,
    outputCode: node?.callee?.arguments[1].value,
    objectExpression: obj,
  }
}

function parseOutputCode(code, objName, objValue) {
  const ast = parse(code, { errorRecovery: true })
  traverse(ast, {
    Identifier: function (path) {
      if (path.node?.name !== objName) {
        return
      }
      const item = path.parentPath
      const key = item.node.property.value
      item.replaceWith(objValue[key])
    },
  })
  return ast.program.body
}

/**
 * All codes except ImportDeclaration are in the string outputCode:
 *
 * ```javascript
 * `
 * {prependNodes}
 * Function({objectName}, {outputCode})({objectExpression});
 * `
 * ```
 */
function dePack(ast) {
  const body = ast.program.body
  const last = body[body.length - 1]
  const data = checkNode(last)
  if (!data) {
    return
  }
  console.log(`[Pack] Object Name: ${data.objectName}`)
  const items = parseOutputCode(
    data.outputCode,
    data.objectName,
    data.objectExpression
  )
  body.pop()
  body.push(...items)
  return ast
}

export default dePack
