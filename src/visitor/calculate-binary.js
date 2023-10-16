const generator = require('@babel/generator').default
const t = require('@babel/types')

/**
 * Calculate BinaryExpression if left and right are both literals.
 * Otherwise, the expression can't be simplified.
 *
 * For example, `typeof window` can be calculated but it's not constant.
 */
module.exports = {
  BinaryExpression(path) {
    const { left, right } = path.node
    if (!t.isLiteral(left) || !t.isLiteral(right)) {
      return
    }
    const code = generator(path.node).code
    try {
      const ret = eval(code)
      path.replaceWithSourceString(ret)
    } catch {
      //
    }
  },
}
