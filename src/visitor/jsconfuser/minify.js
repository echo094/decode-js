import _generate from '@babel/generator'
const generator = _generate.default

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
export default function () {
  let arrowFunc = null
  const deMinifyArrow = {
    Identifier(path) {
      let obj = checkArrowWrap(path)
      if (!obj) {
        return
      }
      arrowFunc = obj.name
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
  return {
    arrowFunc,
    deMinifyArrow,
  }
}
