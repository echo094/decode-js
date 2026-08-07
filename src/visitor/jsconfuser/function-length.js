import * as t from '@babel/types'
import logger from '../../utility/logger.js'
const debugLog = logger.debugLog

import { processStackParam } from './variable-masking.js'

/**
 * `SetFunctionLengthTemplate` (setFunctionLengthTemplate.ts) hard-codes its
 * `{value, configurable}` object literal with quoted keys
 * (`{"value": length, "configurable": false}`), the same computed
 * bracket-string form js-confuser's Preparation pass normalizes every object
 * key to - only Minify (order 28, not always enabled) converts valid-identifier
 * keys back to plain form. Read either shape.
 */
function propKeyName(node) {
  if (t.isIdentifier(node)) return node.name
  if (t.isStringLiteral(node)) return node.value
  return null
}

/**
 * `preserveFunctionLength` wraps every length-changing target regardless of
 * *why* its length changed - VariableMasking's `...{ph}` collapse is the
 * common case `processStackParam` exists to undo, but RGF can independently
 * shrink a function to a zero-param `return {ph}[0].apply(this, [{ph},
 * arguments])` stub (see rgf.js) and get wrapped the same way. Only hand off
 * to `processStackParam` when a rest param is actually there - otherwise
 * `checkStackInvalid`'s `params[0].argument.name` throws on a target that was
 * never rest-masked to begin with.
 */
function hasRestParam(path) {
  const param = path.node?.params?.[0]
  return t.isRestElement(param) && t.isIdentifier(param.argument)
}

export default function () {
  function checkFuncLen(path) {
    if (propKeyName(path.node) !== 'configurable' || path.key !== 'key') {
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
    if (propKeyName(obj.node.properties[0]?.key) !== 'value') {
      return null
    }
    if (obj.listKey !== 'arguments') {
      return null
    }
    const arg_num = obj.container.length
    if (obj.key !== arg_num - 1) {
      return null
    }
    const func_name = obj.container[arg_num - 3]?.name
    const warp = obj.getFunctionParent()
    if (warp.node.params?.[0]?.name !== func_name) {
      return null
    }
    const func_len_name = warp.node?.id?.name
    if (!func_len_name) {
      return null
    }
    return {
      name: func_len_name,
      path: warp,
    }
  }

  return {
    'Identifier|StringLiteral'(path) {
      let obj = checkFuncLen(path)
      if (!obj) {
        return
      }
      debugLog(`[FunctionLength] Find functionLengthName: ${obj.name}`)
      let binding = obj.path.parentPath.scope.bindings[obj.name]
      for (const ref of binding.referencePaths) {
        if (ref.key !== 'callee') {
          console.warn(
            `[FunctionLength] Unexpected ref of functionLengthName: ${obj.name}`,
          )
          continue
        }
        const repl_path = ref.parentPath
        const arg = repl_path.node.arguments[0]
        // SetFunctionLengthTemplate's `length = 1` default - the call site omits
        // the second argument entirely when the intended length is 1
        const len = repl_path.node.arguments[1]?.value ?? 1
        if (t.isIdentifier(arg)) {
          const func_name = arg.name
          const func_decl = repl_path.scope.getBinding(func_name).path
          if (func_decl.isFunction() && hasRestParam(func_decl)) {
            processStackParam(func_decl, len)
          }
          repl_path.remove()
        } else {
          repl_path.replaceWith(arg)
          if (hasRestParam(repl_path)) {
            processStackParam(repl_path, len)
          }
        }
      }
      binding.scope.crawl()
      binding = obj.path.parentPath.scope.bindings[obj.name]
      if (!binding.references) {
        obj.path.remove()
      }
    },
  }
}
