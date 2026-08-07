import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'

import decodeJsconfuser from '../../plugin/jsconfuser.js'
import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode

/**
 * Matches the eval-wrapper RGF generates (transforms/rgf.ts):
 * `function X(code) { if (integrityVar) { return eval(code); } }` - the
 * integrity check is a real variable read either way (a no-op function call
 * result when lock.tamperProtection is off, a genuine tamper check when it's
 * on), never inlined by constant folding since it's a function-call result,
 * not a literal expression. Returns the integrity variable's name (needed for
 * cleanup, irrelevant to decoding - we never execute anything).
 */
function matchEvalWrapper(fnPath) {
  const node = fnPath.node
  if (node.params.length !== 1 || !t.isIdentifier(node.params[0])) return null
  const codeParamName = node.params[0].name

  const body = node.body.body
  if (body.length !== 1 || !t.isIfStatement(body[0])) return null
  const ifStmt = body[0]
  if (ifStmt.alternate) return null
  if (!t.isIdentifier(ifStmt.test)) return null
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
  const call = retStmt.argument
  if (
    !t.isIdentifier(call.callee) ||
    call.callee.name !== 'eval' ||
    call.arguments.length !== 1 ||
    !t.isIdentifier(call.arguments[0]) ||
    call.arguments[0].name !== codeParamName
  ) {
    return null
  }

  return { integrityVarName: ifStmt.test.name }
}

/**
 * Matches the Program-level `var Z = [ X("code1"), X("code2"), ... ]` RGF
 * collects every transformed function's serialized sub-program into - one
 * shared array, one shared eval-wrapper callee across every element.
 */
function matchRgfArray(declaratorPath) {
  const node = declaratorPath.node
  if (!t.isIdentifier(node.id) || !t.isArrayExpression(node.init)) return null
  const elements = node.init.elements
  if (elements.length === 0) return null

  let wrapperName = null
  const codes = []
  for (const el of elements) {
    if (!t.isCallExpression(el) || !t.isIdentifier(el.callee)) return null
    if (el.arguments.length !== 1 || !t.isStringLiteral(el.arguments[0])) {
      return null
    }
    if (wrapperName === null) {
      wrapperName = el.callee.name
    } else if (el.callee.name !== wrapperName) {
      return null
    }
    codes.push(el.arguments[0].value)
  }

  return { arrayName: node.id.name, wrapperName, codes }
}

/**
 * Matches a transformed function's shrunken body: `return
 * Z[N]["apply"](this, [Z, arguments]);` (both member accesses are computed -
 * see rgf.ts's `t.memberExpression(..., true)` calls, including the bracketed
 * `["apply"]`).
 */
function matchRgfCallSite(fnPath, arrayName) {
  const body = fnPath.node.body.body
  if (body.length !== 1 || !t.isReturnStatement(body[0])) return null
  const arg = body[0].argument
  if (!t.isCallExpression(arg)) return null

  const callee = arg.callee
  if (!isPropertyAccess(callee, 'apply')) return null

  const arrAccess = callee.object
  if (!t.isMemberExpression(arrAccess) || !arrAccess.computed) return null
  if (
    !t.isIdentifier(arrAccess.object) ||
    arrAccess.object.name !== arrayName
  ) {
    return null
  }
  if (!t.isNumericLiteral(arrAccess.property)) return null

  const callArgs = arg.arguments
  if (callArgs.length !== 2 || !t.isThisExpression(callArgs[0])) return null
  if (!t.isArrayExpression(callArgs[1]) || callArgs[1].elements.length !== 2) {
    return null
  }
  const [arrRef, argsRef] = callArgs[1].elements
  if (!t.isIdentifier(arrRef) || arrRef.name !== arrayName) return null
  if (!t.isIdentifier(argsRef) || argsRef.name !== 'arguments') return null

  return { index: arrAccess.property.value }
}

/**
 * Matches `member.propName` regardless of whether js-confuser's Preparation
 * pass normalized it to computed bracket-string form (`member["propName"]`) -
 * Preparation runs unconditionally, including on RGF's own recursively
 * obfuscated sub-program, and only Minify (order 28, not always enabled)
 * converts it back to dot form afterward.
 */
function isPropertyAccess(node, propName) {
  if (!t.isMemberExpression(node)) return false
  if (node.computed) {
    return t.isStringLiteral(node.property) && node.property.value === propName
  }
  return t.isIdentifier(node.property) && node.property.name === propName
}

/**
 * Extracts the real params/body out of a decoded sub-program (see rgf.ts):
 * `function embed(){ var [arr, args] = arguments; function repl(origParams){
 * origBody } return repl.apply(this, args); } embed;`. The sub-program was
 * recursively obfuscated by (almost) the whole pipeline before being
 * serialized, so `decodeJsconfuser` has already reversed everything inside it
 * (including a nested Flatten wrapper, if the same function was also
 * Flatten-eligible before RGF ran) - this only needs to find the wrapper
 * shape and pull `repl`'s params/body back out, not undo anything itself.
 * Matches by cross-reference (the destructured array/args names, `repl`'s own
 * name) rather than fixed statement order, since later encode-side passes on
 * the sub-program aren't skip-protected here either.
 */
function extractReplacementFn(subAst) {
  let result = null

  traverse(subAst, {
    Program(progPath) {
      for (const stmt of progPath.get('body')) {
        if (!stmt.isFunctionDeclaration()) continue
        const embed = stmt.node
        if (embed.params.length !== 0) continue

        const stmts = embed.body.body
        let argsName = null
        let replFn = null

        for (const s of stmts) {
          if (
            t.isVariableDeclaration(s) &&
            s.declarations.length === 1 &&
            t.isArrayPattern(s.declarations[0].id) &&
            s.declarations[0].id.elements.length === 2 &&
            t.isIdentifier(s.declarations[0].init) &&
            s.declarations[0].init.name === 'arguments'
          ) {
            argsName = s.declarations[0].id.elements[1]?.name
          } else if (t.isFunctionDeclaration(s)) {
            replFn = s
          }
        }

        if (!replFn || !argsName || !replFn.id) continue
        const replName = replFn.id.name

        const hasReturnApply = stmts.some(
          (s) =>
            t.isReturnStatement(s) &&
            t.isCallExpression(s.argument) &&
            isPropertyAccess(s.argument.callee, 'apply') &&
            t.isIdentifier(s.argument.callee.object) &&
            s.argument.callee.object.name === replName &&
            s.argument.arguments.length === 2 &&
            t.isThisExpression(s.argument.arguments[0]) &&
            t.isIdentifier(s.argument.arguments[1]) &&
            s.argument.arguments[1].name === argsName,
        )
        if (!hasReturnApply) continue

        result = { params: replFn.params, body: replFn.body }
        progPath.stop()
        return
      }
    },
  })

  return result
}

export default {
  Program(programPath) {
    let matched = null

    for (const stmt of programPath.get('body')) {
      if (!stmt.isVariableDeclaration()) continue
      for (const decl of stmt.get('declarations')) {
        const arrayMatch = matchRgfArray(decl)
        if (!arrayMatch) continue

        const wrapperBinding = programPath.scope.getBinding(
          arrayMatch.wrapperName,
        )
        if (!wrapperBinding || !wrapperBinding.path.isFunctionDeclaration())
          continue
        const wrapperMatch = matchEvalWrapper(wrapperBinding.path)
        if (!wrapperMatch) continue

        matched = {
          declPath: decl,
          wrapperPath: wrapperBinding.path,
          ...arrayMatch,
          ...wrapperMatch,
        }
        break
      }
      if (matched) break
    }

    if (!matched) return

    const decodedFns = matched.codes.map((code) => {
      const decodedCode = decodeJsconfuser(code)
      if (!decodedCode) return null
      let subAst
      try {
        subAst = parse(decodedCode, { errorRecovery: true })
      } catch {
        return null
      }
      return extractReplacementFn(subAst)
    })

    programPath.traverse({
      'FunctionDeclaration|FunctionExpression'(fnPath) {
        const callSite = matchRgfCallSite(fnPath, matched.arrayName)
        if (!callSite) return
        const decoded = decodedFns[callSite.index]
        if (!decoded) return

        fnPath.node.params = decoded.params
        fnPath.node.body = decoded.body
      },
    })

    programPath.scope.crawl()
    if (safeDeleteNode(matched.arrayName, matched.declPath)) {
      safeDeleteNode(matched.wrapperName, matched.wrapperPath)
    }

    const integrityBinding = programPath.scope.getBinding(
      matched.integrityVarName,
    )
    if (integrityBinding && integrityBinding.path.isVariableDeclarator()) {
      const init = integrityBinding.path.node.init
      const integrityFnName =
        t.isCallExpression(init) && t.isIdentifier(init.callee)
          ? init.callee.name
          : null
      if (
        safeDeleteNode(matched.integrityVarName, integrityBinding.path) &&
        integrityFnName
      ) {
        const fnBinding = programPath.scope.getBinding(integrityFnName)
        if (fnBinding && fnBinding.path.isFunctionDeclaration()) {
          safeDeleteNode(integrityFnName, fnBinding.path)
        }
      }
    }
  },
}
