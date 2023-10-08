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
  const calculateBinary = require('../visitor/calculate-binary')
  traverse(ast, calculateBinary)
  const calculateRString = require('../visitor/calculate-rstring')
  traverse(ast, calculateRString)
  code = generator(ast).code
  return code
}
