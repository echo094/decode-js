import _generate from '@babel/generator'
const generator = _generate.default
import * as t from '@babel/types'

/**
 * "sh".split("").reverse().join("") -> "hs"
 */
export default {
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
