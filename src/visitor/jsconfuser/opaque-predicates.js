import _generate from '@babel/generator'
const generator = _generate.default
import * as t from '@babel/types'

import ivm from 'isolated-vm'
const isolate = new ivm.Isolate()

import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode
const safeGetName = safeFunc.safeGetName
const safeReplace = safeFunc.safeReplace
import checkFunc from '../../utility/check-func.js'
const checkPattern = checkFunc.checkPattern

function checkOpaqueObject(path) {
  const parent = path.parentPath
  if (!parent.isAssignmentExpression()) {
    return null
  }
  const tmp_name = safeGetName(parent.get('left'))
  const func_path = parent.getFunctionParent()
  if (
    !func_path ||
    func_path.key !== 'callee' ||
    !func_path.parentPath.isCallExpression()
  ) {
    return null
  }
  const func_body = func_path.node.body?.body
  if (!func_body || func_body.length < 2) {
    return null
  }
  const last_node = func_body[func_body.length - 1]
  if (
    !t.isReturnStatement(last_node) ||
    last_node.argument?.name !== tmp_name
  ) {
    return null
  }
  const root_path = func_path.parentPath.parentPath
  if (!root_path.isAssignmentExpression()) {
    return null
  }
  const pred_name = safeGetName(root_path.get('left'))
  const obj = {
    pred_name: pred_name,
    pred_path: root_path,
    props: {},
  }
  for (const prop of path.node.properties) {
    const key = prop.key.name
    const value = prop.value
    if (t.isNumericLiteral(value)) {
      obj.props[key] = {
        type: 'number',
      }
      continue
    }
    if (t.isStringLiteral(value)) {
      obj.props[key] = {
        type: 'string',
      }
      continue
    }
    if (t.isArrayExpression(value)) {
      if (value.elements.length === 0) {
        obj.props[key] = {
          type: 'array_dep',
        }
      }
      continue
    }
    if (t.isArrowFunctionExpression(value) || t.isFunctionExpression(value)) {
      const param = value.params?.[0]?.left?.name
      if (!param) {
        continue
      }
      const code = generator(value).code
      const template =
        `(${param}=){if(${pred_name}[0])${pred_name}push()` +
        `return${pred_name}${param}}`
      if (checkPattern(code, template)) {
        obj.props[key] = {
          type: 'array',
        }
      }
      continue
    }
  }
  return obj
}

/**
 * Template:
 * ```javascript
 * // This is defined in the global space
 * var predicateName = (function () {
 *   var tempName = {
 *     prop_array_1: [],
 *     prop_array: function (paramName = 'length') {
 *       if (!predicateName[prop_array_1][0]) {
 *          predicateName[prop_array_1][0].push(rand1)
 *       }
 *       return predicateName[prop_array_1][paramName]
 *     },
 *     prop_number: rand2,
 *     prop_string: rand_str,
 *   }
 *   return tempName
 * })()
 * // Below will appear multiple times
 * predicateName[prop_array]() ? test : fake
 * predicateName[prop_number] > rand3 ? test : fake
 * predicateName[prop_string].charAt(index) == real_char ? test : fake
 * predicateName[prop_string].charCodeAt(index) == real_char ? test : fake
 * ```
 */
const deOpaquePredicates = {
  ObjectExpression(path) {
    const obj = checkOpaqueObject(path)
    if (!obj) {
      return
    }
    console.log(`[OpaquePredicates] predicateName : ${obj.pred_name}`)
    const vm = isolate.createContextSync()
    const code = generator(obj.pred_path.node).code
    vm.evalSync('var ' + code)
    obj.pred_path.get('right').replaceWith(t.numericLiteral(0))
    let binding = obj.pred_path.scope.getBinding(obj.pred_name)
    binding.scope.crawl()
    binding = binding.scope.getBinding(obj.pred_name)
    for (const ref of binding.referencePaths) {
      if (ref.key !== 'object') {
        continue
      }
      const member = ref.parentPath
      const prop = member.get('property')
      if (!prop || !Object.prototype.hasOwnProperty.call(obj.props, prop)) {
        continue
      }
      let expr = member
      while (
        expr.parentPath.isCallExpression() ||
        expr.parentPath.isMemberExpression()
      ) {
        expr = expr.parentPath
      }
      const test = generator(expr.node).code
      const res = vm.evalSync(test)
      safeReplace(expr, res)
    }
    safeDeleteNode(obj.pred_name, obj.pred_path)
  },
}

export default deOpaquePredicates
