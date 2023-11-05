/**
 * 在 babel_asttool.js 的基础上修改而来
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

function decodeGlobal(ast) {
  // 清理空语句
  let i = 0
  while (i < ast.program.body.length) {
    if (t.isEmptyStatement(ast.program.body[i])) {
      ast.program.body.splice(i, 1)
    } else {
      ++i
    }
  }
  // 前3句非空语句分别为签名信息、预处理函数、解密函数。
  if (i < 3) {
    console.log('Error: code too short')
    return false
  }
  // 分离解密语句与内容语句
  let decrypt_code = ast.program.body.slice(0, 3)
  if (!t.isVariableDeclaration(decrypt_code[0])) {
    console.log('Error: line 1 is not variable declaration')
    return false
  }
  let decrypt_fun = decrypt_code[2]
  if (t.isExpressionStatement(decrypt_fun)) {
    decrypt_fun = decrypt_code[1]
  }
  let decrypt_val
  if (t.isVariableDeclaration(decrypt_fun)) {
    decrypt_val = decrypt_fun.declarations[0].id.name
  } else if (t.isFunctionDeclaration(decrypt_fun)) {
    decrypt_val = decrypt_fun.id.name
  } else {
    console.log('Error: cannot find decrypt variable')
    return false
  }
  console.log(`主加密变量: ${decrypt_val}`)
  let content_code = ast.program.body.slice(3)
  // 运行解密语句
  ast.program.body = decrypt_code
  let { code } = generator(ast, {
    compact: true,
  })
  virtualGlobalEval(code)
  // 遍历内容语句
  function funToStr(path) {
    let node = path.node
    if (!t.isIdentifier(node.callee, { name: decrypt_val })) {
      return
    }
    let tmp = path.toString()
    let value = virtualGlobalEval(tmp)
    // console.log(`还原前：${tmp} 还原后：${value}`)
    path.replaceWith(t.valueToNode(value))
  }
  function memToStr(path) {
    let node = path.node
    if (!t.isIdentifier(node.object, { name: decrypt_val })) {
      return
    }
    let tmp = path.toString()
    let value = virtualGlobalEval(tmp)
    // console.log(`还原前：${tmp} 还原后：${value}`)
    path.replaceWith(t.valueToNode(value))
  }
  ast.program.body = content_code
  traverse(ast, {
    CallExpression: funToStr,
    MemberExpression: memToStr,
  })
  return ast
}

function unpackCall(path) {
  // 这里与V5版本一致，共有4种调用类型：
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
  //     "bbb": "eee"
  // };
  // var aa = _0xb28de8["abcd"](123, 456);
  // var bb = _0xb28de8["dbca"](bcd, 11, 22);
  // var cc = _0xb28de8["aaa"](dcb);
  // var dd = _0xb28de8["bbb"];
  //   |
  //   |
  //   |
  //   v
  // var aa = 123 == 456;
  // var bb = bcd(11, 22);
  // var cc = dcb();
  // var dd = "eee";
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
      }
    } else if (t.isStringLiteral(prop.value)) {
      let retStmt = prop.value.value
      objKeys[key] = function (_path) {
        _path.replaceWith(t.stringLiteral(retStmt))
      }
    }
  })
  // 如果Object内的元素不全符合要求 很有可能是普通的字符串类型 不需要替换
  let replCount = Object.keys(objKeys).length
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
    if (!t.isIdentifier(_node.object) || _node.object.name !== objName) {
      return null
    }
    if (!t.isStringLiteral(_node.property) && !t.isIdentifier(_node.property)) {
      return null
    }
    let key = null
    if (_node.property.value in objKeys) {
      key = _node.property.value
    } else if (_node.property.name in objKeys) {
      key = _node.property.name
    }
    if (!key) {
      return null
    }
    objUsed[key] = true
    return objKeys[key]
  }
  const fnPath = path.getFunctionParent() || path.scope.path
  fnPath.traverse({
    CallExpression: function (_path) {
      const _node = _path.node.callee
      // 函数名必须为Object成员
      if (!t.isMemberExpression(_node)) {
        return
      }
      let func = getReplaceFunc(_node)
      let args = _path.node.arguments
      if (func) {
        func(_path, args)
      }
    },
    MemberExpression: function (_path) {
      let func = getReplaceFunc(_path.node)
      if (func) {
        func(_path)
      }
    },
  })
  // 如果没有全部使用 就先不删除
  const usedCount = Object.keys(objUsed).length
  if (usedCount !== replCount) {
    console.log(`不完整使用: ${objName} ${usedCount}/${replCount}`)
  } else {
    path.remove()
  }
}

function decodeCodeBlock(ast) {
  // 在变量定义完成后判断是否为代码块加密内容
  traverse(ast, { VariableDeclarator: { exit: unpackCall } })
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
  if (!(t.isBooleanLiteral(node.test) || t.isUnaryExpression(node.test))) {
    return
  }
  if (!(node.test.prefix || node.test.value)) {
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
  console.log(`扁平化还原: ${arrName}[${argName}]`)
  // 在while上面的节点寻找这两个变量
  let arr = []
  path.getAllPrevSiblings().forEach((pre_path) => {
    const { declarations } = pre_path.node
    let { id, init } = declarations[0]
    if (arrName == id.name) {
      arr = init.callee.object.value.split('|')
      pre_path.remove()
    }
    if (argName == id.name) {
      pre_path.remove()
    }
  })
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

/**
 * Two RegExp tests will be conducted here:
 * * If '\n' exists (code formatted)
 * * If '\u' or '\x' does not exist (literal formatted)
 *
 * An infinite call stack will appear if either of the test fails.
 * (by replacing the 'e' with '\u0435')
 */
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
    const pattern = `RegExp()return.test(.toString())RegExp()return.test(.toString())\u0435\u0435`
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

/**
 * A "debugger" will be inserted by:
 * * v5: directly.
 * * v6: calling Function constructor twice.
 */
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
    const pattern = `function${subName}(${counter}){${counter}debug${subName}(++${counter})}try{if(${ret})return${subName}${subName}(0)}catch(){}`
    if (!checkPattern(code, pattern)) {
      return
    }
    const scope1 = path.parentPath.scope
    const refs = scope1.bindings[debugName].referencePaths
    for (let ref of refs) {
      if (ref.findParent((path) => path.removed)) {
        continue
      }
      let parent = ref.getFunctionParent()
      if (parent.key == 0) {
        // DebugProtectionFunctionInterval
        // window.setInterval(Function(), ...)
        const rm = parent.parentPath
        rm.remove()
        continue
      }
      // DebugProtectionFunctionCall
      const callName = parent.parent.callee.name
      const up2 = parent.getFunctionParent().parentPath
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
    const body = args[1].body.body
    if (body.length !== 3) {
      return
    }
    if (
      !t.isVariableDeclaration(body[0]) ||
      !t.isVariableDeclaration(body[1]) ||
      !t.isIfStatement(body[2])
    ) {
      return
    }
    const feature = [
      [],
      ['window', 'process', 'require', 'global'],
      [
        'console',
        'log',
        'warn',
        'debug',
        'info',
        'error',
        'exception',
        'trace',
      ],
    ]
    let valid = true
    for (let i = 1; i < 3; ++i) {
      const { code } = generator(body[i])
      feature[i].map((key) => {
        if (code.indexOf(key) == -1) {
          valid = false
        }
      })
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

const deleteVersionCheck = {
  StringLiteral(path) {
    const msg = '删除版本号，js会定期弹窗，还请支持我们的工作'
    if (path.node.value !== msg) {
      return
    }
    let fnPath = path.getFunctionParent().parentPath
    if (!fnPath.isCallExpression()) {
      return
    }
    fnPath.remove()
    console.log('Remove VersionCheck')
  },
}

function unlockEnv(ast) {
  // 查找并删除`自卫模式`函数
  traverse(ast, deleteSelfDefendingCode)
  // 查找并删除`禁止控制台调试`函数
  traverse(ast, deleteDebugProtectionCode)
  // 清空`禁止控制台输出`函数
  traverse(ast, deleteConsoleOutputCode)
  // 删除版本号检测
  traverse(ast, deleteVersionCheck)
  return ast
}

function purifyFunction(path) {
  const node = path.node
  if (!t.isIdentifier(node.left) || !t.isFunctionExpression(node.right)) {
    return
  }
  const name = node.left.name
  if (node.right.body.body.length !== 1) {
    return
  }
  let retStmt = node.right.body.body[0]
  if (!t.isReturnStatement(retStmt)) {
    return
  }
  if (!t.isBinaryExpression(retStmt.argument, { operator: '+' })) {
    return
  }
  try {
    const fnPath = path.getFunctionParent() || path.scope.path
    fnPath.traverse({
      CallExpression: function (_path) {
        const _node = _path.node.callee
        if (!t.isIdentifier(_node, { name: name })) {
          return
        }
        let args = _path.node.arguments
        _path.replaceWith(t.binaryExpression('+', args[0], args[1]))
      },
    })
    path.remove()
    console.log(`拼接类函数: ${name}`)
  } catch {
    let code = generator(path.node, { minified: true }).code
    console.warn('Purify function failed: ' + code)
  }
}

function purifyCode(ast) {
  // 净化拼接字符串的函数
  traverse(ast, { AssignmentExpression: purifyFunction })
  // 净化变量定义中的常量数值
  function purifyDecl(path) {
    if (t.isNumericLiteral(path.node.init)) {
      return
    }
    const name = path.node.id.name
    const { code } = generator(
      {
        type: 'Program',
        body: [path.node.init],
      },
      {
        compact: true,
      }
    )
    const valid = /^[-+*/%!<>&|~^ 0-9;]+$/.test(code)
    if (!valid) {
      return
    }
    if (/^[-][0-9]*$/.test(code)) {
      return
    }
    const value = eval(code)
    const node = t.valueToNode(value)
    path.replaceWith(t.variableDeclarator(path.node.id, node))
    console.log(`替换 ${name}: ${code} -> ${value}`)
  }
  traverse(ast, { VariableDeclarator: purifyDecl })
  // 合并字符串
  let end = false
  function combineString(path) {
    const op = path.node.operator
    if (op !== '+') {
      return
    }
    const left = path.node.left
    const right = path.node.right
    if (!t.isStringLiteral(left) || !t.isStringLiteral(right)) {
      return
    }
    end = false
    path.replaceWith(t.StringLiteral(eval(path + '')))
    console.log(`合并字符串: ${path.node.value}`)
  }
  while (!end) {
    end = true
    traverse(ast, { BinaryExpression: combineString })
  }
  // 替换索引器
  function FormatMember(path) {
    // _0x19882c['removeCookie']['toString']()
    //  |
    //  |
    //  |
    //  v
    // _0x19882c.removeCookie.toString()
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
  // 分割表达式
  function removeComma(path) {
    // a = 1, b = ddd(), c = null;
    //  |
    //  |
    //  |
    //  v
    // a = 1;
    // b = ddd();
    // c = null;
    let { expression } = path.node
    if (!t.isSequenceExpression(expression)) {
      return
    }
    let body = []
    expression.expressions.forEach((express) => {
      body.push(t.expressionStatement(express))
    })
    path.replaceInline(body)
  }
  traverse(ast, { ExpressionStatement: removeComma })
  // 删除空语句
  traverse(ast, {
    EmptyStatement: (path) => {
      path.remove()
    },
  })
  // 删除未使用的变量
  const deleteUnusedVar = require('../visitor/delete-unused-var')
  traverse(ast, deleteUnusedVar)
  return ast
}

module.exports = function (code) {
  let ret = PluginEval.unpack(code)
  let global_eval = false
  if (ret) {
    global_eval = true
    code = ret
  }
  let ast = parse(code)
  // 清理二进制显示内容
  traverse(ast, {
    StringLiteral: ({ node }) => {
      delete node.extra
    },
  })
  traverse(ast, {
    NumericLiteral: ({ node }) => {
      delete node.extra
    },
  })
  console.log('处理全局加密...')
  ast = decodeGlobal(ast)
  if (!ast) {
    return null
  }
  console.log('处理代码块加密...')
  ast = decodeCodeBlock(ast)
  console.log('清理死代码...')
  ast = cleanDeadCode(ast)
  // 刷新代码
  ast = parse(
    generator(ast, {
      comments: false,
      jsescOption: { minimal: true },
    }).code
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
