const generator = require('@babel/generator').default
const t = require('@babel/types')

function parseObject(path) {
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

/**
 * Parse control flow object
 *
 * Several kinds of expressions are collected, transformed, and merged into
 * the controlFlowStorage object by method FunctionControlFlowTransformer:
 *
 * - BinaryExpression
 * - CallExpression
 * - LogicalExpression
 * - Literal
 *
 * ```javascript
 * var _0xb28de8 = {
 *     "abcd": function(_0x22293f, _0x5a165e) {
 *         return _0x22293f == _0x5a165e;
 *     },
 *     "dbca": function(_0xfbac1e, _0x23462f, _0x556555) {
 *         return _0xfbac1e(_0x23462f, _0x556555);
 *     },
 *     "aaa": function(_0x57e640) {
 *         return _0x57e640();
 *     },
 *     "bbb": "eee",
 *     "ccc": A[x][y][...]
 * };
 * ```
 *
 * This visitor can parse such objects and undo the transformation.
 *
 * ```javascript
 * // From
 * var aa = _0xb28de8["abcd"](123, 456);
 * var bb = _0xb28de8["dbca"](bcd, 11, 22);
 * var cc = _0xb28de8["aaa"](dcb);
 * var dd = _0xb28de8["bbb"];
 * var ee = _0xb28de8["ccc"];
 * // To
 * var aa = 123 == 456;
 * var bb = bcd(11, 22);
 * var cc = dcb();
 * var dd = "eee";
 * var ee = A[x][y][...];
 * ```
 */
module.exports = {
  VariableDeclarator: {
    exit: parseObject,
  },
}
