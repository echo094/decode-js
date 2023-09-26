const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default
const t = require('@babel/types')

function unpack(code) {
  let ast = parse(code, { errorRecovery: true })
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

module.exports = {
  unpack,
  pack,
}
