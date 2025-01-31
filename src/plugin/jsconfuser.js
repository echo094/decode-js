import { parse } from '@babel/parser'
import _generate from '@babel/generator'
const generator = _generate.default
import _traverse from '@babel/traverse'
const traverse = _traverse.default

import calculateConstantExp from '../visitor/calculate-constant-exp.js'
import pruneIfBranch from '../visitor/prune-if-branch.js'
import jcAntiTooling from '../visitor/jsconfuser/anti-tooling.js'
import jcControlFlow from '../visitor/jsconfuser/control-flow.js'
import jcDuplicateLiteral from '../visitor/jsconfuser/duplicate-literal.js'
import jcGlobalConcealing from '../visitor/jsconfuser/global-concealing.js'
import jcMinifyInit from '../visitor/jsconfuser/minify.js'
import jcOpaquePredicates from '../visitor/jsconfuser/opaque-predicates.js'
import jcStackInit from '../visitor/jsconfuser/stack.js'
import jcStringCompression from '../visitor/jsconfuser/string-compression.js'
import jcStringConceal from '../visitor/jsconfuser/string-concealing.js'

export default function (code) {
  let ast
  try {
    ast = parse(code, { errorRecovery: true })
  } catch (e) {
    console.error(`Cannot parse code: ${e.reasonCode}`)
    return null
  }
  // AntiTooling
  traverse(ast, jcAntiTooling)
  // Minify
  const jcMinify = jcMinifyInit()
  traverse(ast, jcMinify.deMinifyArrow)
  // DuplicateLiteralsRemoval
  traverse(ast, jcDuplicateLiteral)
  // Stack
  const jcStack = jcStackInit(jcMinify.arrowFunc)
  traverse(ast, jcStack.deStackFuncLen)
  traverse(ast, jcStack.deStackFuncOther)
  // StringCompression
  traverse(ast, jcStringCompression)
  // StringConcealing
  traverse(ast, jcStringConceal.deStringConcealing)
  traverse(ast, jcStringConceal.deStringConcealingPlace)
  // StringSplitting
  traverse(ast, calculateConstantExp)
  // Stack (run again)
  traverse(ast, jcStack.deStackFuncOther)
  // OpaquePredicates
  traverse(ast, jcOpaquePredicates)
  traverse(ast, calculateConstantExp)
  traverse(ast, pruneIfBranch)
  // GlobalConcealing
  traverse(ast, jcGlobalConcealing)
  // ControlFlowFlattening
  traverse(ast, jcControlFlow.deControlFlowFlatteningStateless)
  traverse(ast, calculateConstantExp)
  // ExpressionObfuscation
  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  return code
}
