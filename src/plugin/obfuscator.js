/**
 * 整合自下面两个项目：
 * * cilame/v_jstools
 * * Cqxstevexw/decodeObfuscator
 */
import { parse } from '@babel/parser'
import _generate from '@babel/generator'
import _traverse from '@babel/traverse'
import * as t from '@babel/types'
import * as vm from 'node:vm'
import { VM } from 'vm2'

const generator = _generate.default
const traverse = _traverse.default

let globalContext = vm.createContext()
let vm2 = new VM({
  allowAsync: false,
  sandbox: globalContext,
})
function virtualGlobalEval(jsStr) {
  return vm2.run(String(jsStr))
}

function decodeObject(ast) {
  let obj_node = {}
  function collectObject(path) {
    const id = path.node.id
    const init = path.node.init
    if (!t.isIdentifier(id) || !t.isObjectExpression(init)) {
      return
    }
    const name = id.name
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
    obj_node[name] = obj
  }
  traverse(ast, {
    VariableDeclarator: collectObject,
  })
  let obj_used = {}
  function replaceObject(path) {
    const name = path.node.object
    const key = path.node.property
    if (!t.isIdentifier(name) || !t.isIdentifier(key)) {
      return
    }
    if (!Object.prototype.hasOwnProperty.call(obj_node, name.name)) {
      return
    }
    path.replaceWith(obj_node[name.name][key.name])
    obj_used[name.name] = true
  }
  traverse(ast, {
    MemberExpression: replaceObject,
  })
  function deleteObject(path) {
    const id = path.node.id
    const init = path.node.init
    if (!t.isIdentifier(id) || !t.isObjectExpression(init)) {
      return
    }
    const name = id.name
    if (!Object.prototype.hasOwnProperty.call(obj_node, name)) {
      return
    }
    path.remove()
    let used = 'false'
    if (Object.prototype.hasOwnProperty.call(obj_used, name)) {
      used = 'true'
    }
    console.log(`删除对象: ${name} -> ${used}`)
  }
  traverse(ast, {
    VariableDeclarator: deleteObject,
  })
  return ast
}

function decodeGlobal(ast) {
  // 找到关键的函数
  let ob_func_str = []
  let ob_dec_name = []
  let ob_string_func_name

  // **Fallback**, in case the `find_ob_sort_list_by_feature` does not work
  // Function to sort string list ("func2")
  function find_ob_sort_func(path) {
    function get_ob_sort(path) {
      for (let arg of path.node.arguments) {
        if (t.isIdentifier(arg)) {
          ob_string_func_name = arg.name
          break
        }
      }
      if (!ob_string_func_name) {
        return
      }
      let rm_path = path
      while (!rm_path.parentPath.isProgram()) {
        rm_path = rm_path.parentPath
      }
      ob_func_str.push('!' + generator(rm_path.node, { minified: true }).code)
      path.stop()
      rm_path.remove()
    }
    if (!path.getFunctionParent()) {
      path.traverse({ CallExpression: get_ob_sort })
      if (ob_string_func_name) {
        path.stop()
      }
    }
  }
  // If the sort func is found, we can get the "func1" from its name.
  function find_ob_sort_list_by_name(path) {
    if (path.node.name != ob_string_func_name) {
      return
    }
    if (path.findParent((path) => path.removed)) {
      return
    }
    if (path.parentPath.isExpressionStatement()) {
      path.remove()
      return
    }
    let is_list = false
    let parent = path.parentPath
    if (parent.isFunctionDeclaration() && path.key === 'id') {
      is_list = true
    } else if (parent.isVariableDeclarator() && path.key === 'id') {
      is_list = true
    } else if (parent.isAssignmentExpression() && path.key === 'left') {
      is_list = true
    } else {
      let bind_path = parent.getFunctionParent()
      while (bind_path) {
        if (t.isFunctionExpression(bind_path)) {
          bind_path = bind_path.parentPath
        } else if (!bind_path.parentPath) {
          break
        } else if (t.isSequenceExpression(bind_path.parentPath)) {
          // issue #11
          bind_path = bind_path.parentPath
        } else if (t.isReturnStatement(bind_path.parentPath)) {
          // issue #11
          // function _a (x, y) {
          //   return _a = function (p, q) {
          //     // #ref
          //   }, _a(x, y)
          // }
          bind_path = bind_path.getFunctionParent()
        } else {
          break
        }
      }
      if (!bind_path) {
        console.warn('Unexpected reference!')
        return
      }
      ob_dec_name.push(bind_path.node.id.name)
      ob_func_str.push(generator(bind_path.node, { minified: true }).code)
      bind_path.remove()
    }
    if (is_list) {
      ob_func_str.unshift(generator(parent.node, { minified: true }).code)
      parent.remove()
    }
  }

  // **Prefer** Find the string list func ("func1") by matching its feature:
  // function aaa() {
  //   const bbb = [...]
  //   aaa = function () {
  //     return bbb;
  //   };
  //   return aaa();
  // }
  // After finding the possible func1, this method will check all the binding
  // references and put the child encode function into list.
  function find_ob_sort_list_by_feature(path) {
    if (path.getFunctionParent()) {
      return
    }
    if (
      !t.isIdentifier(path.node.id) ||
      path.node.params.length ||
      !t.isBlockStatement(path.node.body) ||
      path.node.body.body.length != 3
    ) {
      return
    }
    const name_func = path.node.id.name
    let string_var = -1
    const body = path.node.body.body
    try {
      if (
        body[0].declarations.length != 1 ||
        !(string_var = body[0].declarations[0].id.name) ||
        !t.isArrayExpression(body[0].declarations[0].init) ||
        name_func != body[1].expression.left.name ||
        body[1].expression.right.params.length ||
        string_var != body[1].expression.right.body.body[0].argument.name ||
        body[2].argument.arguments.length ||
        name_func != body[2].argument.callee.name
      ) {
        return
      }
    } catch {
      //
    }
    const binding = path.scope.getBinding(name_func)
    if (!binding.referencePaths) {
      return
    }
    let paths = binding.referencePaths
    let find_func2 = false
    let nodes = []
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
        find_func2 = true
        nodes.push([rm_path.node, 'func2'])
        rm_path.remove()
      }
    }
    paths.map(find2)
    if (!find_func2) {
      return
    }
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
    if (nodes.length == 1) {
      return
    }
    ob_string_func_name = name_func
    ob_func_str.push(generator(path.node, { minified: true }).code)
    nodes.map(function (item) {
      let node = item[0]
      if (item[1] == 'func3') {
        ob_dec_name.push(node.id.name)
      }
      ob_func_str.push(generator(node, { minified: true }).code)
    })
    path.stop()
    path.remove()
  }
  traverse(ast, { FunctionDeclaration: find_ob_sort_list_by_feature })
  if (!ob_string_func_name) {
    console.warn('Try fallback mode...')
    traverse(ast, { ExpressionStatement: find_ob_sort_func })
    if (!ob_string_func_name) {
      console.error('Cannot find string list!')
      return false
    }
    traverse(ast, { Identifier: find_ob_sort_list_by_name })
    if (ob_func_str.length < 3 || !ob_dec_name.length) {
      console.error('Essential code missing!')
      return false
    }
  }
  console.log(`String List Name: ${ob_string_func_name}`)
  virtualGlobalEval(ob_func_str.join(';'))

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
    let name = path.node?.left?.name
    if (!name) {
      name = path.node?.id?.name
    }
    if (exist_names.indexOf(name) != -1) {
      // console.log(`del: ${name}`)
      path.remove()
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
  const { id, init } = path.node
  if (!t.isObjectExpression(init)) {
    // 判断是否是定义对象
    return
  }
  let name = id.name
  let properties = init.properties
  let scope = path.scope
  let binding = scope.getBinding(name)
  if (!binding || !binding.constant) {
    // 确认该对象没有被多次定义
    return
  }
  let paths = binding.referencePaths
  // 添加已有的key
  let keys = {}
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
  let check = true
  let dupe = false
  let modified = false
  let containfun = false
  function checkFunction(right) {
    if (!t.isFunctionExpression(right)) {
      return false
    }
    // 符合要求的函数必须有且仅有一条return语句
    if (right.body.body.length !== 1) {
      return false
    }
    let retStmt = right.body.body[0]
    if (!t.isReturnStatement(retStmt)) {
      return false
    }
    // 检测是否是3种格式之一
    if (t.isBinaryExpression(retStmt.argument)) {
      return true
    }
    if (t.isLogicalExpression(retStmt.argument)) {
      return true
    }
    if (t.isCallExpression(retStmt.argument)) {
      // 函数调用类型 调用的函数必须是传入的第一个参数
      if (!t.isIdentifier(retStmt.argument.callee)) {
        return false
      }
      if (retStmt.argument.callee.name !== right.params[0].name) {
        return false
      }
      return true
    }
    return false
  }
  function collectProperties(_path) {
    const left = _path.node.left
    const right = _path.node.right
    if (!t.isMemberExpression(left)) {
      return
    }
    const object = left.object
    const property = left.property
    if (!t.isIdentifier(object, { name: name })) {
      return
    }
    let key = null
    if (t.isStringLiteral(property)) {
      key = property.value
    }
    if (t.isIdentifier(property)) {
      key = property.name
    }
    if (!key) {
      return
    }
    if (check) {
      // 不允许出现重定义
      if (Object.prototype.hasOwnProperty.call(keys, key)) {
        dupe = true
        return
      }
      // 判断是否为特征函数
      containfun = containfun | checkFunction(right)
      // 添加到列表
      properties.push(t.ObjectProperty(t.valueToNode(key), right))
      keys[key] = true
      modified = true
    } else {
      if (
        _path.parentPath.node.type == 'VariableDeclarator' ||
        _path.parentPath.node.type == 'AssignmentExpression'
      ) {
        _path.replaceWith(left)
      } else {
        _path.remove()
      }
    }
  }
  // 检测已有的key中是否存在混淆函数
  for (let prop of properties) {
    containfun = containfun | checkFunction(prop.value)
  }
  // 第一次遍历作用域
  scope.traverse(scope.block, {
    AssignmentExpression: collectProperties,
  })
  if (!modified) {
    return
  }
  if (dupe) {
    console.log(`不进行合并: ${name} dupe:${dupe} spec:${containfun}`)
    return
  }
  // 第二次遍历作用域
  console.log(`尝试性合并: ${name}`)
  check = false
  scope.traverse(scope.block, {
    AssignmentExpression: collectProperties,
  })
  paths.map(function (refer_path) {
    try {
      let bindpath = refer_path.parentPath
      if (!t.isVariableDeclarator(bindpath.node)) return
      let bindname = bindpath.node.id.name
      bindpath.scope.rename(bindname, name, bindpath.scope.block)
      bindpath.remove()
    } catch (e) {
      console.log(e)
    }
  })
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
    let key = prop.key.value
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
        if (retStmt.argument.callee.name !== prop.value.params[0].name) {
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
    const { declarations } = pre_path.node
    let { id, init } = declarations[0]
    if (arrName == id.name) {
      if (t.isStringLiteral(init?.callee?.object)) {
        arr = init.callee.object.value.split('|')
        rm.push(pre_path)
      }
    }
    if (argName == id.name) {
      if (t.isLiteral(init)) {
        rm.push(pre_path)
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
  traverse(ast, {
    VariableDeclarator: (path) => {
      const { node, scope } = path
      const name = node.id.name
      const binding = scope.getBinding(name)
      if (!binding || binding.referenced || !binding.constant) {
        return
      }
      const pathpp = path.parentPath.parentPath
      if (t.isForOfStatement(pathpp)) {
        return
      }
      console.log(`未引用变量: ${name}`)
      if (path.parentPath.node.declarations.length === 1) {
        path.parentPath.remove()
      } else {
        path.remove()
      }
    },
  })
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
  // 拆分语句
  traverse(ast, { SequenceExpression: splitSequence })
  // IllegalReturn
  traverse(ast, {
    ReturnStatement(path) {
      if (!path.getFunctionParent()) {
        path.remove()
      }
    },
  })
  return ast
}

const deleteObfuscatorCode = {
  VariableDeclarator(path) {
    let sourceCode = path.toString()
    let { id, init } = path.node
    if (t.isCallExpression(init)) {
      let callee = init.callee
      let args = init.arguments
      if (args.length == 0 && sourceCode.includes('apply')) {
        path.remove()
      } else if (
        (sourceCode.includes('constructor') || sourceCode.includes('RegExp')) &&
        t.isIdentifier(callee) &&
        args.length == 2 &&
        t.isThisExpression(args[0]) &&
        t.isFunctionExpression(args[1])
      ) {
        let funcName = id.name

        let nextSibling = path.parentPath.getNextSibling()
        if (nextSibling.isExpressionStatement()) {
          let expression = nextSibling.get('expression')

          if (
            expression.isCallExpression() &&
            expression.get('callee').isIdentifier({ name: funcName })
          ) {
            path.remove()
            nextSibling.remove()
          }
        }
      }
    }
  },
  ExpressionStatement(path) {
    let sourceCode = path.toString()
    if (!sourceCode.includes('RegExp') && !sourceCode.includes('chain')) {
      return
    }

    let { expression } = path.node
    if (!t.isCallExpression(expression)) {
      return
    }
    let callee = expression.callee
    let args = expression.arguments

    if (!t.isFunctionExpression(callee) || args.length != 0) {
      return
    }

    let body = callee.body.body
    if (body.length != 1 || !t.isExpressionStatement(body[0])) {
      return
    }
    expression = body[0].expression
    if (!t.isCallExpression(expression)) {
      return
    }
    callee = expression.callee
    args = expression.arguments

    if (!t.isCallExpression(callee) || args.length != 0) {
      return
    }
    args = callee.arguments
    if (
      args.length == 2 &&
      t.isThisExpression(args[0]) &&
      t.isFunctionExpression(args[1])
    ) {
      path.remove()
    }
  },
  CallExpression(path) {
    let { scope, node } = path
    let callee = node.callee
    let args = node.arguments

    let sourceCode = path.toString()
    if (
      args.length == 0 &&
      sourceCode.includes('constructor') &&
      sourceCode.includes('setInterval')
    ) {
      path.remove()
      return
    }

    if (!t.isIdentifier(callee, { name: 'setInterval' })) {
      return
    }
    if (
      args.length != 2 ||
      !t.isFunctionExpression(args[0]) ||
      !t.isNumericLiteral(args[1])
    ) {
      return
    }

    let body = args[0].body.body
    if (body.length != 1 || !t.isExpressionStatement(body[0])) {
      return
    }
    let expression = body[0].expression
    if (!t.isCallExpression(expression)) {
      return
    }
    callee = expression.callee
    args = expression.arguments

    if (!t.isIdentifier(callee) || args.length != 0) {
      return
    }

    let binding = scope.getBinding(callee.name)
    if (!binding || !binding.path) {
      return
    }

    sourceCode = binding.path.toString()
    if (sourceCode.includes('constructor') || sourceCode.includes('debugger')) {
      path.remove()
      binding.path.remove()
    }
  },
  FunctionDeclaration(path) {
    let { body } = path.node.body
    if (
      body.length == 2 &&
      t.isFunctionDeclaration(body[0]) &&
      t.isTryStatement(body[1])
    ) {
      let sourceCode = path.toString()
      if (
        sourceCode.includes('constructor') &&
        sourceCode.includes('debugger') &&
        sourceCode.includes('apply')
      ) {
        path.remove()
      }
    }
  },
}

function unlockEnv(ast) {
  //可能会误删一些代码，可屏蔽
  traverse(ast, deleteObfuscatorCode)
  return ast
}

export default function (jscode) {
  let ast
  try {
    ast = parse(jscode, { errorRecovery: true })
  } catch (e) {
    console.error(`Cannot parse code: ${e.reasonCode}`)
    return null
  }
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
  decodeGlobal(ast)
  console.log('处理代码块加密...')
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
  let { code } = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  })
  return code
}
