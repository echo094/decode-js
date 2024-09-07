const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const ivm = require('isolated-vm')

const isolate = new ivm.Isolate()
const globalContext = isolate.createContextSync()
function virtualGlobalEval(jsStr) {
  return globalContext.evalSync(String(jsStr))
}

const collect_id = {
  arrowFunc: null,
}

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

function checkArrowWrap(path) {
  if (path.node?.name !== 'arguments') {
    return null
  }
  if (!path.parentPath.isSpreadElement()) {
    return null
  }
  const call = path.parentPath.parentPath
  if (path.parentPath.listKey !== 'arguments' || !call.isCallExpression()) {
    return null
  }
  if (call.key !== 'argument' || !call.parentPath.isReturnStatement()) {
    return null
  }
  const func_name = call.node.callee?.name
  if (!func_name) {
    return null
  }
  let wrap = call.getFunctionParent()
  if (wrap.key !== 'init') {
    return null
  }
  wrap = wrap.parentPath
  const wrap_name = wrap.node.id?.name
  wrap = wrap.parentPath
  if (
    wrap.listKey !== 'body' ||
    wrap.key !== 0 ||
    wrap.container.length !== 2
  ) {
    return null
  }
  const str = generator(wrap.container[1]).code
  if (str.indexOf(wrap_name) === -1) {
    return null
  }
  wrap = wrap.getFunctionParent()
  const arrow_name = wrap.node?.id?.name
  if (!arrow_name || wrap.node.params?.[0]?.name !== func_name) {
    return null
  }
  return {
    name: arrow_name,
    path: wrap,
  }
}

/**
 * Template:
 * ```javascript
 * function arrowFunctionName (arrowFn, functionLength = 0){
 *   var functionObject = function(){ return arrowFn(...arguments) };
 *   return Object.defineProperty(functionObject, "length", {
 *     "value": functionLength,
 *     "configurable": true
 *   });
 * }
 * ```
 */
const deMinifyArrow = {
  Identifier(path) {
    let obj = checkArrowWrap(path)
    if (!obj) {
      return
    }
    collect_id.arrowFunc = obj.name
    console.log(`Find arrowFunctionName: ${obj.name}`)
    let binding = obj.path.parentPath.scope.bindings[obj.name]
    for (const ref of binding.referencePaths) {
      if (ref.key !== 'callee') {
        console.warn(`Unexpected ref of arrowFunctionName: ${obj.name}`)
        continue
      }
      const repl_path = ref.parentPath
      repl_path.replaceWith(repl_path.node.arguments[0])
    }
    binding.scope.crawl()
    binding = obj.path.parentPath.scope.bindings[obj.name]
    if (!binding.references) {
      obj.path.remove()
    }
  },
}

function checkFuncLen(path) {
  if (path.node?.name !== 'configurable' || path.key !== 'key') {
    return null
  }
  const prop = path.parentPath
  if (!prop.isObjectProperty() || prop.key !== 1) {
    return null
  }
  const obj = prop.parentPath
  if (obj.node.properties.length !== 2) {
    return null
  }
  if (obj.node.properties[0]?.key?.name !== 'value') {
    return null
  }
  if (obj.listKey !== 'arguments' || obj.key !== 2) {
    return null
  }
  const func_name = obj.container[0]?.name
  const warp = obj.getFunctionParent()
  if (warp.node.params?.[0]?.name !== func_name) {
    return null
  }
  const func_len_name = warp.node?.id?.name
  if (!func_len_name || func_len_name === collect_id.arrowFunc) {
    return null
  }
  return {
    name: func_len_name,
    path: warp,
  }
}

const deStackFuncLen = {
  Identifier(path) {
    let obj = checkFuncLen(path)
    if (!obj) {
      return
    }
    console.log(`Find functionLengthName: ${obj.name}`)
    let binding = obj.path.parentPath.scope.bindings[obj.name]
    for (const ref of binding.referencePaths) {
      if (ref.key !== 'callee') {
        console.warn(`Unexpected ref of functionLengthName: ${obj.name}`)
        continue
      }
      const repl_path = ref.parentPath
      const arg = repl_path.node.arguments[0]
      if (t.isIdentifier(arg)) {
        repl_path.remove()
      } else {
        repl_path.replaceWith(arg)
      }
    }
    binding.scope.crawl()
    binding = obj.path.parentPath.scope.bindings[obj.name]
    if (!binding.references) {
      obj.path.remove()
    }
  },
}

module.exports = function (code) {
  let ast
  try {
    ast = parse(code, { errorRecovery: true })
  } catch (e) {
    console.error(`Cannot parse code: ${e.reasonCode}`)
    return null
  }
  // AntiTooling
  traverse(ast, deAntiTooling)
  // Minify
  traverse(ast, deMinifyArrow)
  // Stack
  traverse(ast, deStackFuncLen)
  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  return code
}
