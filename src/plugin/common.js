const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default

module.exports = function (code) {
  let ast
  try {
    ast = parse(code, { errorRecovery: true })
  } catch (e) {
    console.error(`Cannot parse code: ${e.reasonCode}`)
    return null
  }
  const deleteExtra = require('../visitor/delete-extra')
  traverse(ast, deleteExtra)
  const calculateConstantExp = require('../visitor/calculate-constant-exp')
  traverse(ast, calculateConstantExp)
  const calculateRString = require('../visitor/calculate-rstring')
  traverse(ast, calculateRString)
  code = generator(ast).code
  return code
}
