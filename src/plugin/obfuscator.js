/**
 * 整合自下面两个项目：
 * * cilame/v_jstools
 * * Cqxstevexw/decodeObfuscator
 */
import { parse } from '@babel/parser'
import _generate from '@babel/generator'
const generator = _generate.default
import _traverse from '@babel/traverse'
const traverse = _traverse.default
import * as t from '@babel/types'
import ivm from 'isolated-vm'
import PluginEval from './eval.js'
import calculateConstantExp from '../visitor/calculate-constant-exp.js'
import deleteIllegalReturn from '../visitor/delete-illegal-return.js'
import deleteUnusedVar from '../visitor/delete-unused-var.js'
import lintIfStatement from '../visitor/lint-if-statement.js'
import mergeObject from '../visitor/merge-object.js'
import parseControlFlowStorage from '../visitor/parse-control-flow-storage.js'
import pruneIfBranch from '../visitor/prune-if-branch.js'
import splitAssignment from '../visitor/split-assignment.js'
import splitSequence from '../visitor/split-sequence.js'
import splitVarDeclaration from '../visitor/split-variable-declaration.js'

const isolate = new ivm.Isolate()
const globalContext = isolate.createContextSync()
function virtualGlobalEval(jsStr) {
  return globalContext.evalSync(String(jsStr))
}

const optGenMin = {
  comments: false,
  minified: true,
  jsescOption: { minimal: true },
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
 * If the StringArrayRotateFunction does not exist, we can only verify a
 * string-array by checking the StringArrayCallsWrapper.
 *
 * @param {t.File} ast The ast file
 * @returns Object
 */
function stringArrayV0(ast) {
  console.info('Try v0 mode...')
  function check_wrapper(ref, array_name) {
    ref = ref.parentPath
    const index = ref.node.property?.name
    if (ref.key !== 'init') {
      return null
    }
    ref = ref.parentPath
    const value = ref.node.id?.name
    ref = ref.getFunctionParent()
    if (!index || ref.node.params?.[0]?.name !== index) {
      return null
    }
    const container = ref.node.body.body
    const ret_node = container[container.length - 1]
    if (!t.isReturnStatement(ret_node) || ret_node.argument?.name !== value) {
      return null
    }
    if (ref.key !== 'init') {
      return null
    }
    const rm_path = ref.parentPath
    if (array_name == rm_path.node.id.name) {
      return null
    }
    return rm_path
  }
  // check if all the binding references are wrapper
  function check_other_function(path, array_name) {
    const binding = path.scope.getBinding(array_name)
    if (!binding.referencePaths) {
      return
    }
    const ob_func_str = []
    const ob_dec_call = []
    for (const ref of binding.referencePaths) {
      if (ref.findParent((path) => path.removed)) {
        continue
      }
      if (ref.parentPath.isMemberExpression() && ref.key === 'object') {
        const rm_path = check_wrapper(ref, array_name)
        if (!rm_path) {
          console.error('Unexpected reference')
          return null
        }
        const code = generator(rm_path.node, optGenMin).code
        rm_path.get('body').replaceWith(t.blockStatement([]))
        ob_func_str.push(code)
        ob_dec_call.push({ name: rm_path.node.id.name, path: rm_path })
      } else {
        console.error('Unexpected reference')
        return null
      }
    }
    if (!ob_func_str.length) {
      return null
    }
    ob_func_str.push(generator(path.node, optGenMin).code)
    path.remove()
    return {
      version: 0,
      stringArrayName: array_name,
      stringArrayCodes: ob_func_str,
      stringArrayCalls: ob_dec_call,
    }
  }
  let ret_obj = {
    version: 0,
    stringArrayName: null,
    stringArrayCodes: [],
    stringArrayCalls: [],
  }
  function check_string_array(path) {
    if (path.getFunctionParent()) {
      return
    }
    const init = path.get('init')
    if (!init.isArrayExpression()) {
      return
    }
    if (!init.node.elements.length) {
      return
    }
    const array_name = path.node.id.name
    const obj = check_other_function(path, array_name)
    if (obj) {
      ret_obj = obj
      path.stop()
    }
  }
  traverse(ast, {
    VariableDeclarator: check_string_array,
  })
  return ret_obj
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
    obj.stringArrayCodes.push(generator(def, optGenMin).code)
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
        obj.stringArrayCodes.push(generator(up1.node, optGenMin).code)
        up1.node.body = t.blockStatement([])
        obj.stringArrayCalls.push({ name: up1.node.id.name, path: up1 })
        continue
      }
      if (up1.key === 'init') {
        // v < 2.12.0
        // The `stringArrayCallsWrapperName` is defined by VariableDeclarator
        up1 = up1.parentPath
        const node = t.variableDeclaration('var', [up1.node])
        obj.stringArrayCodes.push(generator(node, optGenMin).code)
        up1.node.init = null
        obj.stringArrayCalls.push({ name: up1.node.id.name, path: up1 })
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
      obj.stringArrayCodes.push(generator(up2.node, optGenMin).code)
      up1.remove()
      up2.node.body = t.blockStatement([])
      obj.stringArrayCalls.push({ name: wrapper, path: up2 })
    }
    // Remove the string array
    bind.path.remove()
    // Add the rotate function
    const node = t.expressionStatement(path.node)
    obj.stringArrayCodes.push(generator(node, optGenMin).code)
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
      const code = generator(t.BlockStatement(nodes), optGenMin).code
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
        const code = generator(rm_path.node, optGenMin).code
        rm_path.node.body = t.blockStatement([])
        nodes.push([code, 'func3', rm_path])
      } else {
        console.error('Unexpected reference')
      }
    }
    paths.map(find3)
    if (!name_func) {
      return
    }
    ob_string_func_name = name_func
    ob_func_str.push(generator(path.node, optGenMin).code)
    nodes.map(function (item) {
      if (item[1] == 'func3') {
        ob_func_str.push(item[0])
        ob_dec_name.push({ name: item[2].node.id.name, path: item[2] })
        return
      }
      let node = item[0]
      if (t.isCallExpression(node)) {
        node = t.expressionStatement(node)
      }
      ob_func_str.push(generator(node, optGenMin).code)
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
  }
  if (!obj.stringArrayName) {
    obj = stringArrayV0(ast)
  }
  if (!obj.stringArrayName) {
    console.error('Cannot find string list!')
    return false
  }
  console.log(`String List Name: ${obj.stringArrayName}`)
  let ob_func_str = obj.stringArrayCodes
  let ob_dec_call = obj.stringArrayCalls
  try {
    virtualGlobalEval(ob_func_str.join(';'))
  } catch (e) {
    // issue #31
    if (e.name === 'ReferenceError') {
      let lost = e.message.split(' ')[0]
      traverse(ast, {
        Program(path) {
          let loc = path.scope.getBinding(lost).path
          let obj = t.variableDeclaration(loc.parent.kind, [loc.node])
          ob_func_str.unshift(generator(obj, optGenMin).code)
          loc.node.init = null
          ob_dec_call.push({ name: lost, path: loc })
          path.stop()
        },
      })
      virtualGlobalEval(ob_func_str.join(';'))
    }
  }

  // 递归删除混淆函数
  function getChild(father) {
    if (father.key !== 'argument' || !father.parentPath.isReturnStatement()) {
      console.error(`Unexpected chained call: ${father}`)
      return null
    }
    const func = father.getFunctionParent()
    let name = func.node.id?.name
    let root
    let code
    if (name) {
      // FunctionDeclaration
      // function A (...) { return function B (...) }
      root = func
      code = generator(root.node, optGenMin).code
    } else {
      // FunctionExpression
      // var A = function (...) { return function B (...) }
      root = func.parentPath
      code = generator(t.variableDeclaration('var', [root])).code
      name = root.node.id.name
    }
    return {
      name: name,
      path: root,
      code: code,
    }
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
    const binding = scope.getBinding(cur_val)
    binding.scope.crawl()
    const refs = binding.scope.bindings[cur_val].referencePaths
    const refs_next = []
    // 有4种链式调用情况：
    // - VariableDeclarator和FunctionDeclaration为原版
    // - AssignmentExpression 出现于 #50
    // - FunctionExpression 出现于 #94
    for (let ref of refs) {
      const parent = ref.parentPath
      if (ref.key === 'callee') {
        // CallExpression
        let old_call = parent + ''
        try {
          // 运行成功则说明函数为直接调用并返回字符串
          let new_str = virtualGlobalEval(old_call)
          console.log(`map: ${old_call} -> ${new_str}`)
          parent.replaceWith(t.StringLiteral(new_str))
        } catch (e) {
          // 运行失败则说明函数为其它混淆函数的子函数
          console.log(`sub: ${old_call}`)
          const ret = getChild(parent)
          if (ret) {
            refs_next.push(ret)
          }
        }
      } else if (ref.key === 'init') {
        // VariableDeclarator
        refs_next.push({
          name: ref.parent.id.name,
          path: ref.parentPath,
          code: 'var ' + ref.parentPath,
        })
      } else if (ref.key === 'right') {
        // AssignmentExpression
        // 这种情况尚不完善 可能会产生额外替换
        refs_next.push({
          name: ref.parent.left.name,
          path: ref.parentPath,
          code: 'var ' + ref.parentPath,
        })
      }
    }
    for (let ref of refs_next) {
      dfs(stk, ref)
    }
    binding.scope.crawl()
    console.log(`Exit sub ${stk.length}:${cur_val}`)
    stk.pop()
    if (!item.path.parentPath.isCallExpression()) {
      item.path.remove()
      binding.scope.crawl()
      return
    }
    // 只会出现在AssignmentExpression情况下 需要再次运行
    item.path.replaceWith(t.identifier(cur_val))
    item.path = binding.path
    binding.scope.crawl()
    dfs(stk, item)
  }
  for (let item of ob_dec_call) {
    item.code = ''
    dfs([], item)
  }
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

function decodeCodeBlock(ast) {
  // 合并字面量
  traverse(ast, calculateConstantExp)
  // 先合并分离的Object定义
  traverse(ast, mergeObject)
  // 在变量定义完成后判断是否为代码块加密内容
  traverse(ast, parseControlFlowStorage)
  // 合并字面量(在解除区域混淆后会出现新的可合并分割)
  traverse(ast, calculateConstantExp)
  return ast
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
    if (!pre_path.isVariableDeclaration()) {
      return
    }
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
  traverse(ast, calculateConstantExp)
  traverse(ast, pruneIfBranch)
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
  traverse(ast, splitAssignment)
  // 删除未使用的变量
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
  traverse(ast, splitSequence)
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
      // #94
      `var=function(){var=.constructor()return.test(${selfName})}return()`,
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
      const up2 = up1.getFunctionParent()?.parentPath
      if (up2) {
        // DebugProtectionFunctionCall
        const scope2 = up2.scope.getBinding(callName).scope
        up2.remove()
        scope1.crawl()
        scope2.crawl()
        const bind = scope2.bindings[callName]
        bind.path.remove()
        console.info(`Remove CallFunc: ${callName}`)
        continue
      }
      // exceptions #95
      const rm = ref.parentPath
      rm.remove()
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

export default function (code) {
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
  traverse(ast, deleteIllegalReturn)
  // Lint before split statements
  traverse(ast, lintIfStatement)
  // Split declarations to avoid bugs
  traverse(ast, splitVarDeclaration)
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
  ast = parse(generator(ast, optGenMin).code, { errorRecovery: true })
  console.log('提高代码可读性...')
  ast = purifyCode(ast)
  console.log('解除环境限制...')
  ast = unlockEnv(ast)
  console.log('净化完成')
  code = generator(ast, { jsescOption: { minimal: true } }).code
  if (global_eval) {
    code = PluginEval.pack(code)
  }
  return code
}
