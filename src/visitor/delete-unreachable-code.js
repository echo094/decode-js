import * as t from '@babel/types'

/**
 * DFS the BlockStatement to find and return the location of the first
 * ReturnStatement, which is not inside a Conditional Block.
 */
const checkReturnLocation = (body) => {
  for (let i = 0; i < body.length; ++i) {
    if (t.isReturnStatement(body[i])) {
      return i
    }
    if (t.isBlockStatement(body[i])) {
      const ret = checkReturnLocation(body[i].body)
      if (~ret) {
        return i
      }
    }
  }
  return -1
}

/**
 * Remove the codes after the first ReturnStatement, which is not inside a
 * Conditional Block. The FunctionDeclaration will be preserved.
 *
 * This is slightly different from the @putout/plugin-remove-unreachable-code :
 * https://github.com/coderaiser/putout/issues/224#issuecomment-2614051528
 */
export default {
  BlockStatement: (path) => {
    const body = path.node.body
    const loc = checkReturnLocation(body)
    if (loc == -1) {
      return
    }
    for (let i = body.length - 1; i > loc; --i) {
      if (t.isFunctionDeclaration(body[i])) {
        continue
      }
      body.splice(i, 1)
    }
    if (loc === 0 && t.isBlockStatement(body[0])) {
      const inner = body.shift()
      while (inner.body.length) {
        body.unshift(inner.body.pop())
      }
    }
    path.scope.crawl()
  },
}
