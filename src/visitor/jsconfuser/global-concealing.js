import * as t from '@babel/types'

import bindingDef from '../../utility/binding-def.js'
const resolveBindingFunction = bindingDef.resolveBindingFunction

import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode

/**
 * Matches the switch function GlobalConcealing generates
 * (transforms/identifier/globalConcealing.ts): every case (real names and decoy
 * padding alike, indistinguishable by shape) is the exact same
 * `case "key": return globalVar["realName"];` - a single return of a computed member
 * access on one shared globalVar identifier, keyed by a random string. Returns the
 * key -> realName map plus globalVar's own name (needed for cleanup, not decoding -
 * the map alone is enough to rewrite every call site).
 */
function matchGlobalConcealingSwitch(fnPath) {
  const node = fnPath.node
  if (node.params.length !== 1 || !t.isIdentifier(node.params[0])) return null
  const paramName = node.params[0].name

  const body = node.body.body
  if (body.length !== 1 || !t.isSwitchStatement(body[0])) return null
  const switchStmt = body[0]
  if (
    !t.isIdentifier(switchStmt.discriminant) ||
    switchStmt.discriminant.name !== paramName
  ) {
    return null
  }
  if (switchStmt.cases.length === 0) return null

  const map = new Map()
  let globalVarName = null
  for (const switchCase of switchStmt.cases) {
    if (!t.isStringLiteral(switchCase.test)) return null
    if (switchCase.consequent.length !== 1) return null
    const stmt = switchCase.consequent[0]
    if (!t.isReturnStatement(stmt) || !t.isMemberExpression(stmt.argument)) {
      return null
    }
    const member = stmt.argument
    if (!t.isIdentifier(member.object)) return null
    // `Minify` (encoder Order 28, later than GlobalConcealing's Order 12) rewrites
    // `globalVar["Math"]` to `globalVar.Math` wherever the key is a valid identifier, so a
    // case can arrive in either spelling and the two mean the same thing. Requiring the
    // computed one cost the *whole* function: this matcher is all-or-nothing, so a single
    // minified case among forty left the entire GlobalConcealing layer undecoded.
    const realName = member.computed
      ? t.isStringLiteral(member.property)
        ? member.property.value
        : null
      : t.isIdentifier(member.property)
        ? member.property.name
        : null
    if (realName === null) return null
    if (globalVarName === null) {
      globalVarName = member.object.name
    } else if (member.object.name !== globalVarName) {
      return null
    }
    map.set(switchCase.test.value, realName)
  }

  return { globalVarName, map }
}

/**
 * Reads the name of the `getGlobalVarFn` sniffer out of `globalVar`'s own initializer, in
 * either spelling. `MovedDeclarations` (encoder Order 25) splits `var globalVar =
 * sniffer()` into a bare declarator plus a `globalVar = sniffer()` assignment elsewhere -
 * Mechanism 1, the same split `control-flow-graph.js`'s `readHarnessSlot` reads for the CFF
 * harness - which leaves `node.init` null. Read from the declarator alone and the sniffer's
 * name is simply unknowable on any sample that stage touched, so it survives every cleanup
 * as a zero-reference orphan of ~30 lines.
 *
 * Only a *single* write qualifies: more than one and there is no one initializer to read.
 * Must be called before `safeDeleteNode` removes those writes.
 */
function readSnifferName(binding) {
  const init = binding.path.node.init
  const call = init
    ? init
    : binding.constantViolations.length === 1 &&
        binding.constantViolations[0].isAssignmentExpression({ operator: '=' })
      ? binding.constantViolations[0].node.right
      : null
  return t.isCallExpression(call) && t.isIdentifier(call.callee)
    ? call.callee.name
    : null
}

/**
 * The name the switch function is held under, in any of the three spellings it arrives in:
 * its own `FunctionDeclaration` id, the `var f = function …` declarator it initializes, or
 * the `f = function …` assignment left when the declaration and its value were emitted
 * separately. The last is the common one on a `high` sample and is *ours* - the CFF decode
 * lifts the encoder's scope-anchor property into a hoisted `var` plus an assignment (see
 * that pass's Upstream Effects) - which is why keying this visitor on `FunctionDeclaration`
 * meant it never fired at all rather than matching and declining.
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
 * Fresh closure state per call. Call-site rewriting happens immediately per match;
 * deleting the switch fn + globalVar declaration + the getGlobalVarFn sniffer it
 * calls is deferred to Program exit and made transitive (same shape as
 * integrity.js's hash-utility cleanup) - the sniffer's own name is only known once
 * globalVar's declaration is found, and globalVar is only provably dead once the
 * switch fn (its one and only referrer) is actually gone.
 */
export default function deGlobalConcealingInit() {
  const cleanupCandidates = new Map()

  return {
    Program: {
      exit(path) {
        path.scope.crawl()
        for (const [globalFnName, globalVarName] of cleanupCandidates) {
          // Same three spellings as the match itself, so the deletion is gated on the
          // binding still defining a function rather than on the declaration form.
          // `safeDeleteNode` removes the single write along with the declarator, which is
          // what takes the `f = function …` half of a split holder with it.
          const fnBinding = path.scope.getBinding(globalFnName)
          if (!fnBinding || !resolveBindingFunction(fnBinding)) continue
          if (!safeDeleteNode(globalFnName, fnBinding.path)) continue

          const varBinding = path.scope.getBinding(globalVarName)
          if (!varBinding || !varBinding.path.isVariableDeclarator()) continue
          const snifferName = readSnifferName(varBinding)
          if (!safeDeleteNode(globalVarName, varBinding.path)) continue

          if (snifferName) {
            // Resolved through the binding, not through the declaration form. The sniffer
            // is a `FunctionDeclaration` as the encoder writes it, but by the time this
            // sweep runs the CFF decode has commonly re-emitted it as a merged hoisted
            // `var s, …;` plus a separate `s = function (…) {…}`. An
            // `isFunctionDeclaration()` gate reads false on
            // that spelling and leaves ~770B of getGlobal scaffolding behind, at zero
            // references, on every sample the flattening decode touched.
            const snifferBinding = path.scope.getBinding(snifferName)
            if (snifferBinding && resolveBindingFunction(snifferBinding)) {
              safeDeleteNode(snifferName, snifferBinding.path)
            }
          }
        }
      },
    },

    'FunctionDeclaration|FunctionExpression'(fnPath) {
      const match = matchGlobalConcealingSwitch(fnPath)
      if (!match) return
      const fnName = readHolderName(fnPath)
      if (!fnName) return

      // fnPath.scope is the switch function's own scope (it includes its one
      // param), so a lookup from there can resolve to a same-named *param*
      // instead of the holder's own binding if RenameVariables ever
      // reuses this function's own new name for its own param - see
      // calculator.js's identical, confirmed-broken pattern (fixed the same way).
      const binding = fnPath.scope.parent.getBinding(fnName)
      if (!binding) return

      // The name has to resolve back to *this* function, whatever spelling holds it.
      // `resolveBindingFunction` is what reads a definition the declaration form hides, and
      // it is fail-closed on a binding written more than once - which is the property that
      // matters here, since a re-assigned holder means the call sites below are not all
      // reading the switch function this match was built from. Comparing node identity
      // rather than trusting the lookup is the same check `string-concealing.js` makes.
      if (resolveBindingFunction(binding)?.node !== fnPath.node) return

      // One reference can be registered twice. A crawl records a reference per *path* it
      // reaches, and this decoder's own synthesizing passes can leave the same identifier
      // node reachable at two positions, so `referencePaths` came back with 50 entries over
      // 49 distinct nodes on a real sample. Replacing the second occurrence is not a no-op:
      // by then the parent's `callee` slot holds the identifier the first replacement put
      // there, so the path resyncs to a null key and Babel's own validator throws - a crash,
      // not a declined match. Keyed on the node rather than the path for that reason. If a
      // node really is shared between two live parents, skipping leaves that site's call
      // standing, and the reference-count-gated cleanup below then correctly declines to
      // delete the switch function: fail-closed, as everywhere else here.
      const rewritten = new Set()

      for (const ref of binding.referencePaths) {
        if (ref.key !== 'callee' || !ref.parentPath.isCallExpression()) continue
        if (rewritten.has(ref.node)) continue
        const call = ref.parentPath
        if (
          call.node.arguments.length !== 1 ||
          !t.isStringLiteral(call.node.arguments[0])
        ) {
          continue
        }
        const realName = match.map.get(call.node.arguments[0].value)
        if (realName === undefined) continue
        rewritten.add(ref.node)
        call.replaceWith(t.identifier(realName))
      }

      cleanupCandidates.set(fnName, match.globalVarName)
    },
  }
}
