/**
 * Reference：
 * * [某宝登录bx-ua参数逆向思路(fireyejs 225算法)](https://zhuanlan.zhihu.com/p/626187669)
 */
const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default
const t = require('@babel/types')

function RemoveVoid(path) {
  if (path.node.operator === 'void') {
    path.replaceWith(path.node.argument)
  }
}

function LintConditionalAssign(path) {
  if (!t.isAssignmentExpression(path?.parent)) {
    return
  }
  let { test, consequent, alternate } = path.node
  let { operator, left } = path.parent
  consequent = t.assignmentExpression(operator, left, consequent)
  alternate = t.assignmentExpression(operator, left, alternate)
  path.parentPath.replaceWith(
    t.conditionalExpression(test, consequent, alternate)
  )
}

function LintConditionalIf(ast) {
  function conditional(path) {
    let { test, consequent, alternate } = path.node
    // console.log(generator(test, { minified: true }).code)
    if (t.isSequenceExpression(path.parent)) {
      if (!sequence(path.parentPath)) {
        path.stop()
      }
      return
    }
    if (t.isLogicalExpression(path.parent)) {
      if (!logical(path.parentPath)) {
        path.stop()
      }
      return
    }
    if (!t.isExpressionStatement(path.parent)) {
      console.error(`Unexpected parent type: ${path.parent.type}`)
      path.stop()
      return
    }
    consequent = t.expressionStatement(consequent)
    alternate = t.expressionStatement(alternate)
    let statement = t.ifStatement(test, consequent, alternate)
    path.replaceWithMultiple(statement)
  }

  function sequence(path) {
    if (t.isLogicalExpression(path.parent)) {
      return logical(path.parentPath)
    }
    let body = []
    for (const item of path.node.expressions) {
      body.push(t.expressionStatement(item))
    }
    let node = t.blockStatement(body, [])
    let replace_path = path
    if (t.isExpressionStatement(path.parent)) {
      replace_path = path.parentPath
    } else if (!t.isBlockStatement(path.parent)) {
      console.error(`Unexpected parent type: ${path.parent.type}`)
      return false
    }
    replace_path.replaceWith(node)
    return true
  }

  function logical(path) {
    let { operator, left, right } = path.node
    if (operator !== '&&') {
      console.error(`Unexpected logical operator: ${operator}`)
      return false
    }
    if (!t.isExpressionStatement(path.parent)) {
      console.error(`Unexpected parent type: ${path.parent.type}`)
      return false
    }
    let node = t.ifStatement(left, t.expressionStatement(right))
    path.parentPath.replaceWith(node)
    return true
  }

  traverse(ast, {
    ConditionalExpression: { enter: conditional },
  })
}

function LintLogicalIf(path) {
  let { operator, left, right } = path.node
  if (operator !== '&&') {
    // console.warn(`Unexpected logical operator: ${operator}`)
    return
  }
  if (!t.isExpressionStatement(path.parent)) {
    console.warn(`Unexpected parent type: ${path.parent.type}`)
    return
  }
  let node = t.ifStatement(left, t.expressionStatement(right))
  path.parentPath.replaceWith(node)
  return
}

function LintIfStatement(path) {
  let { test, consequent, alternate } = path.node
  let changed = false
  if (!t.isBlockStatement(consequent)) {
    consequent = t.blockStatement([consequent])
    changed = true
  }
  if (alternate && !t.isBlockStatement(alternate)) {
    alternate = t.blockStatement([alternate])
    changed = true
  }
  if (!changed) {
    return
  }
  path.replaceWith(t.ifStatement(test, consequent, alternate))
}

function LintIfTest(path) {
  let { test, consequent, alternate } = path.node
  if (!t.isSequenceExpression(test)) {
    return
  }
  if (!t.isBlockStatement(path.parent)) {
    return
  }
  let body = test.expressions
  let last = body.pop()
  let before = t.expressionStatement(t.sequenceExpression(body))
  path.insertBefore(before)
  path.replaceWith(t.ifStatement(last, consequent, alternate))
}

function LintSwitchCase(path) {
  let { test, consequent } = path.node
  if (consequent.length == 1 && t.isBlockStatement(consequent[0])) {
    return
  }
  let block = t.blockStatement(consequent)
  path.replaceWith(t.switchCase(test, [block]))
}

function LintReturn(path) {
  let { argument } = path.node
  if (!t.isSequenceExpression(argument)) {
    return
  }
  if (!t.isBlockStatement(path.parent)) {
    return
  }
  let body = argument.expressions
  let last = body.pop()
  let before = t.expressionStatement(t.sequenceExpression(body))
  path.insertBefore(before)
  path.replaceWith(t.returnStatement(last))
}

function LintSequence(path) {
  let body = []
  for (const item of path.node.expressions) {
    body.push(t.expressionStatement(item))
  }
  let node = t.blockStatement(body, [])
  let replace_path = path
  if (t.isExpressionStatement(path.parent)) {
    replace_path = path.parentPath
  } else if (!t.isBlockStatement(path.parent)) {
    console.warn(`Unexpected parent type: ${path.parent.type}`)
    return
  }
  replace_path.replaceWith(node)
  return
}

function LintBlock(path) {
  let { body } = path.node
  if (!body.length) {
    return
  }
  let changed = false
  let arr = []
  for (const item of body) {
    if (!t.isBlockStatement(item)) {
      arr.push(item)
      continue
    }
    changed = true
    for (const sub of item.body) {
      arr.push(sub)
    }
  }
  if (!changed) {
    return
  }
  path.replaceWith(t.blockStatement(arr))
}

module.exports = function (code) {
  let ast = parse(code)
  // Lint
  traverse(ast, {
    UnaryExpression: RemoveVoid,
  })
  traverse(ast, {
    ConditionalExpression: { exit: LintConditionalAssign },
  })
  LintConditionalIf(ast)
  traverse(ast, {
    LogicalExpression: { exit: LintLogicalIf },
  })
  traverse(ast, {
    IfStatement: { exit: LintIfStatement },
  })
  traverse(ast, {
    IfStatement: { enter: LintIfTest },
  })
  traverse(ast, {
    SwitchCase: { enter: LintSwitchCase },
  })
  traverse(ast, {
    ReturnStatement: { enter: LintReturn },
  })
  traverse(ast, {
    SequenceExpression: { exit: LintSequence },
  })
  traverse(ast, {
    BlockStatement: { exit: LintBlock },
  })

  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  return code
}
