import * as t from '@babel/types'

import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode

/**
 * Matches SELF.PROP, the per-function hash cache slot lock/integrity.ts stores its
 * memoized hash on (`${selfName}.${selfCacheProperty}`) - always a plain, non-computed
 * member access on the wrapper's own name.
 */
function isSelfCacheMember(node, selfName) {
  return (
    t.isMemberExpression(node) &&
    !node.computed &&
    t.isIdentifier(node.object) &&
    node.object.name === selfName &&
    t.isIdentifier(node.property)
  )
}

/**
 * Matches the two-statement body Integrity leaves at a hashed function's original
 * position (see transforms/lock/integrity.ts):
 *
 *   function self() {
 *     var h = self.cache || (self.cache = hashFn(newFn, seed));
 *     if (h === EXPECTED_HASH) {
 *       return newFn(...arguments);
 *     } else {
 *       {countermeasures}
 *     }
 *   }
 *
 * `newFn` (elsewhere in Program scope) still holds the untouched original params and
 * body - lock.ts built it from `self`'s pre-Integrity node before overwriting `self`
 * itself, so nothing here needs to reconstruct params/body, only relocate them.
 * Structural only, no identifier-name assumptions.
 */
function matchIntegrityWrapper(fnPath) {
  const node = fnPath.node
  if (!t.isIdentifier(node.id)) return null
  const selfName = node.id.name

  const body = node.body.body
  if (body.length !== 2) return null
  const [varDecl, ifStmt] = body

  if (!t.isVariableDeclaration(varDecl) || varDecl.declarations.length !== 1) {
    return null
  }
  const declarator = varDecl.declarations[0]
  if (!t.isIdentifier(declarator.id)) return null
  const hashVarName = declarator.id.name

  const init = declarator.init
  if (!t.isLogicalExpression(init) || init.operator !== '||') return null
  if (!isSelfCacheMember(init.left, selfName)) return null
  if (!t.isAssignmentExpression(init.right) || init.right.operator !== '=') {
    return null
  }
  if (!isSelfCacheMember(init.right.left, selfName)) return null

  const call = init.right.right
  if (
    !t.isCallExpression(call) ||
    !t.isIdentifier(call.callee) ||
    call.arguments.length !== 2 ||
    !t.isIdentifier(call.arguments[0])
  ) {
    return null
  }
  const newFnName = call.arguments[0].name
  const hashFnName = call.callee.name

  if (!t.isIfStatement(ifStmt) || !ifStmt.alternate) return null
  const test = ifStmt.test
  if (
    !t.isBinaryExpression(test) ||
    test.operator !== '===' ||
    !t.isIdentifier(test.left) ||
    test.left.name !== hashVarName
  ) {
    return null
  }
  if (
    !t.isBlockStatement(ifStmt.consequent) ||
    ifStmt.consequent.body.length !== 1
  ) {
    return null
  }
  const retStmt = ifStmt.consequent.body[0]
  if (!t.isReturnStatement(retStmt) || !t.isCallExpression(retStmt.argument)) {
    return null
  }
  const retCall = retStmt.argument
  if (
    !t.isIdentifier(retCall.callee) ||
    retCall.callee.name !== newFnName ||
    retCall.arguments.length !== 1 ||
    !t.isSpreadElement(retCall.arguments[0]) ||
    !t.isIdentifier(retCall.arguments[0].argument) ||
    retCall.arguments[0].argument.name !== 'arguments'
  ) {
    return null
  }
  if (!t.isBlockStatement(ifStmt.alternate)) return null

  return { newFnName, hashFnName }
}

/**
 * Fresh closure state per call - hashFnNames collected while relocating each hashed
 * function are only safe to clean up once every match in the Program has been
 * resolved (several hashed functions typically share one hash utility).
 */
export default function deIntegrityInit() {
  const hashFnNames = new Set()

  return {
    Program: {
      exit(path) {
        path.scope.crawl()

        // HashTemplate (integrityTemplate.ts) is a small chain of top-level
        // helpers - the wrapper hash fn calls a low-level cyrb53 fn, which itself
        // calls an `imul` var (Math.imul or a polyfill fn). Deleting only the
        // wrapper leaves the rest orphaned, so once a candidate is actually
        // removed, its own top-level references become new candidates too.
        const queue = [...hashFnNames]
        const queued = new Set(queue)
        while (queue.length) {
          const name = queue.shift()
          const binding = path.scope.getBinding(name)
          if (!binding) continue
          const declPath = binding.path
          if (
            !declPath.isFunctionDeclaration() &&
            !declPath.isVariableDeclarator()
          ) {
            continue
          }

          const refs = new Set()
          declPath.traverse({
            Identifier(refPath) {
              if (!refPath.isReferencedIdentifier()) return
              const refBinding = refPath.scope.getBinding(refPath.node.name)
              if (refBinding && refBinding.scope.path.isProgram()) {
                refs.add(refPath.node.name)
              }
            },
          })

          if (!safeDeleteNode(name, declPath)) continue
          for (const ref of refs) {
            if (!queued.has(ref)) {
              queued.add(ref)
              queue.push(ref)
            }
          }
        }
      },
    },

    FunctionDeclaration(fnPath) {
      const wrapper = matchIntegrityWrapper(fnPath)
      if (!wrapper) return

      const newBinding = fnPath.scope.getBinding(wrapper.newFnName)
      if (!newBinding || !newBinding.path.isFunctionDeclaration()) return
      const newFnPath = newBinding.path

      hashFnNames.add(wrapper.hashFnName)

      // Clone rather than reuse: newFnPath still owns these nodes until it's
      // deleted below, so leaving fnPath's new body aliasing the same node object
      // makes it reachable via two paths at once, double-counting references on a
      // later scope crawl (see flatten.js's identical pitfall).
      fnPath.node.params = newFnPath.node.params.map((n) =>
        t.cloneNode(n, true),
      )
      fnPath.node.body = t.cloneNode(newFnPath.node.body, true)

      safeDeleteNode(wrapper.newFnName, newFnPath)
      fnPath.scope.getProgramParent().crawl()
    },
  }
}
