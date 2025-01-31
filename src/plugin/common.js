import { parse } from '@babel/parser'
import _generate from '@babel/generator'
const generator = _generate.default
import _traverse from '@babel/traverse'
const traverse = _traverse.default
import deleteUnreachableCode from '../visitor/delete-unreachable-code.js'
import deleteNestedBlocks from '../visitor/delete-nested-blocks.js'
import calculateConstantExp from '../visitor/calculate-constant-exp.js'
import calculateRString from '../visitor/calculate-rstring.js'

export default function (code) {
  let ast
  try {
    ast = parse(code, { errorRecovery: true })
  } catch (e) {
    console.error(`Cannot parse code: ${e.reasonCode}`)
    return null
  }
  traverse(ast, deleteUnreachableCode)
  traverse(ast, deleteNestedBlocks)
  traverse(ast, calculateConstantExp)
  traverse(ast, calculateRString)
  code = generator(ast).code
  return code
}
