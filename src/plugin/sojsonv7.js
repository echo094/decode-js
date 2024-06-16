/**
 * For jsjiami.com.v7
 */
const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const ivm = require('isolated-vm')
const PluginEval = require('./eval.js')

const isolate = new ivm.Isolate()
const globalContext = isolate.createContextSync()
function virtualGlobalEval(jsStr) {
  return globalContext.evalSync(String(jsStr))
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
  // line 1: version and string table
  // line x: preprocessing function of string table
  // line y: main encode function containing the var of string table
  if (i < 3) {
    console.log('Error: code too short')
    return false
  }
  // split the first line
  traverse(ast, {
    Program(path) {
      path.stop()
      const l1 = path.get('body.0')
      if (!l1.isVariableDeclaration()) {
        return
      }
      const defs = l1.node.declarations
      const kind = l1.node.kind
      for (let i = defs.length - 1; i; --i) {
        l1.insertAfter(t.VariableDeclaration(kind, [defs[i]]))
        l1.get(`declarations.${i}`).remove()
      }
      l1.scope.crawl()
    },
  })
  // find the main encode function
  // [version, string-array, call, ...]
  let decrypt_code = []
  for (let i = 0; i < 3; ++i) {
    decrypt_code.push(t.EmptyStatement())
  }
  const first_line = ast.program.body[0]
  let var_version
  if (t.isVariableDeclaration(first_line)) {
    if (first_line.declarations.length) {
      var_version = first_line.declarations[0].id.name
    }
  } else if (t.isCallExpression(first_line?.expression)) {
    let call_func = first_line.expression.callee?.name
    let i = ast.program.body.length
    let find = false
    while (--i) {
      let part = ast.program.body[i]
      if (!t.isFunctionDeclaration(part) || part?.id?.name !== call_func) {
        continue
      }
      if (find) {
        // remove duplicate definition
        ast.program.body[i] = t.emptyStatement()
        continue
      }
      find = true
      let obj = part.body.body[0]?.expression?.left
      if (!obj || !t.isMemberExpression(obj) || obj.object?.name !== 'global') {
        break
      }
      var_version = obj.property?.value
      decrypt_code.push(part)
      ast.program.body[i] = t.emptyStatement()
      continue
    }
  }
  if (!var_version) {
    console.error('Line 1 is not version variable!')
    return false
  }
  console.info(`Version var: ${var_version}`)
  decrypt_code[0] = first_line
  ast.program.body.shift()

  // iterate and classify all refs of var_version
  const refs = {
    string_var: null,
    string_path: null,
    def: [],
  }
  traverse(ast, {
    Identifier: (path) => {
      const name = path.node.name
      if (name !== var_version) {
        return
      }
      const up1 = path.parentPath
      if (up1.isVariableDeclarator()) {
        refs.def.push(path)
      } else if (up1.isArrayExpression()) {
        let node_table = path.getFunctionParent()
        while (node_table.getFunctionParent()) {
          node_table = node_table.getFunctionParent()
        }
        let var_string_table = null
        if (node_table.node.id) {
          var_string_table = node_table.node.id.name
        } else {
          while (!node_table.isVariableDeclarator()) {
            node_table = node_table.parentPath
          }
          var_string_table = node_table.node.id.name
        }
        let valid = true
        up1.traverse({
          MemberExpression(path) {
            valid = false
            path.stop()
          },
        })
        if (valid) {
          refs.string_var = var_string_table
          refs.string_path = node_table
        } else {
          console.info(`Drop string table: ${var_string_table}`)
        }
      } else if (up1.isAssignmentExpression() && path.key === 'left') {
        // We don't need to execute this reference
        // Instead, we can delete it directly
        const up2 = up1.parentPath
        up2.replaceWith(up2.node.left)
      } else {
        console.warn(`Unexpected ref var_version: ${up1}`)
      }
    },
  })
  // check if contains string table
  let var_string_table = refs.string_var
  if (!var_string_table) {
    console.error('Cannot find string table')
    return false
  }
  //  check if contains rotate function and decrypt variable
  let decrypt_val
  let decrypt_path
  let binds = refs.string_path.scope.getBinding(var_string_table)
  function parse_main_call(path) {
    decrypt_path = path
    const node = path.node
    const copy = t.functionDeclaration(node.id, node.params, node.body)
    node.body = t.blockStatement([])
    return copy
  }
  // remove path of string table
  if (refs.string_path.isVariableDeclarator()) {
    decrypt_code[1] = t.variableDeclaration('var', [refs.string_path.node])
  } else {
    decrypt_code[1] = refs.string_path.node
  }
  refs.string_path.remove()
  // iterate refs
  let cache = undefined
  for (let bind of binds.referencePaths) {
    if (bind.findParent((path) => path.removed)) {
      continue
    }
    const parent = bind.parentPath
    if (parent.isCallExpression() && bind.listKey === 'arguments') {
      // This is the rotate function.
      // If it's in a sequence expression, it can be handled together.
      // Or, we should handle it after this iteration.
      cache = parent
      continue
    }
    if (parent.isSequenceExpression()) {
      // rotate function
      decrypt_code.push(t.expressionStatement(parent.node))
      const up2 = parent.parentPath
      if (up2.isIfStatement()) {
        // In the new version, rotate function will be enclosed by an
        // empty IfStatement
        up2.remove()
      } else {
        parent.remove()
      }
      continue
    }
    if (parent.isVariableDeclarator()) {
      // main decrypt val
      let top = parent.getFunctionParent()
      while (top.getFunctionParent()) {
        top = top.getFunctionParent()
      }
      decrypt_code[2] = parse_main_call(top)
      decrypt_val = top.node.id.name
      continue
    }
    if (parent.isCallExpression() && !parent.node.arguments.length) {
      // main decrypt val
      if (!t.isVariableDeclarator(parent.parentPath.node)) {
        continue
      }
      let top = parent.getFunctionParent()
      while (top.getFunctionParent()) {
        top = top.getFunctionParent()
      }
      decrypt_code[2] = parse_main_call(top)
      decrypt_val = top.node.id.name
      continue
    }
    if (parent.isExpressionStatement()) {
      parent.remove()
      continue
    }
    console.warn(`Unexpected ref var_string_table: ${parent}`)
  }
  // If rotateFunction is detected but not handled, we should handle it now.
  if (decrypt_code.length === 3 && cache) {
    if (cache.parentPath.isExpressionStatement()) {
      decrypt_code.push(cache.parent)
      cache = cache.parentPath
    } else {
      decrypt_code.push(t.expressionStatement(cache.node))
    }
    cache.remove()
  }
  decrypt_path.parentPath.scope.crawl()
  if (!decrypt_val) {
    console.error('Cannot find decrypt variable')
    return
  }
  console.log(`Main call wrapper name: ${decrypt_val}`)

  // 运行解密语句
  let content_code = ast.program.body
  ast.program.body = decrypt_code
  let { code } = generator(ast, {
    compact: true,
  })
  virtualGlobalEval(code)
  // 遍历内容语句
  ast.program.body = content_code
  function funToStr(path) {
    let tmp = path.toString()
    let value = virtualGlobalEval(tmp)
    // console.log(`还原前：${tmp} 还原后：${value}`)
    path.replaceWith(t.valueToNode(value))
  }
  function memToStr(path) {
    let tmp = path.toString()
    let value = virtualGlobalEval(tmp)
    // console.log(`还原前：${tmp} 还原后：${value}`)
    path.replaceWith(t.valueToNode(value))
  }
  function dfs(stk, item) {
    stk.push(item)
    const cur_val = item.name
    console.log(`Enter sub ${stk.length}:${cur_val}`)
    let pfx = ''
    for (let parent of stk) {
      pfx += parent.code + ';'
    }
    virtualGlobalEval(pfx)
    let scope = item.path.scope
    if (item.path.isFunctionDeclaration()) {
      scope = item.path.parentPath.scope
    }
    const refs = scope.bindings[cur_val].referencePaths
    const refs_next = []
    for (let ref of refs) {
      const parent = ref.parentPath
      if (ref.key === 'init') {
        // VariableDeclarator
        refs_next.push({
          name: parent.node.id.name,
          path: parent,
          code: 'var ' + parent,
        })
      } else if (ref.key === 'object') {
        // MemberExpression
        memToStr(parent)
      } else if (ref.key === 'callee') {
        // CallExpression
        funToStr(parent)
      }
    }
    for (let ref of refs_next) {
      dfs(stk, ref)
    }
    scope.crawl()
    item.path.remove()
    scope.crawl()
    console.log(`Exit sub ${stk.length}:${cur_val}`)
    stk.pop()
  }
  const root = {
    name: decrypt_val,
    path: decrypt_path,
    code: '',
  }
  dfs([], root)
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

function cleanSwitchCode1(path) {
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

function cleanSwitchCode2(path) {
  // 扁平控制：
  // 会使用一个空的for语句包裹一个switch语句
  // switch语句的执行顺序由for语句上方的字符串决定
  // 首先判断是否符合这种情况
  const node = path.node
  if (node.init || node.test || node.update) {
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
  let arr = null
  for (let pre_path of path.getAllPrevSiblings()) {
    if (!pre_path.isVariableDeclaration()) {
      continue
    }
    let test = '' + pre_path
    try {
      arr = eval(test + `;${arrName}`)
    } catch {
      //
    }
  }
  if (!arr) {
    return
  }
  console.log(`扁平化还原: ${arrName}[${argName}]`)
  // 重建代码块
  const caseMap = {}
  for (let item of swithStm.cases) {
    caseMap[item.test.value] = item.consequent
  }
  let resultBody = []
  arr.map((targetIdx) => {
    // 从当前序号开始直到遇到continue
    let valid = true
    while (valid && targetIdx < arr.length) {
      const targetBody = caseMap[targetIdx]
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
  traverse(ast, { WhileStatement: { exit: cleanSwitchCode1 } })
  traverse(ast, { ForStatement: { exit: cleanSwitchCode2 } })
  return ast
}

function removeUniqueCall(path) {
  let up1 = path.parentPath
  let decorator = up1.node.callee.name
  console.info(`Remove decorator: ${decorator}`)
  let bind1 = up1.scope.getBinding(decorator)
  bind1.path.remove()
  if (up1.key === 'callee') {
    up1.parentPath.remove()
  } else if (up1.key === 'init') {
    let up2 = up1.parentPath
    let call = up2.node.id.name
    console.info(`Remove call: ${call}`)
    let bind2 = up2.scope.getBinding(call)
    up2.remove()
    for (let ref of bind2.referencePaths) {
      if (ref.findParent((path) => path.removed)) {
        continue
      }
      if (ref.key === 'callee') {
        let rm = ref.parentPath
        if (rm.key === 'expression') {
          rm = rm.parentPath
        }
        rm.remove()
      } else {
        console.warn(`Unexpected ref key: ${ref.key}`)
      }
    }
  }
}

function unlockDebugger(path) {
  const decl_path = path.getFunctionParent()?.getFunctionParent()
  if (!decl_path) {
    return
  }
  // Check if contains inf-loop
  let valid = false
  path.getFunctionParent().traverse({
    WhileStatement(path) {
      if (t.isBooleanLiteral(path.node.test) && path.node.test) {
        valid = true
      }
    },
  })
  if (!valid) {
    return
  }
  const name = decl_path.node.id.name
  const bind = decl_path.scope.getBinding(name)
  console.info(`Debug test and inf-loop: ${name}`)
  for (let ref of bind.referencePaths) {
    if (ref.findParent((path) => path.removed)) {
      continue
    }
    if (ref.listKey === 'arguments') {
      // setInterval
      let rm = ref.getFunctionParent().parentPath
      if (rm.key === 'expression') {
        rm = rm.parentPath
      }
      rm.remove()
    } else if (ref.key === 'callee') {
      // lint test for this method
      let rm = ref.getFunctionParent()
      removeUniqueCall(rm)
    } else {
      console.warn(`Unexpected ref key: ${ref.key}`)
    }
  }
  decl_path.remove()
  path.stop()
}

function unlockConsole(path) {
  if (!t.isArrayExpression(path.node.init)) {
    return
  }
  let pattern = 'log|warn|debug|info|error|exception|table|trace'
  let count = 0
  for (let ele of path.node.init.elements) {
    if (~pattern.indexOf(ele.value)) {
      ++count
      continue
    }
    return
  }
  if (count < 5) {
    return
  }
  let left1 = path.getSibling(0)
  const code = generator(left1.node, { minified: true }).code
  pattern = ['window', 'process', 'require', 'global']
  pattern.map((key) => {
    if (code.indexOf(key) == -1) {
      return
    }
  })
  let rm = path.getFunctionParent()
  removeUniqueCall(rm)
}

function unlockLint(path) {
  if (path.findParent((up) => up.removed)) {
    return
  }
  if (path.node.value !== '(((.+)+)+)+$') {
    return
  }
  let rm = path.getFunctionParent()
  removeUniqueCall(rm)
}

function unlockDomainLock(path) {
  const array_list = [
    '[7,116,5,101,3,117,0,100]',
    '[5,110,0,100]',
    '[7,110,0,108]',
    '[7,101,0,104]',
  ]
  const checkArray = (node) => {
    const trim = node.split(' ').join('')
    for (let i = 0; i < 4; ++i) {
      if (array_list[i] == trim) {
        return i + 1
      }
    }
    return 0
  }
  if (path.findParent((up) => up.removed)) {
    return
  }
  let mask = 1 << checkArray('' + path)
  if (mask == 1) {
    return
  }
  let rm = path.getFunctionParent()
  rm.traverse({
    ArrayExpression: function (item) {
      mask = mask | (1 << checkArray('' + item))
    },
  })
  if (mask & 0b11110) {
    console.info('Find domain lock')
    removeUniqueCall(rm)
  }
}

function unlockEnv(ast) {
  // 删除`禁止控制台调试`函数
  traverse(ast, { DebuggerStatement: unlockDebugger })
  // 删除`禁止控制台输出`函数
  traverse(ast, { VariableDeclarator: unlockConsole })
  // 删除`禁止换行`函数
  traverse(ast, { StringLiteral: unlockLint })
  // 删除`安全域名`函数
  traverse(ast, { ArrayExpression: unlockDomainLock })
}

/**
 * If a function acts as follows:
 * A = function (p1, p2) { return p1 + p2 }
 *
 * Convert its call to a binary expression:
 * A(a, b) => a + b
 */
function purifyFunction(path) {
  const left = path.get('left')
  const right = path.get('right')
  if (!left.isIdentifier() || !right.isFunctionExpression()) {
    return
  }
  const name = left.node.name
  const params = right.node.params
  if (params.length !== 2) {
    return
  }
  const name1 = params[0].name
  const name2 = params[1].name
  if (right.node.body.body.length !== 1) {
    return
  }
  let retStmt = right.node.body.body[0]
  if (!t.isReturnStatement(retStmt)) {
    return
  }
  if (!t.isBinaryExpression(retStmt.argument, { operator: '+' })) {
    return
  }
  if (
    retStmt.argument.left?.name !== name1 ||
    retStmt.argument.right?.name !== name2
  ) {
    return
  }
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
    if (!t.isExpressionStatement(path.parent)) {
      return
    }
    let replace_path = path.parentPath
    if (replace_path.listKey !== 'body') {
      return
    }
    for (const item of path.node.expressions) {
      replace_path.insertBefore(t.expressionStatement(item))
    }
    replace_path.remove()
  }
  traverse(ast, { SequenceExpression: { exit: removeComma } })
  // 删除空语句
  traverse(ast, {
    EmptyStatement: (path) => {
      path.remove()
    },
  })
  // 删除未使用的变量
  const deleteUnusedVar = require('../visitor/delete-unused-var')
  traverse(ast, deleteUnusedVar)
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
  const parseControlFlowStorage = require('../visitor/parse-control-flow-storage')
  traverse(ast, parseControlFlowStorage)
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
  purifyCode(ast)
  ast = parse(generator(ast, { comments: false }).code)
  console.log('解除环境限制...')
  unlockEnv(ast)
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
