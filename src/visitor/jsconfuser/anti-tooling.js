import * as t from '@babel/types'

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
    if (!ref.parentPath.isCallExpression() || !ref.key === 'callee') {
      continue
    }
    const call = ref.parentPath
    if (!call.listKey === 'body') {
      continue
    }
    for (let node of call.node.arguments) {
      call.insertBefore(node)
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
    console.log(`AntiTooling Func Name: ${func_name}`)
    deAntiToolingExtract(path, func_name)
  },
}

export default deAntiTooling
