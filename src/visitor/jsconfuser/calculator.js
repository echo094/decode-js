import * as t from '@babel/types'

import safeFunc from '../../utility/safe-func.js'
import bindingDef from '../../utility/binding-def.js'
const safeDeleteNode = safeFunc.safeDeleteNode
const resolveBindingFunction = bindingDef.resolveBindingFunction

const allowedOperators = new Set(['+', '-', '*', '/'])

/**
 * Matches the dispatch function Calculator generates (transforms/calculator.ts):
 * `function name(operator, a, b) { switch (operator) { case "key": return a OP b } }`
 * - one function per Program, one case per distinct operator actually used.
 * Params are matched positionally, not by literal name ("operator"/"a"/"b" are only
 * the encoder's own source names - RenameVariables mangles them before a decoder ever
 * sees the output). Returns the key -> operator map; the map alone is enough to
 * rewrite every call site.
 */
function matchCalculatorSwitch(fnPath) {
  const params = fnPath.node.params
  if (params.length !== 3 || !params.every((p) => t.isIdentifier(p)))
    return null
  const [operatorParam, leftParam, rightParam] = params.map((p) => p.name)

  const body = fnPath.node.body.body
  if (body.length !== 1 || !t.isSwitchStatement(body[0])) return null
  const switchStmt = body[0]
  if (
    !t.isIdentifier(switchStmt.discriminant) ||
    switchStmt.discriminant.name !== operatorParam
  ) {
    return null
  }
  if (switchStmt.cases.length === 0) return null

  const map = new Map()
  for (const switchCase of switchStmt.cases) {
    if (!t.isStringLiteral(switchCase.test)) return null
    if (switchCase.consequent.length !== 1) return null
    const stmt = switchCase.consequent[0]
    if (!t.isReturnStatement(stmt) || !t.isBinaryExpression(stmt.argument)) {
      return null
    }
    const expr = stmt.argument
    if (
      !allowedOperators.has(expr.operator) ||
      !t.isIdentifier(expr.left) ||
      expr.left.name !== leftParam ||
      !t.isIdentifier(expr.right) ||
      expr.right.name !== rightParam
    ) {
      return null
    }
    map.set(switchCase.test.value, expr.operator)
  }

  return map
}

/**
 * The name the dispatch function is held under, in any of the three spellings it arrives in:
 * its own `FunctionDeclaration` id, the `var f = function …` declarator it initializes, or
 * the `f = function …` assignment left when the declaration and its value were emitted
 * separately. The last is the common one on a `high` sample and is *ours* - see the visitor
 * below.
 */
function readHolderName(fnPath) {
  if (fnPath.isFunctionDeclaration()) {
    return fnPath.node.id?.name ?? null
  }
  const parent = fnPath.parentPath
  if (parent.isAssignmentExpression({ operator: '=' })) {
    return t.isIdentifier(parent.node.left) ? parent.node.left.name : null
  }
  if (parent.isVariableDeclarator()) {
    return t.isIdentifier(parent.node.id) ? parent.node.id.name : null
  }
  return null
}

/**
 * Fresh closure state per call. Call-site rewriting happens immediately per match
 * (back to a plain BinaryExpression - both operands are numeric literals by the
 * encoder's own construction, so the already-existing, generic
 * calculate-constant-exp.js folds it the rest of the way in a later pass, no new
 * arithmetic logic needed here); deleting the now-unreferenced dispatch function is
 * deferred to Program exit, same pattern as every other cleanup in this codebase.
 * Always Program-level (`prependProgram`, not per-block), so no scope capture at
 * match time is needed.
 */
export default function deCalculatorInit() {
  const cleanupCandidates = []

  return {
    Program: {
      exit(path) {
        path.scope.crawl()
        for (const fnName of cleanupCandidates) {
          const binding = path.scope.getBinding(fnName)
          if (binding && resolveBindingFunction(binding)) {
            safeDeleteNode(fnName, binding.path)
          }
        }
      },
    },

    // Every function, not only declarations. The encoder emits this dispatch function as a
    // `FunctionDeclaration`, but ControlFlowFlattening swallows it and the CFF decode hands
    // it back as a merged hoisted `var f, …;` plus a separate `f = function (…) {…}`.
    // Keyed on `FunctionDeclaration` this visitor did not decline
    // on that spelling - it never ran at all, leaving the whole Calculator layer standing
    // with live `f("key", 1, 2)` call sites. Same defect, same fix, as global-concealing.js.
    'FunctionDeclaration|FunctionExpression'(fnPath) {
      const map = matchCalculatorSwitch(fnPath)
      if (!map) return
      const fnName = readHolderName(fnPath)
      if (!fnName) return

      // fnPath.scope is the function's own scope (it includes its params), so a
      // lookup from there can resolve to a same-named *param* instead of the
      // holder's own binding when RenameVariables coincidentally assigns the
      // function and one of its params the same name - the holder's binding always
      // lives one scope out, in whichever block actually contains it.
      const binding = fnPath.scope.parent.getBinding(fnName)
      if (!binding) return

      // The name has to resolve back to *this* function, whatever spelling holds it.
      // `resolveBindingFunction` is fail-closed on a binding written more than once, which
      // is the property that matters: a re-assigned holder means the call sites below are
      // not all reading the dispatch function this match was built from.
      if (resolveBindingFunction(binding)?.node !== fnPath.node) return

      // Keyed on the node, not the path: a crawl records a reference per path it reaches,
      // and this decoder's own synthesizing passes can leave one identifier node reachable
      // at two positions. Replacing the second occurrence would operate on a parent whose
      // callee slot the first replacement already rewrote - a crash, not a declined match.
      // global-concealing.js carries the same guard for the same reason.
      const rewritten = new Set()
      for (const ref of binding.referencePaths) {
        if (ref.key !== 'callee' || !ref.parentPath.isCallExpression()) continue
        if (rewritten.has(ref.node)) continue
        const call = ref.parentPath
        const args = call.node.arguments
        if (args.length !== 3 || !t.isStringLiteral(args[0])) continue
        const operator = map.get(args[0].value)
        if (operator === undefined) continue
        rewritten.add(ref.node)
        call.replaceWith(t.binaryExpression(operator, args[1], args[2]))
      }

      cleanupCandidates.push(fnName)
    },
  }
}
