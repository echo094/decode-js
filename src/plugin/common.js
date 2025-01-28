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
  const deleteUnreachableCode = require('../visitor/delete-unreachable-code')
  traverse(ast, deleteUnreachableCode)
  const deleteNestedBlocks = require('../visitor/delete-nested-blocks')
  traverse(ast, deleteNestedBlocks)
  const calculateConstantExp = require('../visitor/calculate-constant-exp')
  traverse(ast, calculateConstantExp)
  const calculateRString = require('../visitor/calculate-rstring')
  traverse(ast, calculateRString)
  code = generator(ast).code
  return code
}
