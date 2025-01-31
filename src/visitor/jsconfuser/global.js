import _generate from '@babel/generator'
const generator = _generate.default
import * as t from '@babel/types'

import safeFunc from '../../utility/safe-func.js'
const safeGetName = safeFunc.safeGetName
import checkFunc from '../../utility/check-func.js'
const checkPattern = checkFunc.checkPattern

/**
 * GlobalTemplate 1 (currently not support):
 * ```javascript
 * function {getGlobalFnName}(){
 *   var localVar = false;
 *   eval(${transform.jsConfuserVar("localVar")} + " = true")
 *   if (!localVar) {
 *     {countermeasures}
 *   }
 *   const root = eval("this");
 *   return root;
 * }
 * ```
 * GlobalTemplate 2:
 * ```javascript
 * function {getGlobalFnName}(array = [a, b, c, d]){
 *   var bestMatch
 *   var itemsToSearch = []
 *   try {
 *     bestMatch = Object
 *     itemsToSearch["push"](("")["__proto__"]["constructor"]["name"])
 *   } catch(e) {
 *   }
 *   // ...
 *   return bestMatch || this;
 * }
 * ```
 */
function findGlobalFn(path) {
  const glo_fn_name = path.node.id?.name
  if (!glo_fn_name) {
    return null
  }
  let node = path.node.params?.[0]
  if (
    !node ||
    !t.isAssignmentPattern(node) ||
    !t.isArrayExpression(node.right) ||
    node.right.elements.length !== 4
  ) {
    return null
  }
  const array_name = node.left.name
  const code = generator(path.node.body).code
  const template =
    'try{=Objectpush(__proto__constructorname)}catch{}' +
    `:for(;<${array_name}length;)try{=${array_name}[]()` +
    'for()if(typeof)continue}catch{}return||this'
  if (!checkPattern(code, template)) {
    return
  }
  const deps = []
  const array = path.get('params.0.right')
  for (let i = 0; i < 4; ++i) {
    const ele_name = safeGetName(array.get(`elements.${i}`))
    const binding = path.scope.getBinding(ele_name)
    deps.push({
      name: ele_name,
      path: binding.path,
      pos: binding.path.node.start,
    })
  }
  deps.push({
    name: glo_fn_name,
    path: path,
    pos: path.node.start,
  })
  return {
    glo_fn_name: glo_fn_name,
    glo_fn_path: path,
    deps: deps,
  }
}

export default findGlobalFn
