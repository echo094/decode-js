/**
 * Unverified: not active in js-confuser 2.1.3. `antiTooling` was a 1.1.8 option
 * and did not survive the 2.0.0 Babel rewrite - neither the transform nor the
 * option exists anywhere in the pinned encoder's source. This pass targets 1.x
 * output only, and nothing exercises it against encoder-generated 2.1.3 output.
 */
import * as t from '@babel/types'
import logger from '../../utility/logger.js'
const debugLog = logger.debugLog

function deAntiToolingCheckFunc(path) {
  if (path.node.params.length) {
    return false
  }
  const body = path.node.body
  if (!t.isBlockStatement(body)) {
    return false
  }
  if (body.body.length) {
    return false
  }
  return true
}

function deAntiToolingExtract(path, func_name) {
  let binding = path.scope.getBinding(func_name)
  for (let ref of binding.referencePaths) {
    if (!ref.parentPath.isCallExpression() || ref.key !== 'callee') {
      continue
    }
    const call = ref.parentPath
    // The merged call sits as an ExpressionStatement's `.expression`, not
    // directly in a list itself - `call.listKey` is always undefined; the
    // ExpressionStatement wrapping it (call.parentPath) is what's actually a
    // direct element of the block's `body` array.
    if (call.parentPath.listKey !== 'body') {
      continue
    }
    for (let node of call.node.arguments) {
      call.insertBefore(t.expressionStatement(node))
    }
    call.remove()
  }
  binding.scope.crawl()
  binding = path.scope.getBinding(func_name)
  if (binding.references === 0) {
    path.remove()
  }
}

const deAntiTooling = {
  FunctionDeclaration(path) {
    const func_name = path.node.id?.name
    if (!func_name) {
      return
    }
    if (!deAntiToolingCheckFunc(path)) {
      return
    }
    debugLog(`[AntiTooling] Func Name: ${func_name}`)
    deAntiToolingExtract(path, func_name)
  },
}

export default deAntiTooling
