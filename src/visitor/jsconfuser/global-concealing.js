import _generate from '@babel/generator'
const generator = _generate.default
import * as t from '@babel/types'

import findGlobalFn from './global.js'
import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode
import checkFunc from '../../utility/check-func.js'
const checkPattern = checkFunc.checkPattern

function findGlobalVar(glo_name, glo_path) {
  let tmp_path = glo_path.parentPath.getFunctionParent()
  if (
    !tmp_path ||
    !tmp_path.parentPath.isMemberExpression() ||
    !tmp_path.parentPath.parentPath.isCallExpression()
  ) {
    return null
  }
  const tmp_body = tmp_path.node.body.body
  tmp_path = tmp_path.parentPath.parentPath
  const ret_node = tmp_body[tmp_body.length - 1]
  if (
    !t.isReturnStatement(ret_node) ||
    !t.isAssignmentExpression(ret_node.argument)
  ) {
    return null
  }
  const code = generator(ret_node.argument.right).code
  const template = `${glo_name}call(this)`
  if (!checkPattern(code, template)) {
    return null
  }
  const glo_var = ret_node.argument.left.name
  const binding = glo_path.scope.getBinding(glo_var)
  for (const ref of binding.referencePaths) {
    if (
      !ref.parentPath.isMemberExpression() ||
      !ref.parentPath.parentPath.isReturnStatement()
    ) {
      continue
    }
    const func_path = ref.getFunctionParent()
    const func_name = func_path.node.id.name
    return {
      glo_var: glo_var,
      tmp_path: tmp_path,
      glo_fn_name: func_name,
      glo_fn_path: func_path,
    }
  }
  return null
}

function getGlobalConcealingNames(glo_fn_path) {
  const obj = {}
  glo_fn_path.traverse({
    SwitchCase(path) {
      const code = generator(path.node.test).code
      const key = parseInt(code)
      if (Number.isNaN(key)) {
        console.error(`[GlobalConcealing] concealed key: ${code}`)
        obj['invalid'] = true
        return
      }
      let consequent = path.node.consequent[0]
      if (t.isReturnStatement(consequent)) {
        obj[key] = consequent.argument.property.value
      } else {
        if (t.isExpressionStatement(consequent)) {
          consequent = consequent.expression
        }
        obj[key] = consequent.right.left.value
      }
    },
  })
  return obj
}

/**
 * Hide the global vars found by module GlobalAnalysis
 *
 * Template:
 * ```javascript
 * // Add to head:
 * var globalVar, tempVar = function () {
 *   getGlobalVariableFnName = createGetGlobalTemplate()
 *   return globalVar = getGlobalVariableFnName.call(this)
 * }["call"]()
 * // Add to foot:
 * function globalFn (indexParamName) {
 *   var returnName
 *   switch (indexParamName) {
 *     case state_x: {
 *       return globalVar[name]
 *     }
 *     case state_y: {
 *       returnName = name || globalVar[name]
 *       break
 *     }
 *   }
 *   return globalVar[returnName]
 * }
 * // References:
 * // name -> globalFn(state)
 * ```
 */
const deGlobalConcealing = {
  FunctionDeclaration(path) {
    const glo_obj = findGlobalFn(path)
    if (!glo_obj) {
      return null
    }
    const obj = findGlobalVar(glo_obj.glo_fn_name, glo_obj.glo_fn_path)
    if (!obj) {
      return null
    }
    console.log(`[GlobalConcealing] globalVar: ${obj.glo_var}`)
    const glo_vars = getGlobalConcealingNames(obj.glo_fn_path)
    console.log(`[GlobalConcealing] globalFn: ${obj.glo_fn_name}`)
    let binding = obj.glo_fn_path.parentPath.scope.getBinding(obj.glo_fn_name)
    let remain = false
    for (const ref of binding.referencePaths) {
      const repl_path = ref.parentPath
      if (ref.key !== 'callee' || !repl_path.isCallExpression()) {
        continue
      }
      const key = parseInt(generator(repl_path.node.arguments[0]).code)
      if (glo_vars[key]) {
        repl_path.replaceWith(t.identifier(glo_vars[key]))
      } else {
        remain = true
      }
    }
    if (!remain && safeDeleteNode(obj.glo_fn_name, obj.glo_fn_path)) {
      obj.tmp_path.remove()
    }
  },
}

export default deGlobalConcealing
