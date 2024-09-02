const generator = require('@babel/generator').default
const t = require('@babel/types')

const ivm = require('isolated-vm')
const isolate = new ivm.Isolate()

const calculateConstantExp = require('../calculate-constant-exp')

const safeFunc = require('../../utility/safe-func')
const safeGetName = safeFunc.safeGetName
const safeReplace = safeFunc.safeReplace

let arrowFunc = null

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
  if (!func_len_name || func_len_name === arrowFunc) {
    return null
  }
  return {
    name: func_len_name,
    path: warp,
  }
}

/**
 * type: param, value, ref, invalid
 */
function initStackCache(len) {
  const cache = {}
  for (let i = 0; i < len; ++i) {
    cache[i] = {
      type: 'param',
    }
  }
  return cache
}

function processAssignLeft(vm, cache, path, prop_name, stk_name) {
  const father = path.parentPath
  const right = father.get('right')
  if (right.isBinaryExpression()) {
    cache[prop_name] = {
      type: 'invalid',
    }
    return
  }
  if (right.isLiteral()) {
    vm.evalSync(generator(father.node).code)
    cache[prop_name] = {
      type: 'value',
      value: right.node,
    }
    return
  }
  if (right.isArrayExpression()) {
    const elements = right.node.elements
    if (elements.length === 1 && elements[0]?.value === 'charCodeAt') {
      cache[prop_name] = {
        type: 'value',
        value: right.node,
      }
      return
    }
  }
  if (right.isUnaryExpression() && right.node.operator === '-') {
    vm.evalSync(generator(father.node).code)
    cache[prop_name] = {
      type: 'value',
      value: right.node,
    }
    return
  }
  if (right.isMemberExpression() && right.node.object?.name === stk_name) {
    const right_prop = right.get('property')
    if (right_prop.isBinaryExpression()) {
      return
    }
    let ref = safeGetName(right_prop)
    if (!Object.prototype.hasOwnProperty.call(cache, ref)) {
      cache[prop_name] = {
        type: 'invalid',
      }
      return
    }
    while (cache[ref].type === 'ref') {
      ref = cache[ref].value
    }
    if (cache[ref].type === 'value') {
      safeReplace(right, cache[ref].value)
      vm.evalSync(generator(father.node).code)
      cache[prop_name] = {
        type: 'value',
        value: cache[ref].value,
      }
    } else {
      cache[prop_name] = {
        type: 'ref',
        value: ref,
      }
    }
    return
  }
  cache[prop_name] = {
    type: 'invalid',
  }
}

function processAssignInvalid(cache, path, prop_name) {
  cache[prop_name] = {
    type: 'invalid',
  }
}

function processReplace(cache, path, prop_name) {
  const value = cache[prop_name].value
  const type = cache[prop_name].type
  if (type === 'ref') {
    path.node.computed = true
    safeReplace(path.get('property'), value)
    return true
  }
  if (type === 'value') {
    path.replaceWith(value)
    return true
  }
  return false
}

function checkStackInvalid(path) {
  const stk_name = path.node.params[0].argument.name
  const body_path = path.get('body')
  const obj = {}
  body_path.traverse({
    MemberExpression: {
      exit(path) {
        if (path.node.object.name !== stk_name) {
          return
        }
        const father = path.parentPath
        const prop = path.get('property')
        const prop_name = safeGetName(prop)
        if (father.isUpdateExpression()) {
          obj[prop_name] = 1
          return
        }
        if (body_path.scope == father.scope) {
          return
        }
        if (!father.isAssignmentExpression() || path.key !== 'left') {
          return
        }
        obj[prop_name] = 1
      },
    },
  })
  return obj
}

function tryStackReplace(path, len, invalid) {
  const stk_name = path.node.params[0].argument.name
  const body_path = path.get('body')
  const cache = initStackCache(len)
  const vm = isolate.createContextSync()
  vm.evalSync(`var ${stk_name} = []`)
  let changed = false
  body_path.traverse({
    MemberExpression: {
      exit(path) {
        if (path.node.object.name !== stk_name) {
          return
        }
        const prop = path.get('property')
        if (prop.isBinaryExpression()) {
          return
        }
        const prop_name = safeGetName(prop)
        if (!prop_name) {
          return
        }
        if (Object.prototype.hasOwnProperty.call(invalid, prop_name)) {
          processAssignInvalid(cache, path, prop_name)
          return
        }
        const exist = Object.prototype.hasOwnProperty.call(cache, prop_name)
        if (exist && cache[prop_name].type === 'param') {
          return
        }
        const father = path.parentPath
        if (father.isAssignmentExpression() && path.key === 'left') {
          processAssignLeft(vm, cache, path, prop_name, stk_name)
        } else if (exist) {
          changed |= processReplace(cache, path, prop_name)
        }
      },
    },
  })
  const binding = body_path.scope.getBinding(stk_name)
  binding.scope.crawl()
  return changed
}

function getStackParamLen(path) {
  const stk_name = path.node.params?.[0]?.argument?.name
  if (!stk_name) {
    return 'unknown'
  }
  const body_path = path.get('body')
  let len = 'unknown'
  body_path.traverse({
    MemberExpression: {
      exit(path) {
        if (path.node.object.name !== stk_name) {
          return
        }
        const prop = path.get('property')
        if (prop.isBinaryExpression()) {
          return
        }
        const prop_name = safeGetName(prop)
        if (!prop_name || prop_name !== 'length') {
          return
        }
        const father = path.parentPath
        if (!father.isAssignmentExpression() || path.key !== 'left') {
          return
        }
        const right = father.get('right')
        if (right.isBinaryExpression()) {
          return
        }
        if (!right.isLiteral()) {
          return
        }
        len = right.node.value
        path.stop()
      },
    },
  })
  return len
}

function processStackParam(path, len) {
  if (path.isArrowFunctionExpression()) {
    console.log(`Process arrowFunctionExpression, len: ${len}`)
  } else if (path.isFunctionExpression()) {
    console.log(`Process functionExpression, len: ${len}`)
  } else {
    console.log(`Process Function ${path.node.id.name}, len: ${len}`)
  }
  let changed = true
  const invalid = checkStackInvalid(path)
  while (changed) {
    changed = tryStackReplace(path, len, invalid)
    path.traverse(calculateConstantExp)
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
      const len = repl_path.node.arguments[1].value
      if (t.isIdentifier(arg)) {
        const func_name = arg.name
        const func_decl = repl_path.scope.getBinding(func_name).path
        processStackParam(func_decl, len)
        repl_path.remove()
      } else {
        repl_path.replaceWith(arg)
        processStackParam(repl_path, len)
      }
    }
    binding.scope.crawl()
    binding = obj.path.parentPath.scope.bindings[obj.name]
    if (!binding.references) {
      obj.path.remove()
    }
  },
}

const deStackFuncOther = {
  RestElement(path) {
    if (path.listKey !== 'params') {
      return
    }
    const func = path.getFunctionParent()
    const len = getStackParamLen(func)
    if (len === 'unknown') {
      return
    }
    processStackParam(func, len)
  },
}

module.exports = function (func) {
  arrowFunc = func
  return {
    deStackFuncLen,
    deStackFuncOther,
  }
}
