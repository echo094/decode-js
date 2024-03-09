/**
 * Reference：
 * * [某宝登录bx-ua参数逆向思路(fireyejs 225算法)](https://zhuanlan.zhihu.com/p/626187669)
 */
const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default
const t = require('@babel/types')

let name_count = 1000
/**
 * Assign a unique name to each Identifier
 */
const RenameIdentifier = {
  FunctionDeclaration(path) {
    if (!path.node?.id?.name) {
      return
    }
    let up1 = path.parentPath
    let s = up1.scope.generateUidIdentifier(`_u${name_count++}f`)
    up1.scope.rename(path.node.id.name, s.name)
    for (let it of path.node.params) {
      s = path.scope.generateUidIdentifier(`_u${name_count++}p`)
      path.scope.rename(it.name, s.name)
    }
  },
  VariableDeclarator(path) {
    const s = path.scope.generateUidIdentifier(`_u${name_count++}v`)
    path.scope.rename(path.node.id.name, s.name)
  },
}

/**
 * In this scenario, there are two kind of usages:
 * 1. `void 0` to express `undefined`
 * 2. `void(Expression)` to delete the return value of the case branch
 *    (a compact single expression).
 *    Removing void is a prerequisite for handling internal Expressions.
 */
const RemoveVoid = {
  UnaryExpression(path) {
    if (path.node.operator === 'void') {
      const code = generator(path.node).code
      if (code === 'void 0') {
        path.replaceWith(t.identifier('undefined'))
      } else {
        path.replaceWith(path.node.argument)
      }
    }
  },
}

/**
 * Do the following transform:
 *
 * r=t?a:b => t?r=a:r=b
 *
 * This is a prerequisite for converting ternary expressions.
 */
const ConvertConditionalAssign = {
  ConditionalExpression: {
    exit(path) {
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
    },
  },
}

/**
 * Convert all ternary expressions into if statements (root to leaf):
 *
 * t?a:b => if(t){a}else{b}
 *
 * Additional operations may be required considering the parent node:
 *
 * - SequenceExpression: a,b,c => {a;b;c;}
 * - LogicalExpression(&& only): a&&b => if(a){b}
 * - ExpressionStatement: no action is needed
 */
const LintConditionalIf = {
  ConditionalExpression: {
    enter(path) {
      let { test, consequent, alternate } = path.node
      // Handle the parent node
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
      // Convert current node
      consequent = t.expressionStatement(consequent)
      alternate = t.expressionStatement(alternate)
      let statement = t.ifStatement(test, consequent, alternate)
      path.replaceWithMultiple(statement)

      function sequence(path) {
        if (t.isLogicalExpression(path.parent)) {
          // The node is replaced, and thus don't need to traverse deeper
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
    },
  },
}

/**
 * Do the transformation if parent node is expression statement
 *
 * a&&b => if(a){b}
 */
const LintLogicalIf = {
  LogicalExpression: {
    exit(path) {
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
    },
  },
}

/**
 * Add parentheses to the consequent and alternate statements of if statements
 */
const LintIfStatement = {
  IfStatement: {
    exit(path) {
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
    },
  },
}

/**
 * Split the test node of IfStatement if it's a sequence
 */
const LintIfTestSequence = {
  IfStatement: {
    enter(path) {
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
    },
  },
}

/**
 * Do the following switch:
 *
 * NumericLiteral==Identifier => Identifier==NumericLiteral
 */
const LintIfTestBinary = {
  IfStatement: {
    exit(path) {
      let path_test = path.get('test')
      if (!path_test.isBinaryExpression({ operator: '==' })) {
        return
      }
      let { left, right } = path_test.node
      if (t.isNumericLiteral(left) && t.isIdentifier(right)) {
        path_test.replaceWith(t.binaryExpression('==', right, left))
      }
    },
  },
}

/**
 * Add parentheses to each switch-case
 */
const LintSwitchCase = {
  SwitchCase: {
    enter(path) {
      let { test, consequent } = path.node
      if (consequent.length == 1 && t.isBlockStatement(consequent[0])) {
        return
      }
      let block = t.blockStatement(consequent)
      path.replaceWith(t.switchCase(test, [block]))
    },
  },
}

/**
 * Split the ReturnStatement if it's a sequence
 */
const LintReturn = {
  ReturnStatement: {
    enter(path) {
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
    },
  },
}

/**
 * Split a sequence into expression array
 */
const LintSequence = {
  SequenceExpression: {
    exit(path) {
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
    },
  },
}

/**
 * Remove the function call if it's inside a function:
 *
 * !function(){body}(); => {body}
 */
const LintFunction = {
  FunctionExpression(path) {
    let { id, params, body } = path.node
    if (id || params.length) {
      return
    }
    if (
      path.getFunctionParent() &&
      path.parentPath.isCallExpression() &&
      path.parentPath.parentPath.isUnaryExpression({ operator: '!' })
    ) {
      path.parentPath.parentPath.parentPath.replaceWith(body)
    }
  },
}

/**
 * Flatten the BlockStatement:
 *
 * {a;{b}} => {a;b}
 */
const LintBlock = {
  BlockStatement: {
    exit(path) {
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
    },
  },
}

/**
 * Index for each switch-case:
 *
 * ```javascript
 * {
 *   range: Number, // the value derived from `num1`
 *   parent: String, // the init of this part
 *   root: String, // the `index` of this part
 * }
 * ```
 *
 * @param {Object} key - The `part` index and its data
 *
 */
let info_choice = {}
/**
 * Index for each switch-case:
 *
 * ```javascript
 * {
 *   start: Number, // the `start` value
 *   code: String, // the code of VariableDeclaration
 *   child: { // The parent of each part
 *     part: String,
 *   },
 *   value: { // The usage count of each key. default: empty
 *     key: Number,
 *   }
 *   visit: Number, // If it's visited. default: 0
 * }
 * ```
 *
 * @param {Object} key - The `index` and its data
 *
 */
let info_key = {}

/**
 * Firstly, we need to find all the switch-case blocks and save them to
 * `info_choice` and `info_key`, which follows the below template:
 *
 * ```javascript
 * for (var index = start; undefined !== index) {
 *   var ..., part1 = num1 & (index >> offset1);
 *   switch (num1 & index) {
 *     case x: {
 *       if (part1 == y) {
 *       }
 *     } // code branch
 *   } // main block
 * } // code block
 * ```
 *
 * Normally, $num1 = 2^{offset1} - 1$.
 */
function CollectVars(ast) {
  const visitor_checker = {
    Identifier(path) {
      info_choice[this.name].parent = path.node.name
      path.stop()
    },
  }
  traverse(ast, {
    VariableDeclarator(path) {
      let { id, init } = path.node
      if (
        !t.isBinaryExpression(init, { operator: '&' }) ||
        !t.isNumericLiteral(init.left)
      ) {
        return
      }
      const name = id.name
      const binding = path.scope.getBinding(name)
      if (!binding || !binding.constant) {
        return
      }
      let upper1 = path.findParent((path) => path.isVariableDeclaration())
      if (!upper1.node) {
        return
      }
      let upper2 = path.findParent((path) => path.isForStatement())
      if (!upper2.node) {
        return
      }
      if (upper2.node.body.body.length !== 2) {
        console.warn('Unexpected block length of for statement!')
      }
      let pname = upper2.node.init?.declarations[0]?.id?.name
      info_choice[name] = {
        range: init.left.value + 1,
        root: pname,
      }
      if (!(pname in info_key)) {
        const start = upper2.node.init.declarations[0].init.value
        info_key[pname] = {
          start: start,
          code: generator(upper1.node).code,
          child: { pname: pname },
          value: {},
          visit: 0,
        }
      }
      info_key[pname].child[name] = name
      path.get('init').traverse(visitor_checker, { name: name })
    },
  })
  for (const p in info_choice) {
    console.info(`Var: ${p} Root: ${info_choice[p].root}`)
  }
}

/**
 * Secondly, we can convert the if-else to switch-case.
 * A dfs search is performed to identify the key of each branch.
 * After this step, the `info_choice` is not needed.
 *
 * 1. Generate an array of all the keys e.g., [0..7]
 * 2. Evaluate each key with the test condition
 * 3. Split the array into left (consequent) and right (alternate)
 * 4. Go to each branch until the leaf
 * 5. Store the leaf code with its key
 */
function FlattenIf(ast) {
  let name
  let code
  let last
  function dfs(node, candidate) {
    const test = generator(node.test).code
    // console.log(test)
    let left = []
    let right = []
    for (const c of candidate) {
      if (eval(`let ${name}=${c}; ${test}`)) {
        left.push(c)
      } else {
        right.push(c)
      }
    }
    const hasNext = (node) => {
      if (!t.isIfStatement(node.body[0])) {
        return false
      }
      return node.body[0].test.left?.name === name
    }
    if (hasNext(node.consequent)) {
      dfs(node.consequent.body[0], left)
    } else if (left.length == 1) {
      code[left[0]] = node.consequent.body
    } else {
      if (last) {
        console.error('Multiple default choice!')
        throw new Error()
      }
      last = node.consequent.body
    }
    if (!node.alternate) {
      return
    }
    if (hasNext(node.alternate)) {
      dfs(node.alternate.body[0], right)
    } else if (right.length == 1) {
      code[right[0]] = node.alternate.body
    } else {
      if (last) {
        console.error('Multiple default choice!')
      }
      last = node.alternate.body
    }
  }
  traverse(ast, {
    IfStatement(path) {
      let path_test = path.get('test')
      if (!path_test.isBinaryExpression()) {
        return
      }
      name = path_test.node.left?.name
      if (!(name in info_choice)) {
        return
      }
      code = Array(info_choice[name].range)
      let candidate = Array.from(code.keys())
      last = null
      dfs(path.node, candidate)
      let cases = []
      for (let i = 0; i < code.length; ++i) {
        if (!code[i]) {
          break
        }
        code[i].push(t.breakStatement())
        cases.push(
          t.switchCase(t.numericLiteral(i), [t.blockStatement(code[i])])
        )
      }
      if (last) {
        last.push(t.breakStatement())
        cases.push(t.switchCase(null, [t.blockStatement(last)]))
      }
      const repl = t.switchStatement(t.identifier(name), cases)
      path.replaceWith(repl)
    },
  })
}

/**
 * Update the reference count of a block: info_key[index].value
 *
 * @param {String} key - index
 * @param {*} path_switch - The root of this switch
 */
function UpdateRefCount(key, path_switch) {
  const visitor_value = {
    AssignmentExpression(path) {
      if (path.node.left?.name === this.name) {
        const value = path.node.right.value
        if (value === undefined) {
          return
        }
        if (!(value in info_key[this.name].value)) {
          info_key[this.name].value[value] = 0
        }
        ++info_key[this.name].value[value]
      }
    },
  }
  info_key[key].value = {}
  const start = info_key[key].start
  info_key[key].value[start] = 1
  path_switch.traverse(visitor_value, { name: key })
  console.info(
    `Switch: ${key} Size: ${Object.keys(info_key[key].value).length}`
  )
}

/**
 * Convert binary equation to value
 */
const visitor_binary = {
  BlockStatement: {
    exit(path) {
      let info = {}
      const check_ep = (ep) => {
        let { operator, left, right } = ep.node
        if (!t.isIdentifier(left)) {
          return
        }
        const name = left.name
        let pfx = ''
        if (operator === '=') {
          if (t.isNumericLiteral(right) || t.isBooleanLiteral(right)) {
            info[name] = right.value
            return
          }
          if (!t.isBinaryExpression(right) && !t.isIdentifier(right)) {
            if (name in info) {
              delete info[name]
            }
            return
          }
          let test = generator(right).code
          if (test.indexOf(name) === -1) {
            pfx = 'var'
          }
        }
        let code = ''
        for (let key in info) {
          code += `var ${key}=${info[key]};`
        }
        code += `${pfx} ${generator(ep.node).code};${name}`
        try {
          let res = eval(code)
          ep.replaceWithSourceString(`${name}=${res}`)
          info[name] = res
        } catch {
          if (operator === '=' && name in info) {
            delete info[name]
          }
        }
      }
      for (let i in path.node.body) {
        let line = path.get(`body.${i}`)
        if (t.isAssignmentExpression(line.node?.expression)) {
          check_ep(line.get('expression'))
          continue
        }
        if (t.isExpressionStatement(line.node)) {
          const ep = line.get('expression')
          if (
            ep.isUpdateExpression() ||
            ep.isUnaryExpression() ||
            ep.isMemberExpression()
          ) {
            continue
          }
        }
        if (line.isIfStatement()) {
          let test = line.get('test')
          let code = ''
          for (let key in info) {
            code += `var ${key}=${info[key]};`
          }
          code += generator(test.node).code
          try {
            let res = eval(code)
            test.replaceWithSourceString(res)
          } catch {
            //
          }
        }
        info = {}
      }
    },
  },
}

/**
 *
 * @param {String} key - index
 * @param {*} path_switch - The root of this switch
 * @param {Array} nodes - The array of mapped branches
 * @param {Array} queue - The array of sorted keys
 */
function UpdateSwitchCases(key, path_switch, nodes, queue) {
  const body = []
  while (queue.length) {
    const value = queue.shift()
    if (value in nodes) {
      body.push(
        t.switchCase(t.numericLiteral(Number.parseInt(value)), [
          t.blockStatement(nodes[value]),
        ])
      )
      delete nodes[value]
    } else {
      console.error(`Missing Case ${value} in Switch ${key}`)
    }
  }
  for (let value in nodes) {
    body.push(
      t.switchCase(t.numericLiteral(Number.parseInt(value)), [
        t.blockStatement(nodes[value]),
      ])
    )
  }
  const repl = t.switchStatement(t.identifier(key), body)
  path_switch.replaceWith(repl)
}

/**
 * Flatten the nested switch-case, which is similar to FlattenIf.
 * A dfs search is performed to identify the branch of each key.
 */
function FlattenSwitch(ast) {
  /**
   *
   * @param {*} path - The root of this switch
   * @param {*} candidate - The array of keys
   * @param {*} key - index
   * @param {*} cases - The array of mapped branches
   */
  function dfs2(path, candidate, key, cases) {
    let mp = {}
    for (const c of candidate) {
      let code = `var ${key}=${c};${info_key[key].code}`
      let test = generator(path.node.discriminant).code
      let value = eval(code + test)
      if (!(value in mp)) {
        mp[value] = []
      }
      mp[value].push(c)
    }
    for (let i in path.node.cases) {
      const choice = path.get(`cases.${i}`)
      let body, c
      if (!choice.node.test) {
        const keys = Object.keys(mp)
        if (keys.length != 1) {
          throw new Error('Key - Case miss match!')
        }
        c = keys[0]
      } else {
        c = choice.node.test.value
      }
      body = choice.node.consequent[0].body
      if (!(c in mp)) {
        // This case is not referenced
        console.warn(`Drop Case ${c} in Switch ${key}`)
        continue
      }
      if (mp[c].length > 1) {
        if (body.length > 2) {
          console.error('Not empty before switch case')
        }
        dfs2(choice.get('consequent.0.body.0'), mp[c], key, cases)
      } else {
        const value = Number.parseInt(mp[c][0])
        if (body.length >= 2 && t.isIfStatement(body.at(-2))) {
          let line = body.at(-2)
          line.consequent.body.push(t.breakStatement())
          line.alternate.body.push(t.breakStatement())
          body.pop()
        }
        cases[value] = body
      }
      delete mp[c]
    }
  }
  traverse(ast, {
    ForStatement(path) {
      let key = path.node.init?.declarations[0]?.id?.name
      if (!(key in info_key) || info_key[key].visit) {
        return
      }
      const idx = path.node.body.body.length - 1
      const path_switch = path.get(`body.body.${idx}`)
      // Get all the cases
      UpdateRefCount(key, path_switch)
      let cases = {}
      let candidate = Object.keys(info_key[key].value)
      dfs2(path_switch, candidate, key, cases)
      // Replace cases
      UpdateSwitchCases(key, path_switch, cases, [])
      UpdateRefCount(key, path_switch)
      info_key[key].visit = 1
    },
  })
  for (let index in info_key) {
    info_key[index].visit = 0
  }
}

/**
 * Merge switch
 */
function MergeSwitch(ast) {
  let updated
  function dfs3(cases, vis, body, update, key, value, queue) {
    if (update) {
      if (value in vis) {
        return
      }
      vis[value] = 1
      queue.push(value)
    }
    let valid = true
    let last = -1
    while (valid) {
      if (t.isReturnStatement(body.at(-1))) {
        break
      }
      if (t.isIfStatement(body.at(-1))) {
        valid = false
        const test = body.at(-1).test
        const choices = [body.at(-1).consequent, body.at(-1).alternate]
        const ret = []
        for (let c of choices) {
          ret.push(dfs3(cases, vis, c.body, false, key, value, queue))
        }
        if (t.isBooleanLiteral(test) || t.isNumericLiteral(test)) {
          let add = 0
          if (!test.value) {
            add = 1
          }
          let del = 1 - add
          body.pop()
          body.push(...choices[add].body)
          // Some refs will be missed here if there's > 1 refs
          if (~ret[del]) {
            --info_key[key].value[ret[del]]
          }
          console.info(`delete if branch: ${key}:${ret[del]}`)
          valid = true
          updated = true
          continue
        }
        if (ret[0] == ret[1] && ~ret[0]) {
          let mv = choices[0].body.splice(choices[0].body.length - 2, 2)
          choices[1].body.splice(choices[1].body.length - 2, 2)
          body.push(...mv)
          --info_key[key].value[ret[0]]
          valid = true
          updated = true
          continue
        }
        if (value === ret[0]) {
          const arg = choices[0].body.at(-3)?.expression?.argument?.name
          if (arg && ~generator(test).code.indexOf(arg)) {
            const body1 = choices[0].body.slice(0, -2)
            const repl = t.whileStatement(test, t.blockStatement(body1))
            body.pop()
            body.push(repl)
            if (choices[1].body) {
              body.push(...choices[1].body)
            }
            --info_key[key].value[ret[0]]
            console.info(`merge inner while-loop: ${key}:${ret[0]}`)
            valid = true
            updated = true
            continue
          }
        }
      } else {
        let next = body.at(-2).expression.right.value
        if (next === undefined) {
          break
        }
        if (info_key[key].value[next] > 1) {
          dfs3(cases, vis, cases[next], true, key, next, queue)
          last = next
          break
        }
        body.splice(body.length - 2, 2)
        body.push(...cases[next])
        delete cases[next]
        updated = true
        // console.log(`merge ${key}:${next}->${value}`)
      }
    }
    if (update) {
      cases[value] = body
    }
    return last
  }
  traverse(ast, {
    ForStatement(path) {
      let key = path.node.init?.declarations[0]?.id?.name
      if (!(key in info_key) || info_key[key].visit) {
        return
      }
      const idx = path.node.body.body.length - 1
      const path_switch = path.get(`body.body.${idx}`)
      const start = info_key[key].start
      let collect_switch = () => {
        const list = path_switch.node.cases
        const out = {}
        for (let item of list) {
          out[item.test.value] = item.consequent[0].body
        }
        return out
      }
      // Get all the cases
      let cases = {}
      updated = true
      while (updated) {
        updated = false
        // Convert binary
        path.traverse(visitor_binary)
        // Get all the cases
        cases = collect_switch()
        // Marge cases
        let que = []
        dfs3(cases, {}, cases[start], true, key, start, que)
        // Replace
        UpdateSwitchCases(key, path_switch, cases, que)
        // Get the summary of this switch case
        UpdateRefCount(key, path_switch)
      }
      info_key[key].visit = 1
    },
  })
}

/**
 * In this scenario, some ForStatements are used to decode a string.
 * We can convert these codes to WhileStatement for further processing.
 */
const ConvertFor = {
  ForStatement(path) {
    let { init, test, update, body } = path.node
    if (!update || generator(update).code.indexOf('++') == -1) {
      return
    }
    body.body.push(t.expressionStatement(update))
    path.insertBefore(init)
    const repl = t.whileStatement(test, body)
    path.replaceWith(repl)
  },
}

/**
 * Split the variable declarator. (Cannot be performed before `CollectVars`)
 */
const SplitVarDef = {
  VariableDeclaration(path) {
    if (t.isForStatement(path.parent)) {
      return
    }
    const kind = path.node.kind
    const list = path.node.declarations
    if (list.length == 1) {
      return
    }
    for (let item of list) {
      path.insertBefore(t.variableDeclaration(kind, [item]))
    }
    path.remove()
  },
}

/**
 * Split the AssignmentExpressions. For example:
 *
 * - In the test of IfStatement
 * - In the VariableDeclaration
 * - Nested Expression (Assignment...)
 */
function MoveAssignment(ast) {
  // post order traversal
  let visitor = {
    AssignmentExpression: {
      exit(path) {
        if (path.parentPath.isExpressionStatement()) {
          return
        }
        let { left } = path.node
        this.current.insertBefore(t.ExpressionStatement(path.node))
        path.replaceWith(left)
      },
    },
  }
  traverse(ast, {
    IfStatement(path) {
      if (!t.isBlockStatement(path.parent)) {
        return
      }
      let test = path.get('test')
      if (test.isAssignmentExpression()) {
        path.insertBefore(t.expressionStatement(test.node))
        test.replaceWith(test.node.left)
        return
      }
      if (test.isMemberExpression()) {
        let property = test.get('property')
        if (property.isAssignmentExpression()) {
          path.insertBefore(t.expressionStatement(property.node))
          property.replaceWith(property.node.left)
        }
        let object = test.get('object')
        if (object.isAssignmentExpression()) {
          path.insertBefore(t.expressionStatement(object.node))
          object.replaceWith(object.node.left)
        }
      }
    },
  })
  traverse(ast, {
    'ExpressionStatement|VariableDeclaration'(path) {
      if (!t.isBlockStatement(path.parent)) {
        return
      }
      path.traverse(visitor, { current: path })
    },
  })
}

function MergeString(ast) {
  const visitor_block = {
    BlockStatement: {
      exit(path) {
        let info = {}
        const check_ep = (ep) => {
          let modified = false
          let { operator, left, right } = ep.node
          if (t.isIdentifier(left) && t.isStringLiteral(right)) {
            const name = left.name
            const value = right.value
            if (operator === '+=' && name in info) {
              if (info[name].used) {
                delete info[name]
              } else {
                info[name].value += value
                info[name].path.replaceWith(t.stringLiteral(info[name].value))
                ep.remove()
                modified = true
              }
            }
            if (operator === '=') {
              info[name] = {
                value: value,
                path: ep.get('right'),
                used: false,
              }
            }
            return modified
          }
          let code = generator(ep.node).code
          for (let key in info) {
            let test = `${key}.split("").reverse().join("")`
            let idx = code.indexOf(test)
            if (~idx) {
              let pfx = generator(info[key].path.parent).code
              const res = eval(`let ${pfx};${test}`)
              const repl = generator(t.stringLiteral(res)).code
              code = code.replace(test, repl)
              ep.replaceWithSourceString(code)
              info[key].used = true
              modified = true
              continue
            }
            if (~code.indexOf(key)) {
              info[key].used = true
            }
          }
          return modified
        }
        for (let i in path.node.body) {
          let line = path.get(`body.${i}`)
          if (line.isVariableDeclaration()) {
            const node = line.node.declarations[0]
            if (!node.init || !t.isStringLiteral(node.init)) {
              continue
            }
            info[node.id.name] = {
              value: node.init.value,
              path: line.get('declarations.0.init'),
              used: false,
            }
            continue
          }
          if (t.isAssignmentExpression(line.node?.expression)) {
            let modified = true
            while (
              modified &&
              t.isAssignmentExpression(line.node?.expression)
            ) {
              modified = check_ep(line.get('expression'))
              line = path.get(`body.${i}`)
            }
            continue
          }
          if (t.isExpressionStatement(line.node)) {
            const ep = line.get('expression')
            if (
              ep.isUpdateExpression() ||
              ep.isUnaryExpression() ||
              ep.isMemberExpression()
            ) {
              continue
            }
            info = {}
          }
          if (line.isBreakStatement() || line.isReturnStatement()) {
            continue
          }
          info = {}
        }
      },
    },
  }
  traverse(ast, {
    SwitchCase(path) {
      path.traverse(visitor_block)
    },
  })
}

function ProcessWhile(ast) {
  const visitor = {
    Identifier(path) {
      const name = path.node.name
      if (name.indexOf('_u') === 0) {
        this.line.push(`var ${path.node.name}`)
      }
    },
  }
  traverse(ast, {
    WhileStatement(path) {
      if (!path.parentPath.isBlockStatement()) {
        return
      }
      const code = generator(path.node).code
      const re = new RegExp('(_u[0-9]+v) \\+= String.fromCharCode', 'g')
      const match = [...code.matchAll(re)]
      if (match.length !== 1) {
        return
      }
      const name = match[0][1]
      let line = []
      path.traverse(visitor, { line: line })
      for (let i = 0; i < path.key; ++i) {
        try {
          const node = path.parent[path.listKey][i]
          let c = generator(node).code
          if (t.isExpressionStatement(node)) {
            c = 'var ' + c
          }
          eval(c)
          line.push(c)
        } catch {
          //
        }
      }
      line.push(code)
      line.push(name)
      try {
        let res = eval(line.join(';'))
        path.replaceWith(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.identifier(name),
              t.stringLiteral(res)
            )
          )
        )
      } catch {
        console.warn(`prase while ${name} failed`)
      }
    },
  })
}

module.exports = function (code) {
  let ast = parse(code)
  // Generate unique name for all identifiers
  traverse(ast, RenameIdentifier)
  console.info(`Count: ${name_count - 1000}`)
  // Pre Lint
  traverse(ast, RemoveVoid)
  traverse(ast, ConvertConditionalAssign)
  traverse(ast, LintConditionalIf)
  traverse(ast, LintLogicalIf)
  traverse(ast, LintIfStatement)
  traverse(ast, LintIfTestSequence)
  traverse(ast, LintIfTestBinary)
  traverse(ast, LintSwitchCase)
  traverse(ast, LintReturn)
  traverse(ast, LintSequence)
  traverse(ast, LintFunction)
  traverse(ast, LintBlock)
  // Now, the code is ready to be processed
  // Get control vars in switch
  CollectVars(ast)
  // Convert if-else to switch
  FlattenIf(ast)
  // Flatten nested switch
  FlattenSwitch(ast)
  // Convert some for to while
  traverse(ast, ConvertFor)
  // After the conversion, we should split some expressions,
  // to help get constant test results in the if statement.
  // The Variable Declaration list must be splitted first
  traverse(ast, SplitVarDef)
  // Then, the assignment should be splitted
  MoveAssignment(ast)
  // Merge switch case
  MergeSwitch(ast)
  // Post Lint
  // The string can be merged
  MergeString(ast)
  // Simplify while that contains String.fromCharCode
  ProcessWhile(ast)
  // Generate code
  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  return code
}
