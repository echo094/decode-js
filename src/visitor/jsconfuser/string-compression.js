import _generate from '@babel/generator'
const generator = _generate.default

import ivm from 'isolated-vm'
const isolate = new ivm.Isolate()

import safeFunc from '../../utility/safe-func.js'
const safeReplace = safeFunc.safeReplace
import checkFunc from '../../utility/check-func.js'
const checkPattern = checkFunc.checkPattern

function findStringDecoder(path) {
  if (path.node?.name !== 'charCodeAt' || path.key !== 'property') {
    return null
  }
  let loop = path
  while (loop && !loop.isForStatement()) {
    loop = loop.parentPath
  }
  const i = loop?.node?.update?.argument?.name
  if (!i) {
    return null
  }
  const func = loop.getFunctionParent()
  const param = func.node.params?.[0]?.name
  if (!param) {
    return null
  }
  const code = generator(func.node).code
  const template =
    `function(${param}){var=${param}.split()for(${i}=1;${i}<.length;${i}++)` +
    `[${i}].charCodeAt(0)[${i}].push().charAt(0)return.join().split()}`
  if (!checkPattern(code, template)) {
    return null
  }
  return {
    name: func.node.id.name,
    path: func,
  }
}

function findStringGet(path) {
  const decoder_name = path.node.id.name
  let binding = path.parentPath.scope.getBinding(decoder_name)
  if (!binding || binding.references !== 1) {
    return null
  }
  const ref = binding.referencePaths[0]
  if (ref.key !== 1 || ref.listKey !== 'arguments') {
    return null
  }
  const get_ref_path = ref.parentPath.get('arguments.0')
  const get_name = get_ref_path.node?.name
  if (!get_name) {
    return null
  }
  binding = get_ref_path.scope.getBinding(get_name)
  return {
    name: get_name,
    path: binding.path,
    ref: get_ref_path,
  }
}

function findStringSplit(path) {
  while (path && !path.isAssignmentExpression()) {
    path = path.parentPath
  }
  const split_name = path?.node?.left?.name
  if (!split_name) {
    return null
  }
  const binding = path.scope.getBinding(split_name)
  return {
    name: split_name,
    path: path,
    def: binding.path,
  }
}

function findStringFn(path, name) {
  const binding = path.scope.getBinding(name)
  const ref = binding.referencePaths?.[0]
  if (!ref) {
    return null
  }
  const fn_path = ref.getFunctionParent(name)
  const fn_name = fn_path.node.id.name
  return {
    name: fn_name,
    path: fn_path,
  }
}

/**
 * Template:
 * ```javascript
 * var split = (function (getStringParamName, decoderParamName) {
 *   return decoderParamName(getStringParamName())
 * })(getStringName, decoder)
 * function getStringName () {
 *   var str = splits[0]
 *   var objectToTest = {}
 *   if ('testingFor' in objectToTest) {
 *     str += splits[1]
 *   }
 *   return str
 * }
 * function decoder (b) {
 *   // DecodeTemplate
 * }
 * function fnName (index) {
 *   return split[index]
 * }
 * ```
 */
const deStringCompression = {
  Identifier(path) {
    const decoder_obj = findStringDecoder(path)
    if (!decoder_obj) {
      return
    }
    const get_obj = findStringGet(decoder_obj.path)
    if (!get_obj) {
      return
    }
    const split_obj = findStringSplit(get_obj.ref)
    if (!get_obj) {
      return
    }
    const fn_obj = findStringFn(split_obj.path, split_obj.name)
    if (!get_obj) {
      return
    }
    console.log(`Find stringCompression Fn: ${fn_obj.name}`)
    const vm = isolate.createContextSync()
    vm.evalSync(generator(decoder_obj.path.node).code)
    vm.evalSync(generator(get_obj.path.node).code)
    vm.evalSync('var ' + generator(split_obj.path.node).code)
    vm.evalSync(generator(fn_obj.path.node).code)
    let binding = fn_obj.path.parentPath.scope.getBinding(fn_obj.name)
    for (const ref of binding.referencePaths) {
      if (ref.key !== 'callee') {
        console.warn(
          `Unexpected ref of stringCompression Fn: ${ref.parentPath}`
        )
        continue
      }
      const repl_path = ref.parentPath
      try {
        const value = vm.evalSync(generator(repl_path.node).code)
        safeReplace(repl_path, value)
      } catch (e) {
        console.warn(
          `Unexpected ref of stringCompression Fn: ${ref.parentPath}`
        )
      }
    }
    binding.scope.crawl()
    binding = binding.scope.bindings[fn_obj.name]
    if (!binding.references) {
      fn_obj.path.remove()
    }
    binding.scope.crawl()
    binding = split_obj.path.scope.getBinding(split_obj.name)
    if (!binding.references) {
      split_obj.path.remove()
      split_obj.def.remove()
    }
    binding.scope.crawl()
    binding = get_obj.path.scope.getBinding(get_obj.name)
    if (!binding.references) {
      get_obj.path.remove()
    }
    binding.scope.crawl()
    binding = decoder_obj.path.scope.getBinding(decoder_obj.name)
    if (!binding.references) {
      decoder_obj.path.remove()
    }
  },
}

export default deStringCompression
