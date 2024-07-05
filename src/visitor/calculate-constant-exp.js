const generator = require('@babel/generator').default
const t = require('@babel/types')

/**
 * Calculate BinaryExpression if left and right are both literals.
 * Otherwise, the expression can't be simplified.
 *
 * For example, `typeof window` can be calculated but it's not constant.
 */
function calculateBinaryExpression(path) {
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
}

function calculateUnaryExpression(path) {
  const node0 = path.node
  if (node0.operator !== '!') {
    return
  }
  const node1 = node0.argument
  if (t.isArrayExpression(node1)) {
    if (node1.elements.length === 0) {
      path.replaceWith(t.booleanLiteral(false))
    }
    return
  }
  if (t.isLiteral(node1)) {
    const code = generator(node0).code
    path.replaceWith(t.booleanLiteral(eval(code)))
    return
  }
}

module.exports = {
  BinaryExpression: { exit: calculateBinaryExpression },
  UnaryExpression: { exit: calculateUnaryExpression },
}
