const { parse } = require('@babel/parser')
const generator = require('@babel/generator').default
const traverse = require('@babel/traverse').default

const calculateConstantExp = require('../visitor/calculate-constant-exp')
const pruneIfBranch = require('../visitor/prune-if-branch')
const jcAntiTooling = require('../visitor/jsconfuser/anti-tooling')
const jcControlFlow = require('../visitor/jsconfuser/control-flow')
const jcDuplicateLiteral = require('../visitor/jsconfuser/duplicate-literal')
const jcGlobalConcealing = require('../visitor/jsconfuser/global-concealing')
const jcMinifyInit = require('../visitor/jsconfuser/minify')
const jcOpaquePredicates = require('../visitor/jsconfuser/opaque-predicates')
const jcStackInit = require('../visitor/jsconfuser/stack')
const jcStringCompression = require('../visitor/jsconfuser/string-compression')
const jcStringConceal = require('../visitor/jsconfuser/string-concealing')

module.exports = function (code) {
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
