import { parse } from '@babel/parser'
import _generate from '@babel/generator'
import _traverse from '@babel/traverse'
import * as t from '@babel/types'

const generator = _generate.default
const traverse = _traverse.default

function unpack(code) {
  let ast = parse(code)
  let lines = ast.program.body
  let data = null
  for (let line of lines) {
    if (t.isEmptyStatement(line)) {
      continue
    }
    if (data) {
      return null
    }
    if (
      t.isCallExpression(line?.expression) &&
      line.expression.callee?.name === 'eval' &&
      line.expression.arguments.length === 1 &&
      t.isCallExpression(line.expression.arguments[0])
    ) {
      data = t.expressionStatement(line.expression.arguments[0])
      continue
    }
    return null
  }
  if (!data) {
    return null
  }
  code = generator(data, { minified: true }).code
  return eval(code)
}

function pack(code) {
  let ast1 = parse('(function(){}())')
  let ast2 = parse(code)
  traverse(ast1, {
    FunctionExpression(path) {
      let body = t.blockStatement(ast2.program.body)
      path.replaceWith(t.functionExpression(null, [], body))
      path.stop()
    },
  })
  code = generator(ast1, { minified: false }).code
  return code
}

export default {
  unpack: unpack,
  pack: pack,
}
