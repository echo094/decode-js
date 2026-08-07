import * as t from '@babel/types'
import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode

/**
 * The no-op helper AstScrambler injects once per Program
 * (transforms/astScrambler.ts's own template):
 *   function name(){ name = function(){}; }
 * Matched structurally since `name` is a random placeholder.
 */
function isAstScramblerHelper(node) {
  if (!t.isFunctionDeclaration(node) || !node.id) return false
  if (node.params.length !== 0) return false

  const body = node.body.body
  if (body.length !== 1) return false

  const stmt = body[0]
  if (!t.isExpressionStatement(stmt)) return false

  const expr = stmt.expression
  if (!t.isAssignmentExpression(expr) || expr.operator !== '=') return false
  if (!t.isIdentifier(expr.left) || expr.left.name !== node.id.name)
    return false

  const fn = expr.right
  return (
    t.isFunctionExpression(fn) &&
    fn.params.length === 0 &&
    fn.body.body.length === 0
  )
}

/**
 * Fresh closure state per call (RGF recursively re-invokes the whole
 * pipeline on each eval-wrapped sub-program, so module-level state would
 * leak between runs), same reasoning as duplicate-literal.js.
 */
export default function deAstScramblerInit() {
  const cleanupCandidates = new Set()

  return {
    Program: {
      exit(path) {
        path.scope.crawl()
        for (const name of cleanupCandidates) {
          safeDeleteNode(name, path)
        }
      },
    },

    FunctionDeclaration(path) {
      if (!isAstScramblerHelper(path.node)) return

      const name = path.node.id.name
      const binding = path.scope.getBinding(name)
      if (!binding) return

      let matchedAny = false
      for (const ref of binding.referencePaths) {
        if (ref.key !== 'callee' || !ref.parentPath.isCallExpression()) continue
        const call = ref.parentPath
        if (!call.parentPath.isExpressionStatement()) continue
        if (call.node.arguments.some((arg) => t.isSpreadElement(arg))) continue

        const statements = call.node.arguments.map((arg) =>
          t.expressionStatement(arg),
        )
        call.parentPath.replaceWithMultiple(statements)
        matchedAny = true
      }

      if (matchedAny) {
        cleanupCandidates.add(name)
      }
    },
  }
}
