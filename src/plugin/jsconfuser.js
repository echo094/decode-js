const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const ivm = require('isolated-vm')
const calculateConstantExp = require('../visitor/calculate-constant-exp')
const pruneIfBranch = require('../visitor/prune-if-branch')

const isolate = new ivm.Isolate()

const collect_id = {
  arrowFunc: null,
}

function safeReplace(path, value) {
  if (typeof value === 'string') {
    path.replaceWith(t.stringLiteral(value))
    return
  }
  if (typeof value === 'number') {
    path.replaceWith(t.numericLiteral(value))
    return
  }
  path.replaceWithSourceString(value)
}

function safeGetName(path) {
  if (path.isIdentifier()) {
    return path.node.name
  }
  if (path.isLiteral()) {
    return path.node.value
  }
  return null
}

function safeGetLiteral(path) {
  if (path.isUnaryExpression()) {
    if (path.node.operator === '-' && path.get('argument').isNumericLiteral()) {
      return -1 * path.get('argument').node.value
    }
    return null
  }
  if (path.isLiteral()) {
    return path.node.value
  }
  return null
}

function safeDeleteNode(name, path) {
  let binding
  if (path.isFunctionDeclaration()) {
    binding = path.parentPath.scope.getBinding(name)
  } else {
    binding = path.scope.getBinding(name)
  }
  if (!binding) {
    return false
  }
  binding.scope.crawl()
  binding = binding.scope.getBinding(name)
  if (binding.references) {
    return false
  }
  for (const item of binding.constantViolations) {
    item.remove()
  }
  const decl = binding.path
  if (decl.removed) {
    return true
  }
  if (!decl.isVariableDeclarator() && !decl.isFunctionDeclaration()) {
    return true
  }
  binding.path.remove()
  return true
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

function checkPattern(code, pattern) {
  let i = 0
  let j = 0
  while (i < code.length && j < pattern.length) {
    if (code[i] == pattern[j]) {
      ++j
    }
    ++i
  }
  return j == pattern.length
}

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

function insertDepItemVar(deps, name, path) {
  const binding = path.scope.getBinding(name)
  if (binding.path === path) {
    deps.push({
      name: name,
      path: binding.path,
      node: t.variableDeclaration('var', [binding.path.node]),
      pos: binding.path.node.start,
    })
    return
  }
  deps.push({
    name: name,
    path: path,
    pos: path.node.start,
  })
  deps.push({
    name: name,
    path: binding.path,
    node: t.variableDeclaration('var', [binding.path.node]),
    pos: binding.path.node.start,
  })
}

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

/**
 * Template:
 * ```javascript
 * var __globalObject = {getGlobalFnName}() || {};
 * var __TextDecoder = __globalObject["TextDecoder"];
 * var __Uint8Array = __globalObject["Uint8Array"];
 * var __Buffer = __globalObject["Buffer"];
 * var __String = __globalObject["String"] || String;
 * var __Array = __globalObject["Array"] || Array;
 * ```
 */
function findGlobalFnRef(obj) {
  const path = obj.glo_fn_path
  const glo_fn_name = obj.glo_fn_name
  let binding = path.parentPath.scope.getBinding(glo_fn_name)
  let glo_fn_ref = binding.referencePaths[0]
  while (!glo_fn_ref.isAssignmentExpression()) {
    glo_fn_ref = glo_fn_ref.parentPath
  }
  const glo_obj_name = glo_fn_ref.node.left.name
  obj.glo_obj_name = glo_obj_name
  obj.glo_obj_path = glo_fn_ref
  obj.glo_obj_ref = {}
  insertDepItemVar(obj.deps, glo_obj_name, glo_fn_ref)
  binding = glo_fn_ref.scope.getBinding(glo_obj_name)
  for (const ref of binding.referencePaths) {
    const prop = safeGetName(ref.parentPath.get('property'))
    if (!prop) {
      continue
    }
    let root = ref
    while (!root.isAssignmentExpression()) {
      root = root.parentPath
    }
    const ref_name = safeGetName(root.get('left'))
    obj.glo_obj_ref[prop] = ref_name
    insertDepItemVar(obj.deps, ref_name, root)
  }
  return
}

/**
 * Template:
 * ```javascript
 * var utf8ArrayToStr = (function () {
 *   // ...
 * })();
 * function bufferToStringName () {
 *   if(typeof __TextDecoder !== "undefined" && __TextDecoder) {
 *     return new __TextDecoder()["decode"](new __Uint8Array(buffer));
 *   } else if(typeof __Buffer !== "undefined" && __Buffer) {
 *     return __Buffer["from"](buffer)["toString"]("utf-8");
 *   } else {
 *     return utf8ArrayToStr(buffer);
 *   }
 * }
 * ```
 */
function findBufferToString(obj) {
  const path = obj.glo_obj_path
  const ref_array = obj.glo_obj_ref['Array']
  let binding = path.scope.getBinding(ref_array)
  for (const ref of binding.referencePaths) {
    if (ref.key !== 'callee') {
      continue
    }
    let a2s_path = ref.getFunctionParent()
    while (!a2s_path.isAssignmentExpression()) {
      a2s_path = a2s_path.parentPath
    }
    obj.a2s_name = safeGetName(a2s_path.get('left'))
    obj.a2s_path = a2s_path
    insertDepItemVar(obj.deps, obj.a2s_name, obj.a2s_path)
    break
  }
  if (!obj.a2s_name) {
    return false
  }
  binding = obj.a2s_path.scope.getBinding(obj.a2s_name)
  const b2s_path = binding.referencePaths[0].getFunctionParent()
  obj.b2s_name = safeGetName(b2s_path.get('id'))
  obj.b2s_path = b2s_path
  obj.deps.push({
    name: obj.b2s_name,
    path: b2s_path,
    pos: b2s_path.node.start,
  })
  binding = b2s_path.parentPath.scope.getBinding(obj.b2s_name)
  const child = []
  for (const ref of binding.referencePaths) {
    const decode_fn = ref.getFunctionParent()
    let valid = false
    decode_fn.traverse({
      StringLiteral(path) {
        if (path.node.value.length === 91) {
          valid = true
          path.stop()
        }
      },
    })
    if (!valid) {
      return false
    }
    child.push({
      name: decode_fn.node.id.name,
      decoder: decode_fn,
    })
  }
  obj.child = child
  return true
}

function generatorStringConcealingDepCode(obj) {
  obj.deps.sort((a, b) => {
    return a.pos - b.pos
  })
  const dep_node = t.program([])
  for (const item of obj.deps) {
    if (item.node) {
      dep_node.body.push(item.node)
    } else {
      dep_node.body.push(item.path.node)
    }
  }
  obj.dep_code = generator(dep_node).code
}

function renameProperty(member) {
  const obj_name = safeGetName(member.get('object'))
  const prop_name = safeGetName(member.get('property'))
  const new_name = member.scope.generateUidIdentifier(`_tmp_local_`)
  const binding = member.scope.getBinding(obj_name)
  let first = true
  for (const ref of binding.referencePaths) {
    const item = ref.parentPath
    const prop = safeGetName(item.get('property'))
    if (prop !== prop_name) {
      continue
    }
    if (first) {
      let body = item
      while (body.listKey !== 'body') {
        body = body.parentPath
      }
      body.container.unshift(
        t.variableDeclaration('var', [t.variableDeclarator(new_name)])
      )
      body.scope.crawl()
      first = false
    }
    item.replaceWith(new_name)
  }
  member.scope.crawl()
}

/**
 * Template:
 * ```javascript
 * var cacheName = [], arrayName = []
 * // Below will appear multiple times
 * var getterFnName = (x, y, z, a, b)=>{
 *   if ( x !== y ) {
 *     return b[x] || (b[x] = a(arrayName[x]))
 *   }
 *   // Add fake ifStatements
 *   if(typeof a === "undefined") {
 *     a = decodeFn
 *   }
 *   if(typeof b === "undefined") {
 *     b = cacheName
 *   }
 * }
 * // Base91 Algo
 * function decodeFn (str){
 *   var table = {__strTable__};
 *   var raw = "" + (str || "");
 *   var len = raw.length;
 *   var ret = [];
 *   var b = 0;
 *   var n = 0;
 *   var v = -1;
 *   for (var i = 0; i < len; i++) {
 *     var p = table.indexOf(raw[i]);
 *     if (p === -1) continue;
 *     if (v < 0) {
 *       v = p;
 *     } else {
 *       v += p * 91;
 *       b |= v << n;
 *       n += (v & 8191) > 88 ? 13 : 14;
 *       do {
 *         ret.push(b & 0xff);
 *         b >>= 8;
 *         n -= 8;
 *       } while (n > 7);
 *       v = -1;
 *     }
 *   }
 *   if (v > -1) {
 *     ret.push((b | (v << n)) & 0xff);
 *   }
 *   return bufferToStringName(ret);
 * }
 * ```
 */
function processSingleGetter(obj, decoder_name, decoder_path) {
  const decoder_code = generator(decoder_path.node).code
  let binding = decoder_path.parentPath.scope.getBinding(decoder_name)
  let getter_path = binding.referencePaths[0].getFunctionParent()
  while (
    !getter_path.isAssignmentExpression() &&
    !getter_path.isVariableDeclarator()
  ) {
    getter_path = getter_path.parentPath
  }
  let getter_name
  if (getter_path.isAssignmentExpression()) {
    if (getter_path.get('left').isMemberExpression()) {
      renameProperty(getter_path.get('left'))
    }
    getter_name = safeGetName(getter_path.get('left'))
  } else {
    getter_name = safeGetName(getter_path.get('id'))
  }
  console.log(
    `[StringConcealing] getter: ${getter_name} decoder: ${decoder_name}`
  )
  const getter_code = 'var ' + generator(getter_path.node).code
  binding = getter_path.scope.getBinding(getter_name)
  if (getter_path.isAssignmentExpression()) {
    getter_path.get('right').replaceWith(t.numericLiteral(0))
  } else {
    getter_path.get('init').replaceWith(t.numericLiteral(0))
  }
  binding.scope.crawl()
  binding = getter_path.scope.getBinding(getter_name)
  let complete = false
  while (!complete) {
    complete = true
    const vm = isolate.createContextSync()
    vm.evalSync(obj.dep_code)
    try {
      for (const ref of binding.referencePaths) {
        if (ref.findParent((path) => path.removed)) {
          continue
        }
        let repl_path = ref.parentPath
        if (repl_path.isCallExpression()) {
          const args = repl_path.node.arguments
          if (args.length !== 1 || !t.isLiteral(args[0])) {
            console.warn(`[StringConcealing] Unexpected call: ${repl_path}`)
            continue
          }
        } else if (repl_path.isMemberExpression()) {
          repl_path = repl_path.parentPath
        } else {
          console.warn(`[StringConcealing] Unexpected ref: ${repl_path}`)
          continue
        }
        const eval_code = generator(repl_path.node).code
        // The name of getter can be the same as other dep functions
        const value = vm.evalSync(
          `(function (){${decoder_code}\n${getter_code}\nreturn ${eval_code}})()`
        )
        safeReplace(repl_path, value)
      }
    } catch (e) {
      if (e.name !== 'ReferenceError') {
        console.warn(`[StringConcealing] Unexpected exception: ${e.message}`)
        return
      }
      complete = false
      const lost = e.message.split(' ')[0]
      const binding = getter_path.scope.getBinding(lost)
      if (!binding) {
        console.warn(`[StringConcealing] Missing cache or array: ${lost}`)
        return
      }
      let count = binding.constantViolations.length
      if (count) {
        console.warn(`[StringConcealing] Invalid violations ${lost} : ${count}`)
        return
      }
      count = binding.path.node.init.elements.length
      if (count) {
        console.log(`[StringConcealing] Add array : ${lost}`)
        obj.array_name = lost
        obj.array_path = binding.path
      } else {
        console.log(`[StringConcealing] Add cache : ${lost}`)
        obj.cache_name = lost
        obj.cache_path = binding.path
      }
      insertDepItemVar(obj.deps, lost, binding.path)
      generatorStringConcealingDepCode(obj)
    }
  }
  safeDeleteNode(getter_name, getter_path)
  safeDeleteNode(decoder_name, decoder_path)
}

const deStringConcealing = {
  FunctionDeclaration(path) {
    const obj = findGlobalFn(path)
    if (!obj) {
      return null
    }
    if (obj.glo_fn_path.parentPath.getFunctionParent()) {
      return null
    }
    findGlobalFnRef(obj)
    if (!findBufferToString(obj)) {
      return
    }
    generatorStringConcealingDepCode(obj)
    for (const item of obj.child) {
      processSingleGetter(obj, item.name, item.decoder)
    }
    safeDeleteNode(obj.array_name, obj.array_path)
    safeDeleteNode(obj.cache_name, obj.cache_path)
    // a2s and b2s are pairs
    if (safeDeleteNode(obj.b2s_name, obj.b2s_path)) {
      obj.a2s_path.remove()
      obj.a2s_path.scope.crawl()
    }
  },
}

function tryStringConcealingPlace(path) {
  const parent = path.parentPath
  if (!parent.isAssignmentExpression()) {
    return
  }
  const name = safeGetName(parent.get('left'))
  let binding = parent.scope.getBinding(name)
  if (binding?.constantViolations?.length !== 1) {
    return
  }
  const code = generator(parent.node).code
  const vm = isolate.createContextSync()
  vm.evalSync('var ' + code)
  for (const ref of binding.referencePaths) {
    if (ref.key !== 'object') {
      continue
    }
    const test = generator(ref.parent).code
    const res = vm.evalSync(test)
    safeReplace(ref.parentPath, res)
  }
  safeDeleteNode(name, parent)
}

const deStringConcealingPlace = {
  StringLiteral(path) {
    if (path.key !== 'right' || !path.parentPath.isAssignmentExpression()) {
      return
    }
    const name = safeGetName(path.parentPath.get('left'))
    if (!name) {
      return
    }
    const binding = path.scope.getBinding(name)
    if (binding.constantViolations.length !== 1) {
      return
    }
    for (const ref of binding.referencePaths) {
      if (ref.node.start < path.node.start) {
        continue
      }
      ref.replaceWith(path.node)
    }
    safeDeleteNode(name, path.parentPath)
  },
  ArrayExpression(path) {
    let valid = true
    if (path.node.elements.length === 0) {
      return
    }
    for (const ele of path.node.elements) {
      if (!t.isStringLiteral(ele)) {
        valid = false
        break
      }
    }
    if (!valid) {
      return
    }
    tryStringConcealingPlace(path)
  },
  ObjectExpression(path) {
    let valid = true
    if (path.node.properties.length === 0) {
      return
    }
    for (const ele of path.node.properties) {
      if (!t.isStringLiteral(ele.value)) {
        valid = false
        break
      }
    }
    if (!valid) {
      return
    }
    tryStringConcealingPlace(path)
  },
}

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
      const key = parseInt(generator(path.node.test).code)
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
    for (const ref of binding.referencePaths) {
      const repl_path = ref.parentPath
      if (ref.key !== 'callee' || !repl_path.isCallExpression()) {
        continue
      }
      const key = parseInt(generator(repl_path.node.arguments[0]).code)
      repl_path.replaceWith(t.identifier(glo_vars[key]))
    }
    if (safeDeleteNode(obj.glo_fn_name, obj.glo_fn_path)) {
      obj.tmp_path.remove()
    }
  },
}

function checkControlVar(path) {
  const parent = path.parentPath
  if (path.key !== 'right' || !parent.isAssignmentExpression()) {
    return false
  }
  const var_path = parent.get('left')
  const var_name = var_path.node?.name
  if (!var_name) {
    return false
  }
  let root_path = parent.parentPath
  if (root_path.isExpressionStatement) {
    root_path = root_path.parentPath
  }
  const binding = parent.scope.getBinding(var_name)
  for (const ref of binding.referencePaths) {
    if (ref === var_path) {
      continue
    }
    let cur = ref
    let valid = false
    while (cur && cur !== root_path) {
      if (cur.isSwitchCase() || cur === path) {
        valid = true
        break
      }
      cur = cur.parentPath
    }
    if (!valid) {
      return false
    }
    if (ref.key === 'object') {
      const prop = ref.parentPath.get('property')
      if (!prop.isLiteral() && !prop.isIdentifier()) {
        return false
      }
      continue
    }
    if (ref.key === 'right') {
      const left = ref.parentPath.get('left')
      if (!left.isMemberExpression()) {
        return false
      }
      const obj = safeGetName(left.get('object'))
      if (obj !== var_name) {
        return false
      }
      continue
    }
  }
  return true
}

/**
 * Process the constant properties in the controlVar
 *
 * Template:
 * ```javascript
 * controlVar = {
 *   // strings
 *   key_string: 'StringLiteral',
 *   // numbers
 *   key_number: 'NumericLiteral',
 * }
 * ```
 *
 * Some kinds of deadCode may in inserted to the fake chunks:
 *
 * ```javascript
 * controlVar = false
 * controlVar = undefined
 * controlVar[randomControlKey] = undefined
 * delete controlVar[randomControlKey]
 * ```
 */
const deControlFlowFlatteningStateless = {
  ObjectExpression(path) {
    if (!checkControlVar(path)) {
      return
    }
    const parent = path.parentPath
    const var_name = parent.get('left').node?.name
    console.log(`[ControlFlowFlattening] parse stateless in obj: ${var_name}`)
    const props = {}
    const prop_num = path.node.properties.length
    for (let i = 0; i < prop_num; ++i) {
      const prop = path.get(`properties.${i}`)
      const key = safeGetName(prop.get('key'))
      const value = safeGetLiteral(prop.get('value'))
      if (!key || !value) {
        continue
      }
      props[key] = value
    }
    const binding = parent.scope.getBinding(var_name)
    for (const ref of binding.referencePaths) {
      if (ref.key !== 'object') {
        continue
      }
      const prop = safeGetName(ref.parentPath.get('property'))
      if (!prop) {
        continue
      }
      if (!Object.prototype.hasOwnProperty.call(props, prop)) {
        continue
      }
      const upper = ref.parentPath
      if (upper.key === 'left' && upper.parentPath.isAssignmentExpression()) {
        // this is in the fake chunk
        ref.parentPath.parentPath.remove()
        continue
      }
      safeReplace(ref.parentPath, props[prop])
    }
    binding.scope.crawl()
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
  // DuplicateLiteralsRemoval
  traverse(ast, deDuplicateLiteral)
  // Stack
  traverse(ast, deStackFuncLen)
  traverse(ast, deStackFuncOther)
  // StringCompression
  traverse(ast, deStringCompression)
  // StringConcealing
  traverse(ast, deStringConcealing)
  traverse(ast, deStringConcealingPlace)
  // StringSplitting
  traverse(ast, calculateConstantExp)
  // Stack (run again)
  traverse(ast, deStackFuncOther)
  // OpaquePredicates
  traverse(ast, deOpaquePredicates)
  traverse(ast, calculateConstantExp)
  traverse(ast, pruneIfBranch)
  // GlobalConcealing
  traverse(ast, deGlobalConcealing)
  // ControlFlowFlattening
  traverse(ast, deControlFlowFlatteningStateless)
  traverse(ast, calculateConstantExp)
  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  return code
}
