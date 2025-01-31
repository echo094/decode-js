import _generate from '@babel/generator'
const generator = _generate.default
import * as t from '@babel/types'

function checkLiteral(node) {
  if (t.isNumericLiteral(node)) {
    return 'positive'
  }
  if (t.isLiteral(node)) {
    return 'literal'
  }
  if (!t.isUnaryExpression(node)) {
    return false
  }
  if (!t.isNumericLiteral(node.argument)) {
    return false
  }
  if (node.operator === '-') {
    return 'negative'
  }
  return false
}

/**
 * Calculate BinaryExpression if left and right are both literals.
 * Otherwise, the expression can't be simplified.
 * Note that negative numbers are UnaryExpressions.
 */
function calculateBinaryExpression(path) {
  const { left, right } = path.node
  if (!checkLiteral(left) || !checkLiteral(right)) {
    return
  }
  const code = generator(path.node).code
  try {
    const ret = eval(code)
    // The strings cannot use replaceWithSourceString
    // For example, string "ab" will be parsed as identifier ab
    if (typeof ret === 'string') {
      path.replaceWith(t.stringLiteral(ret))
    } else {
      path.replaceWithSourceString(ret)
    }
  } catch {
    //
  }
}

/**
 * Calculate UnaryExpression:
 * - the operator is `!` and the argument is ArrayExpression or Literal.
 * - the operator is `-` and the argument is a negative number
 * - the operator is `+`, or `~`, and the argument is a number
 * - the operator is 'void' and the argument is Literal.
 * - the operator is 'typeof' and the argument is Literal.
 *
 * Otherwise, the expression can't be simplified.
 * For example, `typeof window` can be calculated but it's not constant.
 */
function calculateUnaryExpression(path) {
  const node0 = path.node
  const node1 = node0.argument
  const isLiteral = checkLiteral(node1)
  if (node0.operator === '!') {
    if (t.isArrayExpression(node1)) {
      if (node1.elements.length === 0) {
        path.replaceWith(t.booleanLiteral(false))
      }
    }
    if (isLiteral) {
      const code = generator(node0).code
      path.replaceWith(t.booleanLiteral(eval(code)))
    }
    return
  }
  if (node0.operator === '-') {
    if (isLiteral === 'negative') {
      const code = generator(node0).code
      path.replaceWithSourceString(eval(code))
    }
    return
  }
  if (node0.operator === '+' || node0.operator === '~') {
    if (isLiteral === 'negative' || isLiteral === 'positive') {
      const code = generator(node0).code
      path.replaceWithSourceString(eval(code))
    }
    return
  }
  if (node0.operator === 'void') {
    if (isLiteral) {
      path.replaceWith(t.identifier('undefined'))
    }
    return
  }
  if (node0.operator === 'typeof') {
    if (isLiteral) {
      const code = generator(node0).code
      path.replaceWith(t.stringLiteral(eval(code)))
    }
    return
  }
}

export default {
  BinaryExpression: { exit: calculateBinaryExpression },
  UnaryExpression: { exit: calculateUnaryExpression },
}
