import * as t from '@babel/types'

import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode

/**
 * Matches the `test` closure from the selfDefending template (transforms/lock/lock.ts):
 *   function(){
 *     const regExp = new RegExp('\n');
 *     return regExp['test'](namedFunction)
 *   }
 * `namedFnName` is the enclosing closure's own name, referenced here by identity.
 */
function matchSelfDefendingTestFn(fnExpr, namedFnName) {
  if (!t.isFunctionExpression(fnExpr) || fnExpr.params.length !== 0)
    return false
  const body = fnExpr.body.body
  if (body.length !== 2) return false
  const [varDecl, retStmt] = body

  if (!t.isVariableDeclaration(varDecl) || varDecl.declarations.length !== 1) {
    return false
  }
  const declarator = varDecl.declarations[0]
  if (!t.isIdentifier(declarator.id)) return false
  const init = declarator.init
  if (
    !t.isNewExpression(init) ||
    !t.isIdentifier(init.callee) ||
    init.callee.name !== 'RegExp' ||
    init.arguments.length !== 1 ||
    !t.isStringLiteral(init.arguments[0]) ||
    init.arguments[0].value !== '\n'
  ) {
    return false
  }

  if (!t.isReturnStatement(retStmt) || !t.isCallExpression(retStmt.argument)) {
    return false
  }
  const call = retStmt.argument
  return (
    t.isMemberExpression(call.callee) &&
    call.callee.computed &&
    t.isIdentifier(call.callee.object) &&
    call.callee.object.name === declarator.id.name &&
    t.isStringLiteral(call.callee.property) &&
    call.callee.property.value === 'test' &&
    call.arguments.length === 1 &&
    t.isIdentifier(call.arguments[0]) &&
    call.arguments[0].name === namedFnName
  )
}

/**
 * Matches the full selfDefending IIFE lock.ts inserts (see `lock.options.selfDefending`
 * in transforms/lock/lock.ts):
 *
 *   (function(){
 *     var namedFunction = function(){
 *       const test = function(){ ... };
 *       if (test()) { {countermeasures} }
 *     }
 *     return namedFunction();
 *   })();
 *
 * Breaks any formatter/minifier that would reflow the `test` closure's source (the
 * `\n` check trips) - purely a tripwire, carries no other runtime effect. Structural
 * only; `{countermeasures}` (the if-body) isn't matched further since the whole
 * statement is deleted regardless of what it contains.
 */
function matchSelfDefendingIIFE(callExpr) {
  const outerFn = callExpr.callee
  if (
    !t.isFunctionExpression(outerFn) ||
    outerFn.params.length !== 0 ||
    callExpr.arguments.length !== 0
  ) {
    return false
  }

  const outerBody = outerFn.body.body
  if (outerBody.length !== 2) return false
  const [namedFnDecl, outerRet] = outerBody

  if (
    !t.isVariableDeclaration(namedFnDecl) ||
    namedFnDecl.declarations.length !== 1
  ) {
    return false
  }
  const namedFnDeclarator = namedFnDecl.declarations[0]
  if (!t.isIdentifier(namedFnDeclarator.id)) return false
  const namedFnName = namedFnDeclarator.id.name

  if (
    !t.isReturnStatement(outerRet) ||
    !t.isCallExpression(outerRet.argument)
  ) {
    return false
  }
  const outerCall = outerRet.argument
  if (
    !t.isIdentifier(outerCall.callee) ||
    outerCall.callee.name !== namedFnName ||
    outerCall.arguments.length !== 0
  ) {
    return false
  }

  const namedFnExpr = namedFnDeclarator.init
  if (!t.isFunctionExpression(namedFnExpr) || namedFnExpr.params.length !== 0) {
    return false
  }
  const namedBody = namedFnExpr.body.body
  if (namedBody.length !== 2) return false
  const [testDecl, ifStmt] = namedBody

  if (
    !t.isVariableDeclaration(testDecl) ||
    testDecl.declarations.length !== 1
  ) {
    return false
  }
  const testDeclarator = testDecl.declarations[0]
  if (!t.isIdentifier(testDeclarator.id)) return false
  const testFnName = testDeclarator.id.name

  if (!matchSelfDefendingTestFn(testDeclarator.init, namedFnName)) return false

  return (
    t.isIfStatement(ifStmt) &&
    !ifStmt.alternate &&
    t.isCallExpression(ifStmt.test) &&
    t.isIdentifier(ifStmt.test.callee) &&
    ifStmt.test.callee.name === testFnName &&
    ifStmt.test.arguments.length === 0 &&
    t.isBlockStatement(ifStmt.consequent)
  )
}

/**
 * Matches the invokeCountermeasures wrapper lock.ts prepends to Program when
 * `lock.countermeasures` names a user function (so repeated triggers only call it
 * once):
 *
 *   var hasInvoked = false;
 *   function invokeCountermeasures(){
 *     if (hasInvoked) return;
 *     hasInvoked = true;
 *     userCountermeasuresFn();
 *   }
 *
 * Returns the `hasInvoked` variable's binding so the caller can remove both once
 * `invokeCountermeasures` itself is confirmed unreferenced - never touches the user's
 * own countermeasures function.
 */
function matchInvokeCountermeasures(fnPath) {
  const node = fnPath.node
  if (node.params.length !== 0) return null

  const body = node.body.body
  if (body.length !== 3) return null
  const [ifStmt, assignStmt, callStmt] = body

  if (
    !t.isIfStatement(ifStmt) ||
    ifStmt.alternate ||
    !t.isIdentifier(ifStmt.test) ||
    !t.isReturnStatement(ifStmt.consequent) ||
    ifStmt.consequent.argument
  ) {
    return null
  }
  const hasInvokedName = ifStmt.test.name

  if (
    !t.isExpressionStatement(assignStmt) ||
    !t.isAssignmentExpression(assignStmt.expression) ||
    assignStmt.expression.operator !== '=' ||
    !t.isIdentifier(assignStmt.expression.left) ||
    assignStmt.expression.left.name !== hasInvokedName ||
    !t.isBooleanLiteral(assignStmt.expression.right) ||
    assignStmt.expression.right.value !== true
  ) {
    return null
  }

  if (
    !t.isExpressionStatement(callStmt) ||
    !t.isCallExpression(callStmt.expression) ||
    !t.isIdentifier(callStmt.expression.callee) ||
    callStmt.expression.arguments.length !== 0
  ) {
    return null
  }

  const hasInvokedBinding = fnPath.scope.getBinding(hasInvokedName)
  if (!hasInvokedBinding || !hasInvokedBinding.path.isVariableDeclarator()) {
    return null
  }
  const hasInvokedInit = hasInvokedBinding.path.node.init
  if (!t.isBooleanLiteral(hasInvokedInit) || hasInvokedInit.value !== false) {
    return null
  }

  return { hasInvokedName }
}

/**
 * Matches `Date.now()` - one of the two randomly-chosen date-read expressions the
 * startDate/endDate customLock templates use (transforms/lock/lock.ts).
 */
function isDateNowCall(node) {
  return (
    t.isCallExpression(node) &&
    node.arguments.length === 0 &&
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.object) &&
    node.callee.object.name === 'Date' &&
    t.isIdentifier(node.callee.property) &&
    node.callee.property.name === 'now'
  )
}

/**
 * Matches `(new Date()).getTime()` - the other randomly-chosen date-read expression.
 */
function isNewDateGetTimeCall(node) {
  return (
    t.isCallExpression(node) &&
    node.arguments.length === 0 &&
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.property) &&
    node.callee.property.name === 'getTime' &&
    t.isNewExpression(node.callee.object) &&
    t.isIdentifier(node.callee.object.callee) &&
    node.callee.object.callee.name === 'Date' &&
    node.callee.object.arguments.length === 0
  )
}

/**
 * Matches the startDate/endDate customLock guard (transforms/lock/lock.ts):
 *   if (Date.now() < TIMESTAMP) { {countermeasures} }
 *   if ((new Date()).getTime() > TIMESTAMP) { {countermeasures} }
 * (`<` for startDate, `>` for endDate). The right-hand side isn't required to be a
 * literal - by the time this runs, Calculator/StringConcealing decoding has already
 * simplified it back to one if the sample ever mangled it, but the guard's own shape
 * is unambiguous either way. The if-body isn't matched further - discarded wholesale
 * with the rest of the statement, same as selfDefending's.
 */
function matchDateLockGuard(ifNode) {
  if (ifNode.alternate || !t.isBlockStatement(ifNode.consequent)) return false
  const test = ifNode.test
  if (!t.isBinaryExpression(test)) return false
  if (test.operator !== '<' && test.operator !== '>') return false
  return isDateNowCall(test.left) || isNewDateGetTimeCall(test.left)
}

/**
 * Matches `window.location.href` - the fixed target domainLock's regex tests against
 * (transforms/lock/lock.ts, always this literal chain regardless of `target`).
 */
function isWindowLocationHref(node) {
  return (
    t.isMemberExpression(node) &&
    !node.computed &&
    t.isIdentifier(node.property) &&
    node.property.name === 'href' &&
    t.isMemberExpression(node.object) &&
    !node.object.computed &&
    t.isIdentifier(node.object.property) &&
    node.object.property.name === 'location' &&
    t.isIdentifier(node.object.object) &&
    node.object.object.name === 'window'
  )
}

/**
 * Matches the domainLock customLock guard (transforms/lock/lock.ts):
 *   if (!new RegExp(REGEX).test(window.location.href)) { {countermeasures} }
 * One such guard is inserted per configured regex. `REGEX` isn't required to be a
 * literal for the same reason as dateLock's timestamp above.
 */
function matchDomainLockGuard(ifNode) {
  if (ifNode.alternate || !t.isBlockStatement(ifNode.consequent)) return false
  const test = ifNode.test
  if (!t.isUnaryExpression(test) || test.operator !== '!' || !test.prefix) {
    return false
  }
  const call = test.argument
  if (
    !t.isCallExpression(call) ||
    call.arguments.length !== 1 ||
    !t.isMemberExpression(call.callee) ||
    call.callee.computed ||
    !t.isIdentifier(call.callee.property) ||
    call.callee.property.name !== 'test'
  ) {
    return false
  }
  const regexExpr = call.callee.object
  if (
    !t.isNewExpression(regexExpr) ||
    !t.isIdentifier(regexExpr.callee) ||
    regexExpr.callee.name !== 'RegExp' ||
    regexExpr.arguments.length !== 1
  ) {
    return false
  }
  return isWindowLocationHref(call.arguments[0])
}

/**
 * Matches the `indexOf` helper IndexOfTemplate declares inside NativeFunctionTemplate
 * (templates/tamperProtectionTemplates.ts) - a hand-rolled substring search used
 * instead of the real `String.prototype.indexOf` so the native-code check doesn't
 * itself depend on a hookable builtin. Its own algorithm isn't inspected, only its
 * shape as a 2-param helper - `checkFunction` below references it by identity.
 */
function matchIndexOfHelper(fnPath) {
  return t.isIdentifier(fnPath.node.id) && fnPath.node.params.length === 2
}

/**
 * Matches the `checkFunction` closure NativeFunctionTemplate declares
 * (templates/tamperProtectionTemplates.ts):
 *   function checkFunction(fn) {
 *     if (indexOf(...) === -1 || typeof ...!(fn)...!== "undefined") {
 *       {countermeasures}
 *       return undefined;
 *     }
 *     return fn;
 *   }
 * `indexOfFnName` threads the sibling `indexOf` helper's identity into the left side
 * of the `||` test; the exact literals compared against aren't required to survive
 * (StringConcealing/Calculator have already been decoded by this point in the
 * pipeline, but nothing here depends on it).
 */
function matchCheckFunctionHelper(fnPath, indexOfFnName) {
  const node = fnPath.node
  if (node.params.length !== 1 || !t.isIdentifier(node.params[0])) return false
  const fnParamName = node.params[0].name

  const body = node.body.body
  if (body.length !== 2) return false
  const [ifStmt, finalReturn] = body

  if (
    !t.isReturnStatement(finalReturn) ||
    !t.isIdentifier(finalReturn.argument) ||
    finalReturn.argument.name !== fnParamName
  ) {
    return false
  }

  if (
    !t.isIfStatement(ifStmt) ||
    ifStmt.alternate ||
    !t.isLogicalExpression(ifStmt.test) ||
    ifStmt.test.operator !== '||' ||
    !t.isBlockStatement(ifStmt.consequent)
  ) {
    return false
  }

  const left = ifStmt.test.left
  if (
    !t.isBinaryExpression(left) ||
    left.operator !== '===' ||
    !t.isCallExpression(left.left) ||
    !t.isIdentifier(left.left.callee) ||
    left.left.callee.name !== indexOfFnName ||
    // `-1` parses as `UnaryExpression{-, NumericLiteral(1)}`, not a NumericLiteral
    !t.isUnaryExpression(left.right) ||
    left.right.operator !== '-' ||
    !t.isNumericLiteral(left.right.argument) ||
    left.right.argument.value !== 1
  ) {
    return false
  }

  const right = ifStmt.test.right
  if (
    !t.isBinaryExpression(right) ||
    right.operator !== '!==' ||
    !t.isUnaryExpression(right.left) ||
    right.left.operator !== 'typeof' ||
    !t.isCallExpression(right.left.argument) ||
    !t.isStringLiteral(right.right) ||
    right.right.value !== 'undefined'
  ) {
    return false
  }

  const consequentBody = ifStmt.consequent.body
  if (consequentBody.length === 0) return false
  const lastConsequentStmt = consequentBody[consequentBody.length - 1]
  return (
    t.isReturnStatement(lastConsequentStmt) &&
    t.isIdentifier(lastConsequentStmt.argument) &&
    lastConsequentStmt.argument.name === 'undefined'
  )
}

/**
 * Matches the whole `{nativeFunctionName}()` function NativeFunctionTemplate compiles
 * to (templates/tamperProtectionTemplates.ts) - the tamperProtection native-call
 * guard GlobalConcealing wraps native call sites in:
 *   function {nativeFunctionName}() {
 *     function indexOf(str, substr) { ... }
 *     function checkFunction(fn) { ... }
 *     var args = arguments;
 *     if (args.length === 1) {
 *       return checkFunction(args[0]);
 *     } else if (args.length === 2) {
 *       var object = args[0];
 *       var property = args[1];
 *       var fn = object[property];
 *       fn = checkFunction(fn);
 *       return fn.bind(object);
 *     }
 *   }
 * Run at `FunctionDeclaration: exit`, not enter - this function's own nested blocks
 * (the `if` bodies, `indexOf`'s loop bodies, etc.) are all eligible for an unrelated
 * customLock guard (dateLock/domainLock) to have been unshifted onto them by the
 * encoder's own `Block: exit` visitor, same as any other block in the program. Firing
 * on exit means this decoder's own `IfStatement` matcher has already stripped any such
 * guard from every descendant block by the time this shape is checked, so the
 * comparison below is always against the template's original, guard-free shape.
 */
function matchNativeFunctionCheckFn(fnPath) {
  const node = fnPath.node
  if (node.params.length !== 0) return false

  const body = node.body.body
  if (body.length !== 4) return false
  const [indexOfDecl, checkFunctionDecl, argsDecl, outerIf] = body

  if (
    !t.isFunctionDeclaration(indexOfDecl) ||
    !matchIndexOfHelper({ node: indexOfDecl })
  ) {
    return false
  }
  const indexOfFnName = indexOfDecl.id.name

  if (
    !t.isFunctionDeclaration(checkFunctionDecl) ||
    !t.isIdentifier(checkFunctionDecl.id) ||
    !matchCheckFunctionHelper({ node: checkFunctionDecl }, indexOfFnName)
  ) {
    return false
  }
  const checkFunctionName = checkFunctionDecl.id.name

  if (
    !t.isVariableDeclaration(argsDecl) ||
    argsDecl.declarations.length !== 1 ||
    !t.isIdentifier(argsDecl.declarations[0].id) ||
    !t.isIdentifier(argsDecl.declarations[0].init) ||
    argsDecl.declarations[0].init.name !== 'arguments'
  ) {
    return false
  }
  const argsName = argsDecl.declarations[0].id.name

  const isArgsLengthCheck = (test, count) =>
    t.isBinaryExpression(test) &&
    test.operator === '===' &&
    t.isMemberExpression(test.left) &&
    !test.left.computed &&
    t.isIdentifier(test.left.object) &&
    test.left.object.name === argsName &&
    t.isIdentifier(test.left.property) &&
    test.left.property.name === 'length' &&
    t.isNumericLiteral(test.right) &&
    test.right.value === count

  const isArgsIndex = (node, index) =>
    t.isMemberExpression(node) &&
    node.computed &&
    t.isIdentifier(node.object) &&
    node.object.name === argsName &&
    t.isNumericLiteral(node.property) &&
    node.property.value === index

  if (
    !t.isIfStatement(outerIf) ||
    !isArgsLengthCheck(outerIf.test, 1) ||
    !t.isBlockStatement(outerIf.consequent) ||
    outerIf.consequent.body.length !== 1
  ) {
    return false
  }
  const oneArgReturn = outerIf.consequent.body[0]
  if (
    !t.isReturnStatement(oneArgReturn) ||
    !t.isCallExpression(oneArgReturn.argument) ||
    !t.isIdentifier(oneArgReturn.argument.callee) ||
    oneArgReturn.argument.callee.name !== checkFunctionName ||
    oneArgReturn.argument.arguments.length !== 1 ||
    !isArgsIndex(oneArgReturn.argument.arguments[0], 0)
  ) {
    return false
  }

  const elseIf = outerIf.alternate
  if (
    !t.isIfStatement(elseIf) ||
    elseIf.alternate ||
    !isArgsLengthCheck(elseIf.test, 2) ||
    !t.isBlockStatement(elseIf.consequent) ||
    elseIf.consequent.body.length !== 5
  ) {
    return false
  }
  const [objDecl, propDecl, fnDecl, fnAssign, boundReturn] =
    elseIf.consequent.body

  if (
    !t.isVariableDeclaration(objDecl) ||
    objDecl.declarations.length !== 1 ||
    !t.isIdentifier(objDecl.declarations[0].id) ||
    !isArgsIndex(objDecl.declarations[0].init, 0)
  ) {
    return false
  }
  const objectName = objDecl.declarations[0].id.name

  if (
    !t.isVariableDeclaration(propDecl) ||
    propDecl.declarations.length !== 1 ||
    !t.isIdentifier(propDecl.declarations[0].id) ||
    !isArgsIndex(propDecl.declarations[0].init, 1)
  ) {
    return false
  }
  const propertyName = propDecl.declarations[0].id.name

  if (
    !t.isVariableDeclaration(fnDecl) ||
    fnDecl.declarations.length !== 1 ||
    !t.isIdentifier(fnDecl.declarations[0].id)
  ) {
    return false
  }
  const fnLocalName = fnDecl.declarations[0].id.name
  const fnInit = fnDecl.declarations[0].init
  if (
    !t.isMemberExpression(fnInit) ||
    !fnInit.computed ||
    !t.isIdentifier(fnInit.object) ||
    fnInit.object.name !== objectName ||
    !t.isIdentifier(fnInit.property) ||
    fnInit.property.name !== propertyName
  ) {
    return false
  }

  if (
    !t.isExpressionStatement(fnAssign) ||
    !t.isAssignmentExpression(fnAssign.expression) ||
    fnAssign.expression.operator !== '=' ||
    !t.isIdentifier(fnAssign.expression.left) ||
    fnAssign.expression.left.name !== fnLocalName ||
    !t.isCallExpression(fnAssign.expression.right) ||
    !t.isIdentifier(fnAssign.expression.right.callee) ||
    fnAssign.expression.right.callee.name !== checkFunctionName ||
    fnAssign.expression.right.arguments.length !== 1 ||
    !t.isIdentifier(fnAssign.expression.right.arguments[0]) ||
    fnAssign.expression.right.arguments[0].name !== fnLocalName
  ) {
    return false
  }

  return (
    t.isReturnStatement(boundReturn) &&
    t.isCallExpression(boundReturn.argument) &&
    t.isMemberExpression(boundReturn.argument.callee) &&
    !boundReturn.argument.callee.computed &&
    t.isIdentifier(boundReturn.argument.callee.object) &&
    boundReturn.argument.callee.object.name === fnLocalName &&
    t.isIdentifier(boundReturn.argument.callee.property) &&
    boundReturn.argument.callee.property.name === 'bind' &&
    boundReturn.argument.arguments.length === 1 &&
    t.isIdentifier(boundReturn.argument.arguments[0]) &&
    boundReturn.argument.arguments[0].name === objectName
  )
}

/**
 * Matches the strict-mode tripwire StrictModeTemplate compiles to
 * (templates/tamperProtectionTemplates.ts), prepended to Program alongside the
 * `{nativeFunctionName}` declaration whenever `lock.tamperProtection` is on:
 *   (function(){
 *     function isStrictMode(){
 *       try { var arr = []; delete arr["length"] }
 *       catch(e) { return true; }
 *       return false;
 *     }
 *     if (isStrictMode()) {
 *       {countermeasures}
 *       {nativeFunctionName} = undefined;
 *     }
 *   })()
 * Tamper Protection requires non-strict mode (local-scope `eval` elsewhere); this
 * tripwire detects strict mode having been re-imposed on the bundle and neuters the
 * native-function check in response. Returns the `{nativeFunctionName}` identifier
 * name so the caller can correlate this statement with the function it targets - the
 * two are otherwise independent top-level statements with no structural link besides
 * that shared name. Run at `ExpressionStatement: exit` for the same interleaved-guard
 * reason as `matchNativeFunctionCheckFn` above.
 */
function matchStrictModeIIFE(callExpr) {
  const outerFn = callExpr.callee
  if (
    !t.isFunctionExpression(outerFn) ||
    outerFn.params.length !== 0 ||
    callExpr.arguments.length !== 0
  ) {
    return null
  }

  const outerBody = outerFn.body.body
  if (outerBody.length !== 2) return null
  const [isStrictModeDecl, ifStmt] = outerBody

  if (
    !t.isFunctionDeclaration(isStrictModeDecl) ||
    !t.isIdentifier(isStrictModeDecl.id) ||
    isStrictModeDecl.params.length !== 0
  ) {
    return null
  }
  const isStrictModeName = isStrictModeDecl.id.name

  const fnBody = isStrictModeDecl.body.body
  if (fnBody.length !== 2) return null
  const [tryStmt, finalReturn] = fnBody

  if (
    !t.isReturnStatement(finalReturn) ||
    !t.isBooleanLiteral(finalReturn.argument) ||
    finalReturn.argument.value !== false
  ) {
    return null
  }

  if (!t.isTryStatement(tryStmt) || tryStmt.finalizer) return null
  const tryBody = tryStmt.block.body
  if (tryBody.length !== 2) return null
  const [arrDecl, deleteStmt] = tryBody

  if (
    !t.isVariableDeclaration(arrDecl) ||
    arrDecl.declarations.length !== 1 ||
    !t.isIdentifier(arrDecl.declarations[0].id) ||
    !t.isArrayExpression(arrDecl.declarations[0].init) ||
    arrDecl.declarations[0].init.elements.length !== 0
  ) {
    return null
  }
  const arrName = arrDecl.declarations[0].id.name

  if (
    !t.isExpressionStatement(deleteStmt) ||
    !t.isUnaryExpression(deleteStmt.expression) ||
    deleteStmt.expression.operator !== 'delete' ||
    !t.isMemberExpression(deleteStmt.expression.argument) ||
    !deleteStmt.expression.argument.computed ||
    !t.isIdentifier(deleteStmt.expression.argument.object) ||
    deleteStmt.expression.argument.object.name !== arrName ||
    !t.isStringLiteral(deleteStmt.expression.argument.property) ||
    deleteStmt.expression.argument.property.value !== 'length'
  ) {
    return null
  }

  const handler = tryStmt.handler
  if (
    !handler ||
    !t.isIdentifier(handler.param) ||
    handler.body.body.length !== 1
  ) {
    return null
  }
  const handlerStmt = handler.body.body[0]
  if (
    !t.isReturnStatement(handlerStmt) ||
    !t.isBooleanLiteral(handlerStmt.argument) ||
    handlerStmt.argument.value !== true
  ) {
    return null
  }

  if (
    !t.isIfStatement(ifStmt) ||
    ifStmt.alternate ||
    !t.isCallExpression(ifStmt.test) ||
    !t.isIdentifier(ifStmt.test.callee) ||
    ifStmt.test.callee.name !== isStrictModeName ||
    ifStmt.test.arguments.length !== 0 ||
    !t.isBlockStatement(ifStmt.consequent)
  ) {
    return null
  }

  const consequentBody = ifStmt.consequent.body
  if (consequentBody.length === 0) return null
  const lastStmt = consequentBody[consequentBody.length - 1]
  if (
    !t.isExpressionStatement(lastStmt) ||
    !t.isAssignmentExpression(lastStmt.expression) ||
    lastStmt.expression.operator !== '=' ||
    !t.isIdentifier(lastStmt.expression.left) ||
    !t.isIdentifier(lastStmt.expression.right) ||
    lastStmt.expression.right.name !== 'undefined'
  ) {
    return null
  }

  return { nativeFnName: lastStmt.expression.left.name }
}

/**
 * Unwraps every `{nativeFunctionName}(...)(...)` call site GlobalConcealing produces
 * when tamperProtection is on (transforms/identifier/globalConcealing.ts) back to the
 * plain call it guards:
 *   {nativeFunctionName}(fn)(...args)              -> fn(...args)
 *   {nativeFunctionName}(obj, "prop")(...args)      -> obj["prop"](...args)
 * (the two-arg form runs `fn.bind(object)` at runtime, which is behaviorally
 * equivalent to calling `obj["prop"](...)` directly - both bind `this` to `obj`).
 * Only call sites where the guard call is itself immediately invoked are touched; a
 * reference used any other way is left alone (and will keep the guard function from
 * being deleted, which is the intended conservative behavior - see the `Program: exit`
 * cleanup below).
 */
function unwrapNativeFunctionCallSites(nativeFnBinding) {
  for (const refPath of nativeFnBinding.referencePaths) {
    if (refPath.key !== 'callee' || !refPath.parentPath.isCallExpression()) {
      continue
    }
    const innerCallPath = refPath.parentPath
    if (
      innerCallPath.key !== 'callee' ||
      !innerCallPath.parentPath.isCallExpression()
    ) {
      continue
    }

    const args = innerCallPath.node.arguments
    if (args.length === 1) {
      innerCallPath.replaceWith(t.cloneNode(args[0], true))
    } else if (args.length === 2) {
      innerCallPath.replaceWith(
        t.memberExpression(
          t.cloneNode(args[0], true),
          t.cloneNode(args[1], true),
          true,
        ),
      )
    }
  }
}

/**
 * Fresh closure state per call. antiDebug (bare `debugger;`), selfDefending,
 * dateLock/domainLock, and tamperProtection's two prepended pieces are all
 * self-contained shapes stripped as soon as they're structurally confirmed - none of
 * them have dependents elsewhere in the program (unlike invokeCountermeasures/
 * tamperProtection's native-function guard, which do and are deferred to `Program:
 * exit`, same reasoning as before: a live reference must be trusted, not assumed
 * stale, and it's only truly dead once every guard that could still call it -
 * including any not yet decoded - has actually been removed).
 */
export default function deLockInit() {
  const invokeCandidates = new Map()
  const nativeFnCandidates = new Map()
  const strictModeCandidates = new Map()

  return {
    Program: {
      exit(path) {
        path.scope.crawl()

        // tamperProtection's own prelude (nativeFunctionCheck's `checkFunction`,
        // the strict-mode IIFE) each carry their own `{countermeasures}` call site,
        // which - when `lock.countermeasures` is configured - is a live reference to
        // invokeCountermeasures below. Removing these two pieces first means that
        // reference is gone before invokeCountermeasures' own cleanup runs;
        // reversing this order leaves invokeCountermeasures permanently undeletable
        // even once every guard that could call it is otherwise gone.
        for (const [nativeFnName, nativeFnPath] of nativeFnCandidates) {
          const strictModePath = strictModeCandidates.get(nativeFnName)
          if (
            !strictModePath ||
            strictModePath.removed ||
            nativeFnPath.removed
          ) {
            continue
          }

          strictModePath.remove()
          path.scope.crawl()

          const nativeFnBinding = path.scope.getBinding(nativeFnName)
          if (
            !nativeFnBinding ||
            nativeFnBinding.path.node !== nativeFnPath.node
          ) {
            continue
          }
          unwrapNativeFunctionCallSites(nativeFnBinding)
          safeDeleteNode(nativeFnName, nativeFnPath)
        }

        path.scope.crawl()
        for (const [invokeFnName, hasInvokedName] of invokeCandidates) {
          const invokeBinding = path.scope.getBinding(invokeFnName)
          if (!invokeBinding || !invokeBinding.path.isFunctionDeclaration()) {
            continue
          }
          const deleted = safeDeleteNode(invokeFnName, invokeBinding.path)
          if (!deleted) continue
          const hasInvokedBinding = path.scope.getBinding(hasInvokedName)
          if (hasInvokedBinding) {
            safeDeleteNode(hasInvokedName, hasInvokedBinding.path)
          }
        }
      },
    },

    DebuggerStatement(path) {
      path.remove()
    },

    IfStatement(path) {
      if (matchDateLockGuard(path.node) || matchDomainLockGuard(path.node)) {
        path.remove()
      }
    },

    ExpressionStatement: {
      exit(path) {
        const expr = path.node.expression
        if (!t.isCallExpression(expr)) return

        if (matchSelfDefendingIIFE(expr)) {
          path.remove()
          return
        }

        const strictMode = matchStrictModeIIFE(expr)
        if (strictMode) {
          strictModeCandidates.set(strictMode.nativeFnName, path)
        }
      },
    },

    FunctionDeclaration: {
      exit(fnPath) {
        if (!t.isIdentifier(fnPath.node.id)) return

        const wrapper = matchInvokeCountermeasures(fnPath)
        if (wrapper) {
          invokeCandidates.set(fnPath.node.id.name, wrapper.hasInvokedName)
          return
        }

        if (matchNativeFunctionCheckFn(fnPath)) {
          nativeFnCandidates.set(fnPath.node.id.name, fnPath)
        }
      },
    },
  }
}
