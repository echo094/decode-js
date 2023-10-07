const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default

module.exports = function (code) {
  let ast
  try {
    ast = parse(code, { errorRecovery: true })
  } catch (e) {
    console.error(`Cannot parse code: ${e.reasonCode}`)
    return null
  }
  code = generator(ast).code
  return code
}
