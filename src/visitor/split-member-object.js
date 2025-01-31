function splitMemberObject(path) {
  const object = path.get('object')
  if (!object.isAssignmentExpression()) {
    return
  }
  let insertPath = path
  while (!insertPath?.listKey) {
    if (insertPath.parentPath.isAssignmentExpression()) {
      insertPath = insertPath.parentPath
      continue
    }
    if (insertPath.parentPath.isExpressionStatement()) {
      insertPath = insertPath.parentPath
      continue
    }
    return
  }
  insertPath.insertBefore(object.node)
  object.replaceWith(object.node.left)
  insertPath.scope.crawl()
}

/**
 * Split assignment operation in member object
 *
 * From:
 * ```javascript
 * (a = {})['b'] = c;
 * ```
 * To:
 * ```javascript
 * a = {}
 * a['b'] = c;
 * ```
 */
export default {
  MemberExpression: splitMemberObject,
}
