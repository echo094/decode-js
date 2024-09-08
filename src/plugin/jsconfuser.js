const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const ivm = require('isolated-vm')
const calculateConstantExp = require('../visitor/calculate-constant-exp')

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
      value: right.node.value,
    }
    return
  }
  if (right.isUnaryExpression() && right.node.operator === '-') {
    const value = vm.evalSync(generator(right.node).code)
    vm.evalSync(generator(father.node).code)
    cache[prop_name] = {
      type: 'value',
      value: value,
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
    safeReplace(path, value)
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
        if (body_path.scope == father.scope) {
          return
        }
        if (!father.isAssignmentExpression() || path.key !== 'left') {
          return
        }
        const prop = path.get('property')
        const prop_name = safeGetName(prop)
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
  const stk_name = path.node.params[0].argument.name
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

/**
 * Template:
 * ```javascript
 * // GetGlobalTemplate Begin
 * function {getGlobalFnName}(){
 *   var localVar = false;
 *   eval(${transform.jsConfuserVar("localVar")} + " = true")
 *   if (!localVar) {
 *     {countermeasures}
 *   }
 *   const root = eval("this");
 *   return root;
 * }
 * // GetGlobalTemplate End
 * // BufferToStringTemplate Begin
 * var __globalObject = {getGlobalFnName}() || {};
 * var __TextDecoder = __globalObject["TextDecoder"];
 * var __Uint8Array = __globalObject["Uint8Array"];
 * var __Buffer = __globalObject["Buffer"];
 * var __String = __globalObject["String"] || String;
 * var __Array = __globalObject["Array"] || Array;
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
 * // BufferToStringTemplate End
 * 
 * var cacheName = [], arrayName = []
 * 
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
const deStringConcealing = {
  ArrayExpression(path) {},
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
  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  return code
}
