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
