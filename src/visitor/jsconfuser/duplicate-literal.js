import _generate from '@babel/generator'
const generator = _generate.default
import * as t from '@babel/types'

import ivm from 'isolated-vm'
const isolate = new ivm.Isolate()

import safeFunc from '../../utility/safe-func.js'
const safeReplace = safeFunc.safeReplace

function checkArrayName(path) {
  if (path.key !== 'argument') {
    return null
  }
  const ret_path = path.parentPath
  if (!ret_path.isReturnStatement() || ret_path.key !== 0) {
    return null
  }
  const array_fn_path = ret_path.getFunctionParent()
  const array_fn_name = array_fn_path.node.id?.name
  if (!array_fn_name) {
    return null
  }
  const binding = array_fn_path.parentPath.scope.bindings[array_fn_name]
  if (binding.references !== 1) {
    return null
  }
  let ref = binding.referencePaths[0]
  while (ref && !ref.isAssignmentExpression()) {
    ref = ref.parentPath
  }
  if (!ref) {
    return null
  }
  const array_name = ref.node.left?.name
  if (!array_name) {
    return null
  }
  return {
    func_name: array_fn_name,
    func_path: array_fn_path,
    array_name: array_name,
    array_path: ref,
  }
}

function parseArrayWarp(vm, path) {
  let func = path.getFunctionParent(path)
  let name = null
  let binding = null
  if (func.isArrowFunctionExpression()) {
    func = func.parentPath
    name = func.node.id.name
    binding = func.scope.getBinding(name)
  } else {
    name = func.node.id.name
    binding = func.parentPath.scope.getBinding(name)
  }
  console.log(`Process array warp function: ${name}`)
  vm.evalSync(generator(func.node).code)
  for (const ref of binding.referencePaths) {
    const call = ref.parentPath
    if (ref.key !== 'callee') {
      console.warn(`Unexpected ref of array warp function: ${call}`)
      continue
    }
    const value = vm.evalSync(generator(call.node).code)
    safeReplace(call, value)
  }
  binding.scope.crawl()
  binding = binding.scope.getBinding(name)
  if (!binding.references) {
    func.remove()
  }
}

/**
 * Template:
 * ```javascript
 * var arrayName = getArrayFn()
 * function getArrayFn (){
 *   return [...arrayExpression]
 * }
 * ```
 */
const deDuplicateLiteral = {
  ArrayExpression(path) {
    let obj = checkArrayName(path)
    if (!obj) {
      return
    }
    console.log(`Find arrayName: ${obj.array_name}`)
    let decl_node = t.variableDeclarator(
      obj.array_path.node.left,
      obj.array_path.node.right
    )
    decl_node = t.variableDeclaration('var', [decl_node])
    const code = [generator(obj.func_path.node).code, generator(decl_node).code]
    let binding = obj.array_path.scope.getBinding(obj.array_name)
    for (const ref of binding.referencePaths) {
      const vm = isolate.createContextSync()
      vm.evalSync(code[0])
      vm.evalSync(code[1])
      parseArrayWarp(vm, ref)
    }
    binding.scope.crawl()
    binding = binding.scope.bindings[obj.array_name]
    if (!binding.references) {
      obj.array_path.remove()
      binding.path.remove()
    }
    binding = obj.func_path.parentPath.scope.getBinding(obj.func_name)
    binding.scope.crawl()
    binding = binding.scope.getBinding(obj.func_name)
    if (!binding.references) {
      obj.func_path.remove()
    }
  },
}

export default deDuplicateLiteral
