import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import logger from '../../utility/logger.js'
const debugLog = logger.debugLog

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
  const body = ast.program.body
  // Pack runs the real program as a `Function(...)` body, so the encoder
  // (pack.ts finalASTHandler) rewrites the program's last ExpressionStatement
  // into a `return <expr>` to preserve the wrapper's completion value. Once the
  // body is spliced back into a script that `return` is illegal at top level, so
  // reverse it: a trailing top-level ReturnStatement becomes an
  // ExpressionStatement again (a bare `return;` is just dropped).
  const last = body[body.length - 1]
  if (t.isReturnStatement(last)) {
    if (last.argument) {
      body[body.length - 1] = t.expressionStatement(last.argument)
    } else {
      body.pop()
    }
  }
  return body
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
    return ast
  }
  debugLog(`[Pack] Object Name: ${data.objectName}`)
  const items = parseOutputCode(
    data.outputCode,
    data.objectName,
    data.objectExpression,
  )
  body.pop()
  body.push(...items)
  return ast
}

export default dePack
