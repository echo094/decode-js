import _generate from '@babel/generator'
const generator = _generate.default
import * as t from '@babel/types'

import ivm from 'isolated-vm'
const isolate = new ivm.Isolate()

import findGlobalFn from './global.js'
import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode
const safeGetName = safeFunc.safeGetName
const safeReplace = safeFunc.safeReplace

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
  for (const ref of binding.referencePaths) {
    if (ref.key !== 'object' || ref.parentPath.key === 'callee') {
      return
    }
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

export default {
  deStringConcealing,
  deStringConcealingPlace,
}
