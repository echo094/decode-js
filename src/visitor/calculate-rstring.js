const generator = require('@babel/generator').default
const t = require('@babel/types')

/**
 * "sh".split("").reverse().join("") -> "hs"
 */
module.exports = {
  StringLiteral(path) {
    if (path.key !== 'object') {
      return
    }
    let root = path
    let count = 6
    while (root.parentPath && count) {
      if (
        root.parentPath.isMemberExpression() ||
        root.parentPath.isCallExpression()
      ) {
        root = root.parentPath
        --count
      } else {
        break
      }
    }
    if (count) {
      return
    }
    const code = generator(root.node).code
    try {
      const ret = eval(code)
      root.replaceWith(t.stringLiteral(ret))
    } catch {
      //
    }
  },
}
