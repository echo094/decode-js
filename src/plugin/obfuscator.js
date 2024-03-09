/**
 * 整合自下面两个项目：
 * * cilame/v_jstools
 * * Cqxstevexw/decodeObfuscator
 */
const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const vm = require('vm')
const { VM } = require('vm2')
const PluginEval = require('./eval.js')

let globalContext = vm.createContext()
let vm2 = new VM({
  allowAsync: false,
  sandbox: globalContext,
})
function virtualGlobalEval(jsStr) {
  return vm2.run(String(jsStr))
}

/**
 * Extract the literal value of an object, and remove an object if all
 * references to the object are replaced.
 */
function decodeObject(ast) {
  function collectObject(path) {
    const id = path.node.id
    const init = path.node.init
    if (!t.isIdentifier(id) || !t.isObjectExpression(init)) {
      return
    }
    const obj_name = id.name
    const bind = path.scope.getBinding(obj_name)
    let valid = true
    let count = 0
    let obj = {}
    for (const item of init.properties) {
      if (!t.isObjectProperty(item) || !t.isLiteral(item.value)) {
        valid = false
        break
      }
      if (!t.isIdentifier(item.key)) {
        valid = false
        break
      }
      ++count
      obj[item.key.name] = item.value
    }
    if (!valid || !count) {
      return
    }
    let safe = true
    for (let ref of bind.referencePaths) {
      const parent = ref.parentPath
      if (ref.key !== 'object' || !parent.isMemberExpression()) {
        safe = false
        continue
      }
      const key = parent.node.property
      if (!t.isIdentifier(key) || parent.node.computed) {
        safe = false
        continue
      }
      if (Object.prototype.hasOwnProperty.call(obj, key.name)) {
        parent.replaceWith(obj[key.name])
      } else {
        safe = false
      }
    }
    bind.scope.crawl()
    if (safe) {
      path.remove()
      console.log(`删除对象: ${obj_name}`)
    }
  }
  traverse(ast, {
    VariableDeclarator: collectObject,
  })
  return ast
}

/**
 * Before version 2.19.0, the string-array is a single array.
 * Hence, we have to find StringArrayRotateFunction instead.
 *
 * @param {t.File} ast The ast file
 * @returns Object
 */
function stringArrayV2(ast) {
  console.info('Try v2 mode...')
  let obj = {
    version: 2,
    stringArrayName: null,
    stringArrayCodes: [],
    stringArrayCalls: [],
  }
  // Function to rotate string list ("func2")
  function find_rotate_function(path) {
    const callee = path.get('callee')
    const args = path.node.arguments
    if (
      !callee.isFunctionExpression() ||
      callee.node.params.length !== 2 ||
      args.length == 0 ||
      args.length > 2 ||
      !t.isIdentifier(args[0])
    ) {
      return
    }
    const arr = callee.node.params[0].name
    const cmpV = callee.node.params[1].name
    // >= 2.10.0
    const fp1 = `(){try{if()break${arr}push(${arr}shift())}catch(){${arr}push(${arr}shift())}}`
    // < 2.10.0
    const fp2 = `=function(){while(--){${arr}push(${arr}shift)}}${cmpV}`
    const code = '' + callee.get('body')
    if (!checkPattern(code, fp1) && !checkPattern(code, fp2)) {
      return
    }
    obj.stringArrayName = args[0].name
    // The string array can be found by its binding
    const bind = path.scope.getBinding(obj.stringArrayName)
    const def = t.variableDeclaration('var', [bind.path.node])
    obj.stringArrayCodes.push(generator(def, { minified: true }).code)
    // The calls can be found by its references
    for (let ref of bind.referencePaths) {
      if (ref?.listKey === 'arguments') {
        // This is the rotate function
        continue
      }
      if (ref.findParent((path) => path.removed)) {
        continue
      }
      // the key is 'object'
      let up1 = ref.getFunctionParent()
      if (up1.node.id) {
        // 2.12.0 <= v < 2.15.4
        // The `stringArrayCallsWrapperName` is included in the definition
        obj.stringArrayCalls.push(up1.node.id.name)
        obj.stringArrayCodes.push(generator(up1.node, { minified: true }).code)
        up1.remove()
        continue
      }
      if (up1.key === 'init') {
        // v < 2.12.0
        // The `stringArrayCallsWrapperName` is defined by VariableDeclarator
        up1 = up1.parentPath
        obj.stringArrayCalls.push(up1.node.id.name)
        up1 = up1.parentPath
        obj.stringArrayCodes.push(generator(up1.node, { minified: true }).code)
        up1.remove()
        continue
      }
      // 2.15.4 <= v < 2.19.0
      // The function includes another function with the same name
      up1 = up1.parentPath
      const wrapper = up1.node.left.name
      let up2 = up1.getFunctionParent()
      if (!up2 || up2.node?.id?.name !== wrapper) {
        console.warn('Unexpected reference!')
        continue
      }
      obj.stringArrayCalls.push(wrapper)
      obj.stringArrayCodes.push(generator(up2.node, { minified: true }).code)
      up2.remove()
    }
    // Remove the string array
    bind.path.remove()
    // Add the rotate function
    const node = t.expressionStatement(path.node)
    obj.stringArrayCodes.push(generator(node, { minified: true }).code)
    path.stop()
    if (path.parentPath.isUnaryExpression()) {
      path.parentPath.remove()
    } else {
      path.remove()
    }
  }
  traverse(ast, { CallExpression: find_rotate_function })
  if (obj.stringArrayCodes.length < 3 || !obj.stringArrayCalls.length) {
    console.error('Essential code missing!')
    obj.stringArrayName = null
  }
  return obj
}

/**
 * Find the string-array codes by matching string-array function
 * (valid version >= 2.19.0)
 *
 * @param {t.File} ast The ast file
 * @returns Object
 */
function stringArrayV3(ast) {
  console.info('Try v3 mode...')
  let ob_func_str = []
  let ob_dec_name = []
  let ob_string_func_name = null
  // Normally, the string array func ("func1") follows the template below:
  // function aaa() {
  //   const bbb = [...]
  //   aaa = function () {
  //     return bbb;
  //   };
  //   return aaa();
  // }
  // In some cases (lint), the assignment is merged into the ReturnStatement
  // After finding the possible func1, this method will check all the binding
  // references and put the child encode function into list.
  function find_string_array_function(path) {
    if (path.getFunctionParent()) {
      return
    }
    if (
      !t.isIdentifier(path.node.id) ||
      path.node.params.length ||
      !t.isBlockStatement(path.node.body)
    ) {
      return
    }
    const body = path.node.body.body
    if (body.length < 2 || body.length > 3) {
      return
    }
    const name_func = path.node.id.name
    let string_var = -1
    try {
      if (
        body[0].declarations.length != 1 ||
        !(string_var = body[0].declarations[0].id.name) ||
        !t.isArrayExpression(body[0].declarations[0].init)
      ) {
        return
      }
      const nodes = [...body]
      nodes.shift()
      const code = generator(t.BlockStatement(nodes)).code
      const fp = `${name_func}=function(){return${string_var}}${name_func}()`
      if (!checkPattern(code, fp)) {
        return
      }
    } catch {
      return
    }
    const binding = path.scope.getBinding(name_func)
    if (!binding.referencePaths) {
      return
    }
    let paths = binding.referencePaths
    let nodes = []
    // The sorting function maybe missing in some config
    function find2(refer_path) {
      if (
        refer_path.parentPath.isCallExpression() &&
        refer_path.listKey === 'arguments' &&
        refer_path.key === 0
      ) {
        let rm_path = refer_path.parentPath
        if (rm_path.parentPath.isExpressionStatement()) {
          rm_path = rm_path.parentPath
        }
        nodes.push([rm_path.node, 'func2'])
        rm_path.remove()
      }
    }
    paths.map(find2)
    function find3(refer_path) {
      if (refer_path.findParent((path) => path.removed)) {
        return
      }
      if (
        refer_path.parentPath.isCallExpression() &&
        refer_path.key === 'callee'
      ) {
        let rm_path = refer_path.parentPath.getFunctionParent()
        if (name_func == rm_path.node.id.name) {
          return
        }
        nodes.push([rm_path.node, 'func3'])
        rm_path.remove()
      } else {
        console.error('Unexpected reference')
      }
    }
    paths.map(find3)
    if (!name_func) {
      return
    }
    ob_string_func_name = name_func
    ob_func_str.push(generator(path.node, { minified: true }).code)
    nodes.map(function (item) {
      let node = item[0]
      if (item[1] == 'func3') {
        ob_dec_name.push(node.id.name)
      }
      if (t.isCallExpression(node)) {
        node = t.expressionStatement(node)
      }
      ob_func_str.push(generator(node, { minified: true }).code)
    })
    path.stop()
    path.remove()
  }
  traverse(ast, { FunctionDeclaration: find_string_array_function })
  return {
    version: 3,
    stringArrayName: ob_string_func_name,
    stringArrayCodes: ob_func_str,
    stringArrayCalls: ob_dec_name,
  }
}

function decodeGlobal(ast) {
  let obj = stringArrayV3(ast)
  if (!obj.stringArrayName) {
    obj = stringArrayV2(ast)
    if (!obj.stringArrayName) {
      console.error('Cannot find string list!')
      return false
    }
  }
  console.log(`String List Name: ${obj.stringArrayName}`)
  let ob_func_str = obj.stringArrayCodes
  let ob_dec_name = obj.stringArrayCalls
  try {
    virtualGlobalEval(ob_func_str.join(';'))
  } catch (e) {
    // issue #31
    if (e.name === 'ReferenceError') {
      let lost = e.message.split(' ')[0]
      traverse(ast, {
        Program(path) {
          ob_dec_name.push(lost)
          let loc = path.scope.getBinding(lost).path
          let obj = t.variableDeclaration(loc.parent.kind, [loc.node])
          ob_func_str.unshift(generator(obj, { minified: true }).code)
          loc.remove()
          path.stop()
        },
      })
      virtualGlobalEval(ob_func_str.join(';'))
    }
  }

  // 循环删除混淆函数
  let call_dict = {}
  let exist_names = ob_dec_name
  let collect_codes = []
  let collect_names = []
  function do_parse_value(path) {
    let name = path.node.callee.name
    if (path.node.callee && exist_names.indexOf(name) != -1) {
      let old_call = path + ''
      try {
        // 运行成功则说明函数为直接调用并返回字符串
        let new_str = virtualGlobalEval(old_call)
        console.log(`map: ${old_call} -> ${new_str}`)
        call_dict[old_call] = new_str
      } catch (e) {
        // 运行失败则说明函数为其它混淆函数的子函数
        console.log(`sub: ${old_call}`)
      }
    }
  }
  function do_collect_remove(path) {
    // 可以删除所有已收集混淆函数的定义
    // 因为根函数已被删除 即使保留也无法运行
    let node = path.node?.left
    if (!node) {
      node = path.node?.id
    }
    let name = node?.name
    if (exist_names.indexOf(name) != -1) {
      // console.log(`del: ${name}`)
      if (path.parentPath.isCallExpression()) {
        path.replaceWith(node)
      } else {
        path.remove()
      }
    }
  }
  function do_collect_func(path) {
    // function A (...) { return function B (...) }
    if (
      path.node.body.body.length == 1 &&
      path.node.body.body[0].type == 'ReturnStatement' &&
      path.node.body.body[0].argument?.type == 'CallExpression' &&
      path.node.body.body[0].argument.callee.type == 'Identifier' &&
      // path.node.params.length == 5 &&
      path.node.id
    ) {
      let call_func = path.node.body.body[0].argument.callee.name
      if (exist_names.indexOf(call_func) == -1) {
        return
      }
      let name = path.node.id.name
      let t = generator(path.node, { minified: true }).code
      if (collect_names.indexOf(name) == -1) {
        collect_codes.push(t)
        collect_names.push(name)
      } else {
        console.log(`err: redef ${name}`)
      }
    }
  }
  function do_collect_var(path) {
    // var A = B
    let left, right
    if (t.isVariableDeclarator(path.node)) {
      left = path.node.id
      right = path.node.init
    } else {
      left = path.node.left
      right = path.node.right
    }
    if (right?.type == 'Identifier' && exist_names.indexOf(right.name) != -1) {
      let name = left.name
      let t = 'var ' + generator(path.node, { minified: true }).code
      if (collect_names.indexOf(name) == -1) {
        collect_codes.push(t)
        collect_names.push(name)
      } else {
        console.warning(`redef ${name}`)
      }
    }
  }
  while (exist_names.length) {
    // 查找已收集混淆函数的调用并建立替换关系
    traverse(ast, { CallExpression: do_parse_value })
    // 删除被使用过的定义
    traverse(ast, { FunctionDeclaration: do_collect_remove })
    traverse(ast, { VariableDeclarator: do_collect_remove })
    traverse(ast, { AssignmentExpression: do_collect_remove })
    // 收集所有调用已收集混淆函数的混淆函数
    collect_codes = []
    collect_names = []
    traverse(ast, { FunctionDeclaration: do_collect_func })
    traverse(ast, { VariableDeclarator: do_collect_var })
    traverse(ast, { AssignmentExpression: do_collect_var })
    exist_names = collect_names
    // 执行找到的函数
    virtualGlobalEval(collect_codes.join(';'))
  }
  // 替换混淆函数
  function do_replace(path) {
    let old_call = path + ''
    if (Object.prototype.hasOwnProperty.call(call_dict, old_call)) {
      path.replaceWith(t.StringLiteral(call_dict[old_call]))
    }
  }
  traverse(ast, { CallExpression: do_replace })
  return true
}

function stringArrayLite(ast) {
  const visitor = {
    VariableDeclarator(path) {
      const name = path.node.id.name
      if (!path.get('init').isArrayExpression()) {
        return
      }
      const elements = path.node.init.elements
      for (const element of elements) {
        if (!t.isLiteral(element)) {
          return
        }
      }
      const bind = path.scope.getBinding(name)
      if (!bind.constant) {
        return
      }
      for (const ref of bind.referencePaths) {
        if (
          !ref.parentPath.isMemberExpression() ||
          ref.key !== 'object' ||
          ref.parentPath.key == 'left' ||
          !t.isNumericLiteral(ref.parent.property)
        ) {
          return
        }
      }
      console.log(`Extract string array: ${name}`)
      for (const ref of bind.referencePaths) {
        const i = ref.parent.property.value
        ref.parentPath.replaceWith(elements[i])
      }
      bind.scope.crawl()
      path.remove()
    },
  }
  traverse(ast, visitor)
}

function mergeObject(path) {
  // var _0xb28de8 = {};
  // _0xb28de8["abcd"] = function(_0x22293f, _0x5a165e) {
  //     return _0x22293f == _0x5a165e;
  // };
  // _0xb28de8.dbca = function(_0xfbac1e, _0x23462f, _0x556555) {
  //     return _0xfbac1e(_0x23462f, _0x556555);
  // };
  // _0xb28de8.aaa = function(_0x57e640) {
  //     return _0x57e640();
  // };
  // _0xb28de8["bbb"] = "eee";
  // var _0x15e145 = _0xb28de8;
  //  |
  //  |
  //  |
  //  v
  // var _0xb28de8 = {
  //   "abcd": function (_0x22293f, _0x5a165e) {
  //     return _0x22293f == _0x5a165e;
  //   },
  //   "dbca": function (_0xfbac1e, _0x23462f, _0x556555) {
  //     return _0xfbac1e(_0x23462f, _0x556555);
  //   },
  //   "aaa": function (_0x57e640) {
  //     return _0x57e640();
  //   },
  //   "bbb": "eee"
  // };
  //
  // Note:
  // Constant objects in the original code can be splitted
  // AssignmentExpression can be moved to ReturnStatement
  const { id, init } = path.node
  if (!t.isObjectExpression(init)) {
    // 判断是否是定义对象
    return
  }
  let name = id.name
  let scope = path.scope
  let binding = scope.getBinding(name)
  if (!binding || !binding.constant) {
    // 确认该对象没有被多次定义
    return
  }
  // 添加已有的key
  let keys = {}
  let properties = init.properties
  for (let prop of properties) {
    let key = null
    if (t.isStringLiteral(prop.key)) {
      key = prop.key.value
    }
    if (t.isIdentifier(prop.key)) {
      key = prop.key.name
    }
    if (key) {
      keys[key] = true
    }
  }
  // 遍历作用域检测是否含有局部混淆特征并合并成员
  let merges = []
  const container = path.parentPath.parentPath
  let idx = path.parentPath.key
  let cur = 0
  let valid = true
  // Check references in sequence
  while (cur < binding.references) {
    const ref = binding.referencePaths[cur]
    if (ref.key !== 'object' || !ref.parentPath.isMemberExpression()) {
      break
    }
    const me = ref.parentPath
    if (me.key !== 'left' || !me.parentPath.isAssignmentExpression()) {
      break
    }
    const ae = me.parentPath
    let bk = ae
    while (bk.parentPath.isExpression()) {
      bk = bk.parentPath
    }
    if (bk.parentPath.isExpressionStatement()) {
      bk = bk.parentPath
    }
    if (bk.parentPath !== container || bk.key - idx > 1) {
      break
    }
    idx = bk.key
    const property = me.node.property
    let key = null
    if (t.isStringLiteral(property)) {
      key = property.value
    }
    if (t.isIdentifier(property)) {
      key = property.name
    }
    if (!key) {
      valid = false
      break
    }
    // 不允许出现重定义
    if (Object.prototype.hasOwnProperty.call(keys, key)) {
      valid = false
      break
    }
    // 添加到列表
    properties.push(t.ObjectProperty(t.valueToNode(key), ae.node.right))
    keys[key] = true
    merges.push(ae)
    ++cur
  }
  if (!merges.length || !valid) {
    return
  }
  // Remove code
  console.log(`尝试性合并: ${name}`)
  for (let ref of merges) {
    const left = ref.node.left
    if (
      ref.parentPath.isVariableDeclarator() ||
      ref.parentPath.isAssignmentExpression()
    ) {
      ref.replaceWith(left)
    } else {
      if (ref.parentPath.isSequenceExpression() && ref.container.length === 1) {
        ref = ref.parentPath
      }
      ref.remove()
    }
  }
  while (cur < binding.references) {
    const ref = binding.referencePaths[cur++]
    const up1 = ref.parentPath
    if (!up1.isVariableDeclarator()) {
      continue
    }
    let child = up1.node.id.name
    if (!up1.scope.bindings[child]?.constant) {
      continue
    }
    up1.scope.rename(child, name, up1.scope.block)
    up1.remove()
  }
  scope.crawl()
}

function unpackCall(path) {
  // var _0xb28de8 = {
  //     "abcd": function(_0x22293f, _0x5a165e) {
  //         return _0x22293f == _0x5a165e;
  //     },
  //     "dbca": function(_0xfbac1e, _0x23462f, _0x556555) {
  //         return _0xfbac1e(_0x23462f, _0x556555);
  //     },
  //     "aaa": function(_0x57e640) {
  //         return _0x57e640();
  //     },
  //     "bbb": "eee",
  //     "ccc": A[x][y][...]
  // };
  // var aa = _0xb28de8["abcd"](123, 456);
  // var bb = _0xb28de8["dbca"](bcd, 11, 22);
  // var cc = _0xb28de8["aaa"](dcb);
  // var dd = _0xb28de8["bbb"];
  // var ee = _0xb28de8["ccc"];
  //   |
  //   |
  //   |
  //   v
  // var aa = 123 == 456;
  // var bb = bcd(11, 22);
  // var cc = dcb();
  // var dd = "eee";
  // var ee = A[x][y][...];
  let node = path.node
  // 变量必须定义为Object类型才可能是代码块加密内容
  if (!t.isObjectExpression(node.init)) {
    return
  }
  let objPropertiesList = node.init.properties
  if (objPropertiesList.length == 0) {
    return
  }
  // 遍历Object 判断每个元素是否符合格式
  let objName = node.id.name
  let objKeys = {}
  // 有时会有重复的定义
  let replCount = 0
  objPropertiesList.map(function (prop) {
    if (!t.isObjectProperty(prop)) {
      return
    }
    let key
    if (t.isIdentifier(prop.key)) {
      key = prop.key.name
    } else {
      key = prop.key.value
    }
    if (t.isFunctionExpression(prop.value)) {
      // 符合要求的函数必须有且仅有一条return语句
      if (prop.value.body.body.length !== 1) {
        return
      }
      let retStmt = prop.value.body.body[0]
      if (!t.isReturnStatement(retStmt)) {
        return
      }
      // 检测是否是3种格式之一
      let repfunc = null
      if (t.isBinaryExpression(retStmt.argument)) {
        // 二元运算类型
        repfunc = function (_path, args) {
          _path.replaceWith(
            t.binaryExpression(retStmt.argument.operator, args[0], args[1])
          )
        }
      } else if (t.isLogicalExpression(retStmt.argument)) {
        // 逻辑判断类型
        repfunc = function (_path, args) {
          _path.replaceWith(
            t.logicalExpression(retStmt.argument.operator, args[0], args[1])
          )
        }
      } else if (t.isCallExpression(retStmt.argument)) {
        // 函数调用类型 调用的函数必须是传入的第一个参数
        if (!t.isIdentifier(retStmt.argument.callee)) {
          return
        }
        if (retStmt.argument.callee.name !== prop.value.params[0]?.name) {
          return
        }
        repfunc = function (_path, args) {
          _path.replaceWith(t.callExpression(args[0], args.slice(1)))
        }
      }
      if (repfunc) {
        objKeys[key] = repfunc
        ++replCount
      }
    } else if (t.isStringLiteral(prop.value)) {
      let retStmt = prop.value.value
      objKeys[key] = function (_path) {
        _path.replaceWith(t.stringLiteral(retStmt))
      }
      ++replCount
    } else if (t.isMemberExpression(prop.value)) {
      let retStmt = prop.value
      objKeys[key] = function (_path) {
        _path.replaceWith(retStmt)
      }
      ++replCount
    }
  })
  // 如果Object内的元素不全符合要求 很有可能是普通的字符串类型 不需要替换
  if (!replCount) {
    return
  }
  if (objPropertiesList.length !== replCount) {
    console.log(
      `不完整替换: ${objName} ${replCount}/${objPropertiesList.length}`
    )
    return
  }
  // 遍历作用域进行替换 分为函数调用和字符串调用
  console.log(`处理代码块: ${objName}`)
  let objUsed = {}
  function getReplaceFunc(_node) {
    // 这里开始所有的调用应该都在列表中
    let key = null
    if (t.isStringLiteral(_node.property)) {
      key = _node.property.value
    } else if (t.isIdentifier(_node.property)) {
      key = _node.property.name
    } else {
      // Maybe the code was obfuscated more than once
      const code = generator(_node.property, { minified: true }).code
      console.log(`意外的调用: ${objName}[${code}]`)
      return null
    }
    if (!Object.prototype.hasOwnProperty.call(objKeys, key)) {
      // 这里应该是在死代码中 因为key不存在
      return null
    }
    objUsed[key] = true
    return objKeys[key]
  }
  let bind = path.scope.getBinding(objName)?.referencePaths
  let usedCount = 0
  // Replace reversely to handle nested cases correctly
  for (let i = bind.length - 1; i >= 0; --i) {
    let ref = bind[i]
    let up1 = ref.parentPath
    if (up1.isMemberExpression() && ref.key === 'object') {
      if (up1.key === 'left' && t.isAssignmentExpression(up1.parent)) {
        continue
      }
      let func = getReplaceFunc(up1.node)
      if (!func) {
        continue
      }
      ++usedCount
      let up2 = up1.parentPath
      if (up1.key === 'callee') {
        func(up2, up2.node.arguments)
      } else {
        func(up1)
      }
    }
  }
  // 如果没有全部使用 就先不删除
  if (usedCount !== bind.length) {
    console.log(`不完整使用: ${objName} ${usedCount}/${bind.length}`)
  } else {
    path.remove()
  }
}

function calcBinary(path) {
  let tps = ['StringLiteral', 'BooleanLiteral', 'NumericLiteral']
  let nod = path.node
  function judge(e) {
    return (
      tps.indexOf(e.type) != -1 ||
      (e.type == 'UnaryExpression' && tps.indexOf(e.argument.type) != -1)
    )
  }
  function make_rep(e) {
    if (typeof e == 'number') {
      return t.NumericLiteral(e)
    }
    if (typeof e == 'string') {
      return t.StringLiteral(e)
    }
    if (typeof e == 'boolean') {
      return t.BooleanLiteral(e)
    }
    throw Error('unknown type' + typeof e)
  }
  if (judge(nod.left) && judge(nod.right)) {
    path.replaceWith(make_rep(eval(path + '')))
  }
}

function decodeCodeBlock(ast) {
  // 合并字面量
  traverse(ast, { BinaryExpression: { exit: calcBinary } })
  // 先合并分离的Object定义
  traverse(ast, { VariableDeclarator: { exit: mergeObject } })
  // 在变量定义完成后判断是否为代码块加密内容
  traverse(ast, { VariableDeclarator: { exit: unpackCall } })
  // 合并字面量(在解除区域混淆后会出现新的可合并分割)
  traverse(ast, { BinaryExpression: { exit: calcBinary } })
  return ast
}

function purifyBoolean(path) {
  // 简化 ![] 和 !![]
  const node0 = path.node
  if (node0.operator !== '!') {
    return
  }
  const node1 = node0.argument
  if (t.isArrayExpression(node1) && node1.elements.length === 0) {
    path.replaceWith(t.booleanLiteral(false))
    return
  }
  if (!t.isUnaryExpression(node1) || node1.operator !== '!') {
    return
  }
  const node2 = node1.argument
  if (t.isArrayExpression(node2) && node2.elements.length === 0) {
    path.replaceWith(t.booleanLiteral(true))
  }
}

function cleanIFCode(path) {
  function clear(path, toggle) {
    // 判定成立
    if (toggle) {
      if (path.node.consequent.type == 'BlockStatement') {
        path.replaceWithMultiple(path.node.consequent.body)
      } else {
        path.replaceWith(path.node.consequent)
      }
      return
    }
    // 判定不成立
    if (!path.node.alternate) {
      path.remove()
      return
    }
    if (path.node.alternate.type == 'BlockStatement') {
      path.replaceWithMultiple(path.node.alternate.body)
    } else {
      path.replaceWith(path.node.alternate)
    }
  }
  // 判断判定是否恒定
  const test = path.node.test
  const types = ['StringLiteral', 'NumericLiteral', 'BooleanLiteral']
  if (test.type === 'BinaryExpression') {
    if (
      types.indexOf(test.left.type) !== -1 &&
      types.indexOf(test.right.type) !== -1
    ) {
      const left = JSON.stringify(test.left.value)
      const right = JSON.stringify(test.right.value)
      clear(path, eval(left + test.operator + right))
    }
  } else if (types.indexOf(test.type) !== -1) {
    clear(path, eval(JSON.stringify(test.value)))
  }
}

function cleanSwitchCode(path) {
  // 扁平控制：
  // 会使用一个恒为true的while语句包裹一个switch语句
  // switch语句的执行顺序又while语句上方的字符串决定
  // 首先碰断是否符合这种情况
  const node = path.node
  let valid = false
  if (t.isBooleanLiteral(node.test) && node.test.value) {
    valid = true
  }
  if (t.isArrayExpression(node.test) && node.test.elements.length === 0) {
    valid = true
  }
  if (!valid) {
    return
  }
  if (!t.isBlockStatement(node.body)) {
    return
  }
  const body = node.body.body
  if (
    !t.isSwitchStatement(body[0]) ||
    !t.isMemberExpression(body[0].discriminant) ||
    !t.isBreakStatement(body[1])
  ) {
    return
  }
  // switch语句的两个变量
  const swithStm = body[0]
  const arrName = swithStm.discriminant.object.name
  const argName = swithStm.discriminant.property.argument.name
  // 在while上面的节点寻找这两个变量
  let arr = []
  let rm = []
  path.getAllPrevSiblings().forEach((pre_path) => {
    for (let i = 0; i < pre_path.node.declarations.length; ++i) {
      const declaration = pre_path.get(`declarations.${i}`)
      let { id, init } = declaration.node
      if (arrName == id.name) {
        if (t.isStringLiteral(init?.callee?.object)) {
          arr = init.callee.object.value.split('|')
          rm.push(declaration)
        }
      }
      if (argName == id.name) {
        if (t.isLiteral(init)) {
          rm.push(declaration)
        }
      }
    }
  })
  if (rm.length !== 2) {
    return
  }
  rm.forEach((pre_path) => {
    pre_path.remove()
  })
  console.log(`扁平化还原: ${arrName}[${argName}]`)
  // 重建代码块
  const caseList = swithStm.cases
  let resultBody = []
  arr.map((targetIdx) => {
    // 从当前序号开始直到遇到continue
    let valid = true
    targetIdx = parseInt(targetIdx)
    while (valid && targetIdx < caseList.length) {
      const targetBody = caseList[targetIdx].consequent
      const test = caseList[targetIdx].test
      if (!t.isStringLiteral(test) || parseInt(test.value) !== targetIdx) {
        console.log(`switch中出现乱序的序号: ${test.value}:${targetIdx}`)
      }
      for (let i = 0; i < targetBody.length; ++i) {
        const s = targetBody[i]
        if (t.isContinueStatement(s)) {
          valid = false
          break
        }
        if (t.isReturnStatement(s)) {
          valid = false
          resultBody.push(s)
          break
        }
        if (t.isBreakStatement(s)) {
          console.log(`switch中出现意外的break: ${arrName}[${argName}]`)
        } else {
          resultBody.push(s)
        }
      }
      targetIdx++
    }
  })
  // 替换整个while语句
  path.replaceInline(resultBody)
}

function cleanDeadCode(ast) {
  traverse(ast, { UnaryExpression: purifyBoolean })
  traverse(ast, { IfStatement: cleanIFCode })
  traverse(ast, { ConditionalExpression: cleanIFCode })
  traverse(ast, { WhileStatement: { exit: cleanSwitchCode } })
  return ast
}

const splitVariableDeclarator = {
  VariableDeclarator(path) {
    const init = path.get('init')
    if (!init.isAssignmentExpression()) {
      return
    }
    path.parentPath.insertBefore(init.node)
    init.replaceWith(init.node.left)
    path.parentPath.scope.crawl()
  },
}

function standardIfStatement(path) {
  const consequent = path.get('consequent')
  const alternate = path.get('alternate')
  const test = path.get('test')
  const evaluateTest = test.evaluateTruthy()

  if (!consequent.isBlockStatement()) {
    consequent.replaceWith(t.BlockStatement([consequent.node]))
  }
  if (alternate.node !== null && !alternate.isBlockStatement()) {
    alternate.replaceWith(t.BlockStatement([alternate.node]))
  }

  if (consequent.node.body.length == 0) {
    if (alternate.node == null) {
      path.replaceWith(test.node)
    } else {
      consequent.replaceWith(alternate.node)
      alternate.remove()
      path.node.alternate = null
      test.replaceWith(t.unaryExpression('!', test.node, true))
    }
  }

  if (alternate.isBlockStatement() && alternate.node.body.length == 0) {
    alternate.remove()
    path.node.alternate = null
  }

  if (evaluateTest === true) {
    path.replaceWithMultiple(consequent.node.body)
  } else if (evaluateTest === false) {
    alternate.node === null
      ? path.remove()
      : path.replaceWithMultiple(alternate.node.body)
  }
}

function standardLoop(path) {
  const node = path.node
  if (!t.isBlockStatement(node.body)) {
    node.body = t.BlockStatement([node.body])
  }
}

function splitSequence(path) {
  let { scope, parentPath, node } = path
  let expressions = node.expressions
  if (parentPath.isReturnStatement({ argument: node })) {
    let lastExpression = expressions.pop()
    for (let expression of expressions) {
      parentPath.insertBefore(t.ExpressionStatement(expression))
    }

    path.replaceInline(lastExpression)
  } else if (parentPath.isExpressionStatement({ expression: node })) {
    let body = []
    expressions.forEach((express) => {
      body.push(t.ExpressionStatement(express))
    })
    path.replaceInline(body)
  } else {
    return
  }

  scope.crawl()
}

function purifyCode(ast) {
  // 标准化if语句
  traverse(ast, { IfStatement: standardIfStatement })
  // 标准化for语句
  traverse(ast, { ForStatement: standardLoop })
  // 标准化while语句
  traverse(ast, { WhileStatement: standardLoop })
  // 删除空语句
  traverse(ast, {
    EmptyStatement: (path) => {
      path.remove()
    },
  })
  // 删除未使用的变量
  traverse(ast, splitVariableDeclarator)
  const deleteUnusedVar = require('../visitor/delete-unused-var')
  traverse(ast, deleteUnusedVar)
  // 替换索引器
  function FormatMember(path) {
    let curNode = path.node
    if (!t.isStringLiteral(curNode.property)) {
      return
    }
    if (curNode.computed === undefined || !curNode.computed === true) {
      return
    }
    if (!/^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(curNode.property.value)) {
      return
    }
    curNode.property = t.identifier(curNode.property.value)
    curNode.computed = false
  }
  traverse(ast, { MemberExpression: FormatMember })

  // 替换类和对象的计算方法和计算属性
  // ["method"](){} -> "method"(){}
  function FormatComputed(path) {
    let curNode = path.node
    if (!t.isStringLiteral(curNode.key)) {
      return
    }
    curNode.computed = false
  }
  // "method"(){} -> method(){}
  function stringLiteralToIdentifier(path) {
    let curNode = path.node
    if (!t.isStringLiteral(curNode.key) || curNode.computed === true) {
      return
    }
    if (!/^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(curNode.key.value)) {
      return
    }
    curNode.key = t.identifier(curNode.key.value)
  }
  traverse(ast, {
    'Method|Property': (path) => {
      FormatComputed(path)
      stringLiteralToIdentifier(path)
    },
  })

  // 拆分语句
  traverse(ast, { SequenceExpression: splitSequence })
  return ast
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

const deleteSelfDefendingCode = {
  VariableDeclarator(path) {
    const { id, init } = path.node
    const selfName = id.name
    if (!t.isCallExpression(init)) {
      return
    }
    if (!t.isIdentifier(init.callee)) {
      return
    }
    const callName = init.callee.name
    const args = init.arguments
    if (
      args.length != 2 ||
      !t.isThisExpression(args[0]) ||
      !t.isFunctionExpression(args[1])
    ) {
      return
    }
    const block = generator(args[1]).code
    const patterns = [
      // @7920538
      `return${selfName}.toString().search().toString().constructor(${selfName}).search()`,
      // @7135b09
      `const=function(){const=.constructor()return.test(${selfName})}return()`,
    ]
    let valid = false
    for (let pattern of patterns) {
      valid |= checkPattern(block, pattern)
    }
    if (!valid) {
      return
    }
    const refs = path.scope.bindings[selfName].referencePaths
    for (let ref of refs) {
      if (ref.key == 'callee') {
        ref.parentPath.remove()
        break
      }
    }
    path.remove()
    console.info(`Remove SelfDefendingFunc: ${selfName}`)
    const scope = path.scope.getBinding(callName).scope
    scope.crawl()
    const bind = scope.bindings[callName]
    if (bind.referenced) {
      console.error(`Call func ${callName} unexpected ref!`)
    }
    bind.path.remove()
    console.info(`Remove CallFunc: ${callName}`)
  },
}

const deleteDebugProtectionCode = {
  FunctionDeclaration(path) {
    const { id, params, body } = path.node
    if (
      !t.isIdentifier(id) ||
      params.length !== 1 ||
      !t.isIdentifier(params[0]) ||
      !t.isBlockStatement(body) ||
      body.body.length !== 2 ||
      !t.isFunctionDeclaration(body.body[0]) ||
      !t.isTryStatement(body.body[1])
    ) {
      return
    }
    const debugName = id.name
    const ret = params[0].name
    const subNode = body.body[0]
    if (
      !t.isIdentifier(subNode.id) ||
      subNode.params.length !== 1 ||
      !t.isIdentifier(subNode.params[0])
    ) {
      return
    }
    const subName = subNode.id.name
    const counter = subNode.params[0].name
    const code = generator(body).code
    const pattern = `function${subName}(${counter}){${counter}debugger${subName}(++${counter})}try{if(${ret})return${subName}${subName}(0)}catch(){}`
    if (!checkPattern(code, pattern)) {
      return
    }
    const scope1 = path.parentPath.scope
    const refs = scope1.bindings[debugName].referencePaths
    for (let ref of refs) {
      if (ref.findParent((path) => path.removed)) {
        continue
      }
      if (ref.key == 0) {
        // DebugProtectionFunctionInterval @e8e92c6
        const rm = ref.getFunctionParent().parentPath
        rm.remove()
        continue
      }
      // ref.key == 'callee'
      const up1 = ref.getFunctionParent()
      const callName = up1.parent.callee.name
      if (callName === 'setInterval') {
        // DebugProtectionFunctionInterval @51523c0
        const rm = up1.parentPath
        rm.remove()
        continue
      }
      // DebugProtectionFunctionCall
      const up2 = up1.getFunctionParent().parentPath
      const scope2 = up2.scope.getBinding(callName).scope
      up2.remove()
      scope1.crawl()
      scope2.crawl()
      const bind = scope2.bindings[callName]
      bind.path.remove()
      console.info(`Remove CallFunc: ${callName}`)
    }
    path.remove()
    console.info(`Remove DebugProtectionFunc: ${debugName}`)
  },
}

const deleteConsoleOutputCode = {
  VariableDeclarator(path) {
    const { id, init } = path.node
    const selfName = id.name
    if (!t.isCallExpression(init)) {
      return
    }
    if (!t.isIdentifier(init.callee)) {
      return
    }
    const callName = init.callee.name
    const args = init.arguments
    if (
      args.length != 2 ||
      !t.isThisExpression(args[0]) ||
      !t.isFunctionExpression(args[1])
    ) {
      return
    }
    const block = generator(args[1]).code
    const pattern = `console=console=log,warn,info,error,for(){${callName}constructor.prototype.bind${callName}${callName}bind${callName}}`
    if (!checkPattern(block, pattern)) {
      return
    }
    const refs = path.scope.bindings[selfName].referencePaths
    for (let ref of refs) {
      if (ref.key == 'callee') {
        ref.parentPath.remove()
        break
      }
    }
    path.remove()
    console.info(`Remove ConsoleOutputFunc: ${selfName}`)
    const scope = path.scope.getBinding(callName).scope
    scope.crawl()
    const bind = scope.bindings[callName]
    if (bind.referenced) {
      console.error(`Call func ${callName} unexpected ref!`)
    }
    bind.path.remove()
    console.info(`Remove CallFunc: ${callName}`)
  },
}

function unlockEnv(ast) {
  //可能会误删一些代码，可屏蔽
  traverse(ast, deleteSelfDefendingCode)
  traverse(ast, deleteDebugProtectionCode)
  traverse(ast, deleteConsoleOutputCode)
  return ast
}

module.exports = function (code) {
  let ret = PluginEval.unpack(code)
  let global_eval = false
  if (ret) {
    global_eval = true
    code = ret
  }
  let ast
  try {
    ast = parse(code, { errorRecovery: true })
  } catch (e) {
    console.error(`Cannot parse code: ${e.reasonCode}`)
    return null
  }
  // IllegalReturn
  const deleteIllegalReturn = require('../visitor/delete-illegal-return')
  traverse(ast, deleteIllegalReturn)
  // 清理二进制显示内容
  traverse(ast, {
    StringLiteral: ({ node }) => {
      delete node.extra
    },
    NumericLiteral: ({ node }) => {
      delete node.extra
    },
  })
  console.log('还原数值...')
  if (!decodeObject(ast)) {
    return null
  }
  console.log('处理全局加密...')
  if (!decodeGlobal(ast)) {
    return null
  }
  console.log('提高代码可读性...')
  ast = purifyCode(ast)
  console.log('处理代码块加密...')
  stringArrayLite(ast)
  ast = decodeCodeBlock(ast)
  console.log('清理死代码...')
  ast = cleanDeadCode(ast)
  // 刷新代码
  ast = parse(
    generator(ast, {
      comments: false,
      jsescOption: { minimal: true },
    }).code,
    { errorRecovery: true }
  )
  console.log('提高代码可读性...')
  ast = purifyCode(ast)
  console.log('解除环境限制...')
  ast = unlockEnv(ast)
  console.log('净化完成')
  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  if (global_eval) {
    code = PluginEval.pack(code)
  }
  return code
}
