const t = require('@babel/types')

function mergeObject(path) {
  const { id, init } = path.node
  if (!t.isObjectExpression(init)) {
    // 判断是否是定义对象
    return
  }
  let name = id.name
  let scope = path.scope
  let binding = scope.getBinding(name)
  const start = path.node.end
  let end = -1
  let violation = null
  if (!binding.constant) {
    // Find the first constantViolation after this declaration
    for (let item of binding.constantViolations) {
      if (item.node.start <= start) {
        continue
      }
      if (item.isVariableDeclarator()) {
        end = item.node.start
        violation = item
        break
      }
      if (item.isAssignmentExpression()) {
        end = item.node.start
        violation = item
        break
      }
      return
    }
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
  let cur = 0
  let valid = true
  // Check references in sequence
  while (cur < binding.references) {
    const ref = binding.referencePaths[cur]
    // Ignore the references before this declaration
    if (ref.node.start <= start) {
      ++cur
      continue
    }
    // Ignore the references after the first constantViolation
    if (end >= 0 && ref.node.end >= end) {
      break
    }
    if (ref.key !== 'object' || !ref.parentPath.isMemberExpression()) {
      break
    }
    const me = ref.parentPath
    if (me.key !== 'left' || !me.parentPath.isAssignmentExpression()) {
      break
    }
    const ae = me.parentPath
    let bk = ae
    let stop = false
    while (bk.parentPath !== container) {
      if (
        bk.parentPath.isSequenceExpression() ||
        bk.parentPath.isVariableDeclarator() ||
        bk.parentPath.isVariableDeclaration() ||
        bk.parentPath.isExpressionStatement()
      ) {
        bk = bk.parentPath
        continue
      }
      stop = true
      break
    }
    if (stop) {
      break
    }
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
    if (ref.parentPath.isSequenceExpression() && ref.container.length === 1) {
      ref = ref.parentPath
    }
    if (
      ref.parentPath.isVariableDeclarator() ||
      ref.parentPath.isAssignmentExpression()
    ) {
      ref.replaceWith(left)
    } else {
      ref.remove()
    }
  }
  // Check the remaining references
  const ref1 = binding.referencePaths[cur++]
  if (!ref1) {
    scope.crawl()
    return
  }
  const ref2 = binding.referencePaths[cur]
  // Don't replace the declarator if there exists more than one reference
  if (ref2 && ref2.node.end < end) {
    scope.crawl()
    return
  }
  // Check if the only reference is an assignment
  let key = ref1.key
  let up1 = ref1.parentPath
  if (up1.isSequenceExpression() && ref1.container.length === 1) {
    key = up1.key
    up1 = up1.parentPath
  }
  if (!up1.isVariableDeclarator() || key !== 'init') {
    scope.crawl()
    return
  }
  // Move the definition to its reference
  up1.node.init = path.node.init
  // Delete the original definition
  if (violation?.isAssignmentExpression()) {
    path.node.init = undefined
  } else {
    path.remove()
  }
  scope.crawl()
}

/**
 * Collect the properties of one object and move it back to the declaration.
 *
 * One example made by ObjectExpressionKeysTransformer:
 *
 * ```javascript
 * var _0xb28de8 = {};
 * _0xb28de8["abcd"] = function(_0x22293f, _0x5a165e) {
 *     return _0x22293f == _0x5a165e;
 * };
 * _0xb28de8.dbca = function(_0xfbac1e, _0x23462f, _0x556555) {
 *     return _0xfbac1e(_0x23462f, _0x556555);
 * };
 * _0xb28de8.aaa = function(_0x57e640) {
 *     return _0x57e640();
 * };
 * _0xb28de8["bbb"] = "eee";
 * var _0x15e145 = _0xb28de8;
 * ```
 *
 * The result:
 *
 * ```javascript
 * var _0x15e145 = {
 *   "abcd": function (_0x22293f, _0x5a165e) {
 *     return _0x22293f == _0x5a165e;
 *   },
 *   "dbca": function (_0xfbac1e, _0x23462f, _0x556555) {
 *     return _0xfbac1e(_0x23462f, _0x556555);
 *   },
 *   "aaa": function (_0x57e640) {
 *     return _0x57e640();
 *   },
 *   "bbb": "eee"
 * };
 * ```
 *
 * Note:
 * - Constant objects in the original code can be splitted
 * - AssignmentExpression can be moved to ReturnStatement
 */
module.exports = {
  VariableDeclarator: mergeObject,
}
