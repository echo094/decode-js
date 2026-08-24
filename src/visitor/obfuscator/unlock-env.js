import traverse from '@babel/traverse'
import * as t from '@babel/types'

import logger from '../../utility/logger.js'

const debugLog = logger.debugLog

/**
 * Strip javascript-obfuscator's custom code helpers: the self-defending guard, the console-output
 * disabler, the debug-protection trap, and the calls controller the three of them run through.
 *
 * The encoder injects these at its *second* stage, so by the time anything here sees them they
 * have been through dead-code injection, control-flow flattening, literal re-spelling, renaming
 * and the string array. This pass therefore assumes those have already been reversed: it matches
 * decoded shapes, and it is the last thing in the pipeline rather than the first.
 *
 * Each protection is emitted as two pieces in *different scopes* - a definition and a trigger -
 * plus a per-group calls controller:
 *
 *     var C = (function () {                       // the calls controller, one PER GROUP
 *       var first = true;
 *       return function (context, fn) {
 *         var r = first ? function () { if (fn) { ... } } : function () {};
 *         first = false;
 *         return r;
 *       };
 *     })();
 *
 *     var G = C(this, function () { ... });        // the definition
 *     G();                                         // the trigger
 *
 * Debug protection is the exception: its guard is invoked where it is built, inside an IIFE with
 * no name bound to it, and it additionally emits a top-level `function D(ret) { ... }` and an
 * optional `setInterval` firing it.
 *
 * **Deleting the controller with its guard is only safe because of an encoder property**, not a
 * decoder one: each helper group builds its *own* controller rather than sharing one, so a
 * controller never has a second guard depending on it. This pass verifies that per controller
 * instead of assuming it, and declines when it does not hold - which is what would happen against
 * a variant encoder that shared them.
 *
 * **The console-output guard references its own controller from inside its callback**
 * (`C.constructor.prototype.bind(C)`, `C.bind(C)`). So a liveness test on the controller must not
 * count references that live inside the guard being removed. Here that is explicit: references are
 * partitioned before anything is deleted, rather than relying on deleting the guard first and
 * re-crawling.
 *
 * **Match completely, then mutate.** Every gate is checked before the first removal, so a guard is
 * either taken out whole or left exactly as found. Declining costs legible residue that a census
 * counts; a half-removed guard leaves a program referencing a binding that no longer exists.
 */

/** `function (...) {}` or `(...) => {}`, with a block body. */
function isFnWithBlock(node) {
  return (
    (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) &&
    t.isBlockStatement(node.body)
  )
}

/**
 * A member key in the two spellings that reach this point: `o.k` and `o['k']`.
 *
 * Reading only the first is the trap that makes a matcher accept hand-built cases and reject every
 * real one - our own `Converting` reversal un-computes most keys, but not all of them, so both
 * spellings are live in this pass's input.
 */
function memberKey(node) {
  if (!t.isMemberExpression(node)) return null
  if (!node.computed && t.isIdentifier(node.property)) return node.property.name
  if (node.computed && t.isStringLiteral(node.property))
    return node.property.value
  return null
}

/** A direct interval call, with the global or member-qualified spellings the encoder emits. */
function isSetIntervalCall(path) {
  if (!path || !path.isCallExpression()) return false
  return (
    t.isIdentifier(path.node.callee, { name: 'setInterval' }) ||
    memberKey(path.node.callee) === 'setInterval'
  )
}

/**
 * Count nodes under `node` matching `pred`.
 *
 * A plain walk rather than a Babel traversal: the subjects here are block statements and function
 * bodies, which `traverse` cannot be pointed at without a path or a synthetic program wrapper, and
 * wrapping is what makes such a helper throw on the first node type it cannot convert.
 */
function countNodes(node, pred) {
  let n = 0
  const walk = (x) => {
    if (!x || typeof x.type !== 'string') return
    if (pred(x)) n++
    for (const key of t.VISITOR_KEYS[x.type] || []) {
      const v = x[key]
      if (Array.isArray(v)) v.forEach(walk)
      else walk(v)
    }
  }
  walk(node)
  return n
}

/**
 * The calls controller, matched on shape: an immediately-invoked function taking no arguments,
 * whose body returns a two-parameter function that chooses between two function expressions.
 *
 * Keyed on the choice rather than on the `firstCall` flag, because the flag is a renamed local and
 * the conditional is the part that carries the meaning - the wrapper runs its target once.
 */
function isCallsControllerInit(node) {
  if (
    !t.isCallExpression(node) ||
    node.arguments.length ||
    !isFnWithBlock(node.callee)
  )
    return false
  return (
    countNodes(
      node.callee.body,
      (n) =>
        isFnWithBlock(n) &&
        n.params.length === 2 &&
        countNodes(
          n.body,
          (c) =>
            t.isConditionalExpression(c) &&
            isFnWithBlock(c.consequent) &&
            isFnWithBlock(c.alternate),
        ) > 0,
    ) > 0
  )
}

function bindingFor(path, node) {
  return t.isIdentifier(node) ? path.scope.getBinding(node.name) : null
}

function singleDeclarator(path) {
  return path.isVariableDeclaration() && path.node.declarations.length === 1
    ? path.get('declarations.0')
    : null
}

/**
 * DomainLockTemplate's payload after the global resolver is a stable 22-statement program. The
 * property names are deliberately hidden, so the proof follows declarations and bindings instead:
 * encoded domains, four uninitialized property slots, a matcher plus three argument-permuting
 * wrappers, the discovery loops, suffix comparison, and the final location assignment.
 *
 * This is also a firewall in front of the older `RegExp >= 2` debug-protection heuristic. A
 * domain-like callback that fails any gate is declined, not allowed to fall through and be deleted
 * under the wrong label.
 */
function domainLockClassification(callbackPath) {
  const decline = (stage) => {
    debugLog(`unlock-env: domain-lock proof declined at ${stage}`)
    return { candidate: true, matched: false }
  }
  const body = callbackPath.get('body')
  if (!body.isBlockStatement()) return { candidate: false, matched: false }

  const statements = body.get('body')
  const candidate =
    countNodes(
      body.node,
      (node) =>
        t.isNewExpression(node) &&
        t.isIdentifier(node.callee, { name: 'RegExp' }),
    ) === 2 &&
    countNodes(body.node, (node) => t.isForInStatement(node)) === 4 &&
    [23, 24].includes(statements.length)
  if (!candidate) return { candidate: false, matched: false }

  // The resolver occupies one statement for browser-no-eval and two for both ordinary forms.
  const prefixLength = statements.length - 22
  if (![1, 2].includes(prefixLength)) return decline('resolver-length')
  const payload = statements.slice(prefixLength)
  const expected = [
    'VariableDeclaration',
    'VariableDeclaration',
    'VariableDeclaration',
    'VariableDeclaration',
    'VariableDeclaration',
    'VariableDeclaration',
    'VariableDeclaration',
    'VariableDeclaration',
    'VariableDeclaration',
    'VariableDeclaration',
    'ForInStatement',
    'ForInStatement',
    'ForInStatement',
    'IfStatement',
    'IfStatement',
    'VariableDeclaration',
    'VariableDeclaration',
    'VariableDeclaration',
    'IfStatement',
    'VariableDeclaration',
    'ForStatement',
    'IfStatement',
  ]
  if (!payload.every((path, index) => path.node.type === expected[index])) {
    return decline('statement-skeleton')
  }

  let globalBinding
  if (prefixLength === 1) {
    const holder = singleDeclarator(statements[0])
    if (
      !holder ||
      !t.isIdentifier(holder.node.id) ||
      !isBrowserNoEvalGlobalResolver(holder.node.init)
    ) {
      return decline('browser-no-eval-resolver')
    }
    if (
      ['window', 'process', 'require', 'global'].some((name) =>
        callbackPath.scope.getBinding(name),
      )
    ) {
      return decline('shadowed-browser-no-eval-host')
    }
    globalBinding = callbackPath.scope.getBinding(holder.node.id.name)
  } else {
    const first = singleDeclarator(statements[0])
    const second = statements[1]
    if (!first || !t.isIdentifier(first.node.id))
      return decline('ordinary-resolver-declaration')
    if (second.isTryStatement() && !first.node.init) {
      if (!isInlineDomainResolver(statements.slice(0, 2))) {
        return decline('inline-resolver')
      }
      globalBinding = callbackPath.scope.getBinding(first.node.id.name)
    } else {
      const holder = singleDeclarator(second)
      if (
        !isFnWithBlock(first.node.init) ||
        !holder ||
        !t.isIdentifier(holder.node.id) ||
        !t.isCallExpression(holder.node.init) ||
        !t.isIdentifier(holder.node.init.callee, {
          name: first.node.id.name,
        }) ||
        holder.node.init.arguments.length !== 0 ||
        countNodes(
          first.node.init.body,
          (node) =>
            t.isCallExpression(node) &&
            t.isIdentifier(node.callee, { name: 'Function' }),
        ) !== 1 ||
        countNodes(first.node.init.body, (node) =>
          t.isIdentifier(node, { name: 'window' }),
        ) !== 1
      ) {
        return decline('function-resolver')
      }
      const resolverBinding = callbackPath.scope.getBinding(first.node.id.name)
      if (
        !resolverBinding ||
        resolverBinding.referencePaths.length !== 1 ||
        resolverBinding.referencePaths[0].node !== holder.node.init.callee
      ) {
        return decline('function-resolver-binding')
      }
      globalBinding = callbackPath.scope.getBinding(holder.node.id.name)
    }
  }
  if (!globalBinding) return decline('global-binding')

  const declarations = payload.slice(0, 10).map(singleDeclarator)
  if (declarations.some((path) => !path || !t.isIdentifier(path.node.id))) {
    return decline('payload-declarations')
  }
  const [regex, domains, ...rest] = declarations
  const slots = rest.slice(0, 4)
  const helpers = rest.slice(4)
  if (slots.some((path) => path.node.init !== null))
    return decline('property-slots')

  if (
    !t.isNewExpression(regex.node.init) ||
    !t.isIdentifier(regex.node.init.callee, { name: 'RegExp' }) ||
    regex.node.init.arguments.length !== 2 ||
    !t.isStringLiteral(regex.node.init.arguments[0]) ||
    !t.isStringLiteral(regex.node.init.arguments[1], { value: 'g' }) ||
    callbackPath.scope.getBinding('RegExp')
  ) {
    return decline('domain-regexp')
  }
  const regexBinding = callbackPath.scope.getBinding(regex.node.id.name)
  const domainsBinding = callbackPath.scope.getBinding(domains.node.id.name)
  const split = domains.get('init')
  if (
    !regexBinding ||
    !domainsBinding ||
    !split.isCallExpression() ||
    memberKey(split.node.callee) !== 'split' ||
    split.node.arguments.length !== 1 ||
    !t.isStringLiteral(split.node.arguments[0], { value: ';' })
  ) {
    return decline('domain-split')
  }
  const replace = split.get('callee.object')
  if (
    !replace.isCallExpression() ||
    memberKey(replace.node.callee) !== 'replace' ||
    replace.node.arguments.length !== 2 ||
    bindingFor(replace, replace.node.arguments[0]) !== regexBinding ||
    !t.isStringLiteral(replace.node.arguments[1], { value: '' }) ||
    regexBinding.referencePaths.length !== 1
  ) {
    return decline('domain-replace')
  }

  // The first helper implements the character-position matcher. Each later helper may only call
  // the previous binding, once, with a permutation of its own three parameters.
  if (
    !isFnWithBlock(helpers[0].node.init) ||
    helpers[0].node.init.params.length !== 3 ||
    countNodes(helpers[0].node.init.body, (node) => t.isForStatement(node)) !==
      2 ||
    countNodes(
      helpers[0].node.init.body,
      (node) =>
        t.isCallExpression(node) && memberKey(node.callee) === 'charCodeAt',
    ) !== 1
  ) {
    return decline('property-matcher')
  }
  let previousBinding = callbackPath.scope.getBinding(helpers[0].node.id.name)
  if (!previousBinding) return decline('property-matcher-binding')
  for (const helper of helpers.slice(1)) {
    if (
      !isFnWithBlock(helper.node.init) ||
      helper.node.init.params.length !== 3 ||
      helper.node.init.body.body.length !== 1 ||
      !t.isReturnStatement(helper.node.init.body.body[0]) ||
      !t.isCallExpression(helper.node.init.body.body[0].argument)
    ) {
      return decline('property-wrapper-shape')
    }
    const callPath = helper.get('init.body.body.0.argument')
    const call = callPath.node
    if (
      bindingFor(callPath, call.callee) !== previousBinding ||
      call.arguments.length !== 3
    ) {
      return decline('property-wrapper-call')
    }
    const fnPath = helper.get('init')
    const params = new Set(
      helper.node.init.params.map((param) => bindingFor(fnPath, param)),
    )
    const args = call.arguments.map((arg) => bindingFor(callPath, arg))
    if (
      params.has(null) ||
      new Set(args).size !== 3 ||
      !args.every((arg) => params.has(arg))
    ) {
      return decline('property-wrapper-permutation')
    }
    previousBinding = callbackPath.scope.getBinding(helper.node.id.name)
    if (!previousBinding) return decline('property-wrapper-binding')
  }

  const slotBindings = slots.map((path) =>
    callbackPath.scope.getBinding(path.node.id.name),
  )
  if (
    slotBindings.some((binding) => !binding) ||
    slotBindings
      .map((binding) => binding.constantViolations.length)
      .join(',') !== '1,2,1,1'
  ) {
    return decline('property-slot-bindings')
  }
  if (
    payload
      .slice(10, 13)
      .some(
        (path) =>
          countNodes(path.node, (node) =>
            t.isAssignmentExpression(node, { operator: '=' }),
          ) !== 1,
      )
  ) {
    return decline('property-discovery-loops')
  }

  // Pin the semantic tail as well as its statement skeleton.
  const methodCounts = Object.fromEntries(
    ['replace', 'fromCharCode', 'slice', 'indexOf'].map((key) => [
      key,
      countNodes(
        body.node,
        (node) => t.isCallExpression(node) && memberKey(node.callee) === key,
      ),
    ]),
  )
  if (
    methodCounts.replace !== 2 ||
    methodCounts.fromCharCode !== 1 ||
    methodCounts.slice !== 1 ||
    methodCounts.indexOf !== 2 ||
    countNodes(body.node, (node) => t.isForStatement(node)) !== 3
  ) {
    return decline('semantic-tail')
  }

  const matched = singleDeclarator(payload[19])
  const domainLoop = payload[20]
  if (
    !matched ||
    !t.isBooleanLiteral(matched.node.init, { value: false }) ||
    !domainLoop.get('init').isVariableDeclaration() ||
    domainLoop.node.init.declarations.length !== 1 ||
    !domainLoop.get('body').isBlockStatement() ||
    domainLoop.node.body.body.length < 1
  ) {
    return decline('domain-loop-header')
  }
  const index = domainLoop.get('init.declarations.0')
  if (!t.isIdentifier(index.node.id)) return decline('domain-loop-index')
  const indexBinding = bindingFor(index, index.node.id)
  const test = domainLoop.get('test')
  const update = domainLoop.get('update')
  if (
    !indexBinding ||
    !t.isNumericLiteral(index.node.init, { value: 0 }) ||
    !test.isBinaryExpression({ operator: '<' }) ||
    bindingFor(test, test.node.left) !== indexBinding ||
    !t.isMemberExpression(test.node.right) ||
    memberKey(test.node.right) !== 'length' ||
    bindingFor(test, test.node.right.object) !== domainsBinding ||
    !update.isUpdateExpression({ operator: '++' }) ||
    bindingFor(update, update.node.argument) !== indexBinding
  ) {
    return decline('domain-loop-bindings')
  }
  const domainValue = singleDeclarator(domainLoop.get('body.body.0'))
  if (
    !domainValue ||
    !t.isMemberExpression(domainValue.node.init) ||
    bindingFor(domainValue, domainValue.node.init.object) !== domainsBinding ||
    bindingFor(domainValue, domainValue.node.init.property) !== indexBinding
  ) {
    return decline('domain-loop-value')
  }

  const finalIf = payload[21]
  const matchedBinding = callbackPath.scope.getBinding(matched.node.id.name)
  if (
    !matchedBinding ||
    !finalIf.get('test').isUnaryExpression({ operator: '!' }) ||
    bindingFor(finalIf.get('test'), finalIf.node.test.argument) !==
      matchedBinding ||
    !finalIf.get('consequent').isBlockStatement() ||
    finalIf.node.consequent.body.length !== 3
  ) {
    return decline('redirect-guard')
  }
  const redirectRegex = singleDeclarator(finalIf.get('consequent.body.0'))
  const redirect = singleDeclarator(finalIf.get('consequent.body.1'))
  if (
    !redirectRegex ||
    !redirect ||
    !t.isNewExpression(redirectRegex.node.init) ||
    !t.isIdentifier(redirectRegex.node.init.callee, { name: 'RegExp' }) ||
    !t.isCallExpression(redirect.node.init) ||
    memberKey(redirect.node.init.callee) !== 'replace'
  ) {
    return decline('redirect-builder')
  }
  const redirectRegexBinding = callbackPath.scope.getBinding(
    redirectRegex.node.id.name,
  )
  const redirectBinding = callbackPath.scope.getBinding(redirect.node.id.name)
  if (
    !redirectRegexBinding ||
    !redirectBinding ||
    bindingFor(redirect, redirect.node.init.arguments[0]) !==
      redirectRegexBinding
  ) {
    return decline('redirect-builder-bindings')
  }
  const finalAssignments = []
  finalIf.traverse({
    AssignmentExpression(path) {
      if (path.node.operator === '=') finalAssignments.push(path)
    },
  })
  if (finalAssignments.length !== 1) return decline('redirect-assignment-count')
  const target = finalAssignments[0].get('left')
  if (
    !target.isMemberExpression() ||
    !target.node.computed ||
    !target.get('object').isMemberExpression() ||
    !target.get('object').node.computed ||
    bindingFor(target, target.node.object.object) !== globalBinding ||
    bindingFor(target, target.node.object.property) !== slotBindings[0] ||
    bindingFor(target, target.node.property) !== slotBindings[2] ||
    bindingFor(finalAssignments[0], finalAssignments[0].node.right) !==
      redirectBinding
  ) {
    return decline('redirect-target-bindings')
  }

  return { candidate: true, matched: true }
}

/** Inline ordinary resolver: one holder declaration plus one exact try/catch assignment pair. */
function isInlineDomainResolver(statements) {
  const [holderPath, tryPath] = statements
  const holder = singleDeclarator(holderPath)
  if (
    !holder ||
    !t.isIdentifier(holder.node.id) ||
    holder.node.init ||
    !tryPath.isTryStatement() ||
    tryPath.node.finalizer ||
    !tryPath.node.handler
  )
    return false
  const tryAssignments = countNodes(
    tryPath.node.block,
    (node) =>
      t.isAssignmentExpression(node, { operator: '=' }) &&
      t.isIdentifier(node.left, { name: holder.node.id.name }),
  )
  const catchAssignments = countNodes(
    tryPath.node.handler.body,
    (node) =>
      t.isAssignmentExpression(node, { operator: '=' }) &&
      t.isIdentifier(node.left, { name: holder.node.id.name }) &&
      t.isIdentifier(node.right, { name: 'window' }),
  )
  return (
    tryAssignments === 1 &&
    catchAssignments === 1 &&
    countNodes(
      tryPath.node.block,
      (node) =>
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: 'Function' }),
    ) === 1
  )
}

/**
 * Which protection a guard callback implements, or `null` for a shape this pass does not know.
 *
 * Returning `null` is a decline, never a default: an unrecognised callback is left in place so a
 * residue census still counts it. The alternative - treating "matched the wrapper" as enough -
 * would delete arbitrary code that happens to be called as `C(this, fn)`.
 */
function classifyGuard(callbackPath) {
  const body = callbackPath.node.body
  const searches = countNodes(
    body,
    (n) => t.isCallExpression(n) && memberKey(n.callee) === 'search',
  )
  if (searches >= 2) return 'self-defending'

  const domain = domainLockClassification(callbackPath)
  if (domain.matched) return 'domain-lock'
  if (domain.candidate) return null

  const regexps = countNodes(
    body,
    (n) => t.isNewExpression(n) && t.isIdentifier(n.callee, { name: 'RegExp' }),
  )
  if (regexps >= 2) return 'debug-protection-call'

  const methodList = countNodes(body, (n) => {
    if (!t.isArrayExpression(n) || n.elements.length < 5) return false
    const strings = n.elements
      .filter((e) => t.isStringLiteral(e))
      .map((e) => e.value)
    return (
      strings.length >= 5 && strings.includes('log') && strings.includes('warn')
    )
  })
  if (methodList > 0) return 'console-output'

  // The era below `E-selfdef-search` builds its regexp through `constructor` rather than `RegExp`,
  // and is recognised by the nested function it declares and immediately calls. Checked last
  // because it is the loosest of the four.
  const nested = countNodes(
    body,
    (n) => isFnWithBlock(n) || t.isFunctionDeclaration(n),
  )
  if (nested > 0) return 'self-defending'

  return null
}

/** Is `path` inside `ancestor`? Asked of the live tree, never of cached positions. */
function isInside(path, ancestorNode) {
  return path.findParent((p) => p.node === ancestorNode) !== null
}

/**
 * The outermost statement that exists only to hold this guard.
 *
 * Debug protection's guard is invoked where it is built, inside an IIFE that wraps nothing else:
 *
 *     (function () { C(this, function () { … })(); })();
 *
 * Removing the inner statement leaves `(function () {})();` behind - a statement with no effect
 * that no census keyed on the *encoder's* shapes can see, because the encoder never emits it. We
 * do. So the removal target is computed by ascending through every wrapper whose body holds this
 * statement and nothing else, and the ascent is written as a loop because nesting depth is not
 * something to assume.
 */
/**
 * What to delete for a single effect.
 *
 * The encoder's adjacent-statement merging fuses neighbouring statements into one sequence
 * expression, and it does not care whose they are - a removal target of ours can end up sharing a
 * statement with the program's own calls. Deleting the statement then deletes those too, which is
 * corruption rather than residue and is silent: the program runs and simply stops producing
 * output. So delete the sequence *element* when there is one, and the statement otherwise.
 */
function effectPath(callPath) {
  return callPath.parentPath && callPath.parentPath.isSequenceExpression()
    ? callPath
    : callPath.getStatementParent()
}

function outermostWrapperStatement(guardCall) {
  // A fused guard yields its own element here, not a statement; the loop below then declines to
  // walk outward on its first test, which is correct - there is no wrapper to unwrap.
  let stmt = effectPath(guardCall)
  for (;;) {
    const block = stmt.parentPath
    if (!block || !block.isBlockStatement()) break
    if (block.node.body.length !== 1 || block.node.body[0] !== stmt.node) break
    const fn = block.parentPath
    if (!fn || !isFnWithBlock(fn.node) || fn.node.params.length) break
    const call = fn.parentPath
    if (
      !call ||
      !call.isCallExpression() ||
      call.node.callee !== fn.node ||
      call.node.arguments.length
    )
      break
    const outer = call.getStatementParent()
    if (!outer || !outer.isExpressionStatement()) break
    // The wrapper call may share a sequence expression with program effects. Preserve the
    // wrapper as one effect so removing it cannot erase its neighbours.
    stmt = effectPath(call)
  }
  return stmt
}

/**
 * The transformed global resolver has a split declaration and a try/catch assignment path:
 *
 *     var that;
 *     try {
 *       var get = Function('...return this...');
 *       that = get();
 *     } catch (e) {
 *       that = window;
 *     }
 *     that.setInterval(debugProtection, delay);
 *
 * This proof is deliberately separate from the declaration-pair proof below. The two templates
 * have different local reference graphs, and treating a matching first statement as enough would
 * make an unrelated try/catch wrapper removable. `null` means that the caller must retain the
 * interval effect rather than guessing at a larger removal target.
 */
function inlineResolverEffectPath(effect, block, fn, iife, callPath) {
  const [holder, tryPath] = block.get('body').slice(0, 2)
  if (!holder.isVariableDeclaration() || !tryPath.isTryStatement()) return null
  if (holder.node.declarations.length !== 1 || tryPath.node.finalizer)
    return null

  const holderDecl = holder.node.declarations[0]
  if (!t.isIdentifier(holderDecl.id) || holderDecl.init) return null
  const handler = tryPath.get('handler')
  if (!handler || !handler.isCatchClause() || !handler.node.body) return null

  const tryBody = tryPath.get('block')
  const catchBody = handler.get('body')
  if (tryBody.node.body.length !== 2 || catchBody.node.body.length !== 1)
    return null

  const resolver = tryBody.get('body.0')
  const tryAssignment = tryBody.get('body.1')
  const catchAssignment = catchBody.get('body.0')
  if (
    !resolver.isVariableDeclaration() ||
    resolver.node.declarations.length !== 1
  )
    return null

  const resolverDecl = resolver.node.declarations[0]
  if (!t.isIdentifier(resolverDecl.id)) return null
  if (
    !t.isCallExpression(resolverDecl.init) ||
    !t.isIdentifier(resolverDecl.init.callee, { name: 'Function' }) ||
    resolverDecl.init.arguments.length !== 1 ||
    !t.isStringLiteral(resolverDecl.init.arguments[0]) ||
    !/\breturn\s+this\b/.test(resolverDecl.init.arguments[0].value)
  ) {
    return null
  }

  const assignmentFor = (path, right) =>
    path.isExpressionStatement() &&
    t.isAssignmentExpression(path.node.expression, { operator: '=' }) &&
    t.isIdentifier(path.node.expression.left, { name: holderDecl.id.name }) &&
    right(path.node.expression.right)
  if (
    !assignmentFor(
      tryAssignment,
      (node) =>
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee, { name: resolverDecl.id.name }) &&
        node.arguments.length === 0,
    ) ||
    !assignmentFor(catchAssignment, (node) =>
      t.isIdentifier(node, { name: 'window' }),
    )
  ) {
    return null
  }

  if (
    !t.isMemberExpression(callPath.node.callee) ||
    !t.isIdentifier(callPath.node.callee.object, {
      name: holderDecl.id.name,
    }) ||
    !isSetIntervalCall(callPath)
  ) {
    return null
  }

  const resolverBinding = fn.scope.getBinding(resolverDecl.id.name)
  const holderBinding = fn.scope.getBinding(holderDecl.id.name)
  if (!resolverBinding || !holderBinding) return null
  if (
    resolverBinding.referencePaths.length !== 1 ||
    resolverBinding.referencePaths[0].node !==
      tryAssignment.node.expression.right.callee ||
    resolverBinding.constantViolations.length !== 0
  ) {
    return null
  }
  if (
    holderBinding.referencePaths.length !== 1 ||
    holderBinding.referencePaths[0].node !== callPath.node.callee.object ||
    holderBinding.constantViolations.length !== 2 ||
    !holderBinding.constantViolations.some(
      (path) => path.node === tryAssignment.node.expression,
    ) ||
    !holderBinding.constantViolations.some(
      (path) => path.node === catchAssignment.node.expression,
    )
  ) {
    return null
  }

  // `effect` is the wrapper's final statement by the caller's exact-three-statement gate. Keep the
  // identity check here as part of the local proof so this helper cannot be reused for an interior
  // member call if that gate is loosened later.
  if (block.node.body[2] !== effect.node) return null
  return effectPath(iife)
}

/**
 * The browser-no-eval resolver is a fixed three-host fallback:
 *
 *     typeof window !== 'undefined'
 *       ? window
 *       : typeof process === 'object' && typeof require === 'function' && typeof global === 'object'
 *         ? global
 *         : this
 *
 * The encoder emits this expression only for the browser-no-eval target. Keep the proof exact so a
 * similar-looking user resolver cannot be absorbed with the interval effect.
 */
function isBrowserNoEvalGlobalResolver(node) {
  if (!t.isConditionalExpression(node)) return false

  const { test, consequent, alternate } = node
  if (
    !t.isBinaryExpression(test, { operator: '!==' }) ||
    !t.isUnaryExpression(test.left, { operator: 'typeof' }) ||
    !t.isIdentifier(test.left.argument, { name: 'window' }) ||
    !t.isStringLiteral(test.right, { value: 'undefined' }) ||
    !t.isIdentifier(consequent, { name: 'window' }) ||
    !t.isConditionalExpression(alternate)
  ) {
    return false
  }

  const terms = []
  const collect = (expression) => {
    if (t.isLogicalExpression(expression, { operator: '&&' })) {
      collect(expression.left)
      collect(expression.right)
    } else {
      terms.push(expression)
    }
  }
  collect(alternate.test)

  const expected = [
    ['process', 'object'],
    ['require', 'function'],
    ['global', 'object'],
  ]
  if (
    terms.length !== expected.length ||
    !terms.every(
      (term, index) =>
        t.isBinaryExpression(term, { operator: '===' }) &&
        t.isUnaryExpression(term.left, { operator: 'typeof' }) &&
        t.isIdentifier(term.left.argument, { name: expected[index][0] }) &&
        t.isStringLiteral(term.right, { value: expected[index][1] }),
    )
  ) {
    return false
  }

  return (
    t.isIdentifier(alternate.consequent, { name: 'global' }) &&
    t.isThisExpression(alternate.alternate)
  )
}

/**
 * The service-worker resolver is the direct initialized-holder template:
 *
 *     (function () {
 *       var holder = typeof global === 'object' ? global : this;
 *       holder.setInterval(debugProtection, milliseconds);
 *     })();
 *
 * This proof is intentionally narrower than the two resolver forms above. The conditional is the
 * producer's target-specific template, and the binding checks make sure this IIFE owns the holder
 * and the protection reference rather than merely resembling a resolver around user code.
 */
function directResolverEffectPath(
  effect,
  block,
  fn,
  iife,
  callPath,
  protectionBinding,
) {
  if (block.node.body.length !== 2 || block.node.body[1] !== effect.node)
    return null

  const holder = block.get('body.0')
  if (!holder.isVariableDeclaration() || holder.node.kind !== 'var') return null
  if (holder.node.declarations.length !== 1) return null

  const holderDecl = holder.node.declarations[0]
  if (
    !t.isIdentifier(holderDecl.id) ||
    !t.isConditionalExpression(holderDecl.init)
  )
    return null

  const { test, consequent, alternate } = holderDecl.init
  const serviceWorkerResolver =
    t.isBinaryExpression(test, { operator: '===' }) &&
    t.isUnaryExpression(test.left, { operator: 'typeof' }) &&
    t.isIdentifier(test.left.argument, { name: 'global' }) &&
    t.isStringLiteral(test.right, { value: 'object' }) &&
    t.isIdentifier(consequent, { name: 'global' }) &&
    t.isThisExpression(alternate)
  const browserNoEvalResolver = isBrowserNoEvalGlobalResolver(holderDecl.init)
  if (!serviceWorkerResolver && !browserNoEvalResolver) return null

  // These names are host globals in their producer templates, never local shadows.
  const hostNames = serviceWorkerResolver
    ? ['global']
    : ['window', 'process', 'require', 'global']
  if (hostNames.some((name) => fn.scope.getBinding(name))) return null

  const callee = callPath.node.callee
  if (
    !t.isMemberExpression(callee) ||
    !t.isIdentifier(callee.object, { name: holderDecl.id.name }) ||
    memberKey(callee) !== 'setInterval' ||
    callPath.node.arguments.length !== 2
  ) {
    return null
  }

  const protection = callPath.node.arguments[0]
  if (!t.isIdentifier(protection)) return null

  const holderBinding = fn.scope.getBinding(holderDecl.id.name)
  const resolvedProtection = callPath.scope.getBinding(protection.name)
  if (
    !holderBinding ||
    !resolvedProtection ||
    resolvedProtection !== protectionBinding
  )
    return null
  if (holderBinding.path.node !== holderDecl) return null
  if (
    holderBinding.referencePaths.length !== 1 ||
    holderBinding.referencePaths[0].node !== callee.object ||
    holderBinding.constantViolations.length !== 0
  ) {
    return null
  }
  if (
    protectionBinding.referencePaths.length !== 1 ||
    protectionBinding.referencePaths[0].node !== protection ||
    protectionBinding.constantViolations.length !== 0 ||
    !protectionBinding.path.isFunctionDeclaration()
  ) {
    return null
  }

  return effectPath(iife)
}

/**
 * Remove the global-object resolver IIFE emitted around a member-qualified interval.
 *
 * The 4.0.0+ template has exactly two declaration statements before the interval call: a resolver
 * function and its one-use result. Ascending past that shape would delete user code, so require
 * the declaration identities and their complete reference graph before selecting the IIFE
 * statement.
 */
function intervalEffectPath(callPath, protectionBinding) {
  const effect = effectPath(callPath)
  if (!effect.isExpressionStatement()) return effect

  const block = effect.parentPath
  if (
    !block ||
    !block.isBlockStatement() ||
    ![2, 3].includes(block.node.body.length) ||
    block.node.body[block.node.body.length - 1] !== effect.node
  ) {
    return effect
  }
  const fn = block.parentPath
  if (!fn || !isFnWithBlock(fn.node) || fn.node.params.length) return effect
  const iife = fn.parentPath
  if (
    !iife ||
    !iife.isCallExpression() ||
    iife.node.callee !== fn.node ||
    iife.node.arguments.length
  ) {
    return effect
  }

  if (block.node.body.length === 2) {
    const direct = directResolverEffectPath(
      effect,
      block,
      fn,
      iife,
      callPath,
      protectionBinding,
    )
    return direct || effect
  }
  if (block.node.body.length !== 3) return effect

  const inline = inlineResolverEffectPath(effect, block, fn, iife, callPath)
  if (inline) return inline

  const [resolver, global] = block.get('body').slice(0, 2)
  if (!resolver.isVariableDeclaration() || !global.isVariableDeclaration()) {
    return effect
  }
  if (
    resolver.node.declarations.length !== 1 ||
    global.node.declarations.length !== 1
  ) {
    return effect
  }
  const resolverDecl = resolver.node.declarations[0]
  const globalDecl = global.node.declarations[0]
  if (!t.isIdentifier(resolverDecl.id) || !isFnWithBlock(resolverDecl.init)) {
    return effect
  }
  if (!t.isIdentifier(globalDecl.id) || !t.isCallExpression(globalDecl.init)) {
    return effect
  }
  if (!t.isIdentifier(globalDecl.init.callee, { name: resolverDecl.id.name })) {
    return effect
  }
  if (
    !t.isMemberExpression(callPath.node.callee) ||
    !t.isIdentifier(callPath.node.callee.object, { name: globalDecl.id.name })
  ) {
    return effect
  }

  const resolverBinding = fn.scope.getBinding(resolverDecl.id.name)
  const globalBinding = fn.scope.getBinding(globalDecl.id.name)
  if (!resolverBinding || !globalBinding) return effect
  if (
    resolverBinding.referencePaths.length !== 1 ||
    resolverBinding.referencePaths[0].node !== globalDecl.init.callee
  ) {
    return effect
  }
  if (
    globalBinding.referencePaths.length !== 1 ||
    globalBinding.referencePaths[0].node !== callPath.node.callee.object
  ) {
    return effect
  }
  return effectPath(iife)
}

/**
 * Remove one guard and the controller it runs through, or leave both untouched.
 *
 * Returns the protection's name when it removed something, `null` when it declined.
 */
function stripGuard(controllerPath, removed) {
  const id = controllerPath.node.id
  if (!t.isIdentifier(id)) return null
  const binding = controllerPath.scope.getBinding(id.name)
  if (!binding) return null

  // Partition the controller's references BEFORE touching anything: the calls that build a guard,
  // and everything else. The console-output callback puts several of the latter inside the former.
  const guardCalls = []
  const others = []
  for (const ref of binding.referencePaths) {
    const parent = ref.parentPath
    if (
      parent &&
      parent.isCallExpression() &&
      parent.node.callee === ref.node &&
      parent.node.arguments.length === 2 &&
      t.isThisExpression(parent.node.arguments[0]) &&
      isFnWithBlock(parent.node.arguments[1])
    ) {
      guardCalls.push(parent)
    } else {
      others.push(ref)
    }
  }
  if (guardCalls.length !== 1) {
    debugLog(
      `unlock-env: declining ${id.name}, ${guardCalls.length} guards on one controller`,
    )
    return null
  }
  const guardCall = guardCalls[0]
  const callbackPath = guardCall.get('arguments.1')
  const callback = callbackPath.node
  const kind = classifyGuard(callbackPath)
  if (!kind) {
    debugLog(`unlock-env: declining ${id.name}, unrecognised guard callback`)
    return null
  }
  // Every remaining reference must be inside the callback we are about to delete. One that is not
  // means something else uses this controller, and deleting it would break that caller.
  if (others.some((ref) => !isInside(ref, callback))) {
    debugLog(
      `unlock-env: declining ${id.name}, controller referenced outside its guard`,
    )
    return null
  }

  // Two definition shapes. `var G = C(this, fn); G()` binds a name, and the trigger is a separate
  // statement; debug protection's call form invokes the guard where it is built and binds nothing.
  const declarator = guardCall.parentPath.isVariableDeclarator()
    ? guardCall.parentPath
    : null
  let triggers = []
  if (declarator) {
    if (!t.isIdentifier(declarator.node.id)) return null
    const guardBinding = declarator.scope.getBinding(declarator.node.id.name)
    if (!guardBinding) return null
    for (const ref of guardBinding.referencePaths) {
      const call = ref.parentPath
      if (
        call &&
        call.isCallExpression() &&
        call.node.callee === ref.node &&
        !call.node.arguments.length
      ) {
        triggers.push(
          call.parentPath.isExpressionStatement() ? call.parentPath : call,
        )
      } else if (!isInside(ref, callback)) {
        debugLog(
          `unlock-env: declining ${id.name}, guard referenced outside its own trigger`,
        )
        return null
      }
    }
  }

  // --- past every gate; only now does anything move ---
  for (const trigger of triggers) trigger.remove()
  if (declarator) {
    declarator.remove()
  } else {
    // the guard is invoked in place: remove the whole wrapper that exists only to hold it
    outermostWrapperStatement(guardCall).remove()
  }
  controllerPath.remove()
  removed.push(kind)
  return kind
}

/**
 * The debug-protection function and whatever fires it.
 *
 * Matched on its two-statement body - a nested function declaration and a `try`/`catch` - which is
 * the shape the encoder's template guarantees and which no program body reaches by accident.
 * Removed after the guards, because the guard callback that calls this function is one of its
 * references and must be gone before the rest can be read.
 */
function stripDebugProtectionFunction(path, removed) {
  const { id, params, body } = path.node
  if (!t.isIdentifier(id) || params.length !== 1 || body.body.length !== 2)
    return
  if (!t.isFunctionDeclaration(body.body[0]) || !t.isTryStatement(body.body[1]))
    return

  const programScope = path.scope.getProgramParent()
  const binding = path.scope.getBinding(id.name)
  if (!binding) return

  // Each remaining reference must be an interval firing it. Anything else and the function is
  // still doing work we do not understand, so it stays.
  const intervals = []
  for (const ref of binding.referencePaths) {
    const fnParent = ref.getFunctionParent()
    const call = fnParent && fnParent.parentPath
    if (isSetIntervalCall(call)) {
      intervals.push(intervalEffectPath(call, binding))
      continue
    }
    if (isSetIntervalCall(ref.parentPath)) {
      intervals.push(intervalEffectPath(ref.parentPath, binding))
      continue
    }
    debugLog(
      `unlock-env: declining ${id.name}, debug-protection referenced outside an interval`,
    )
    return
  }

  for (const interval of intervals) if (!interval.removed) interval.remove()
  path.remove()
  // A declined resolver proof can leave its wrapper in place while removing only the interval
  // effect. That detaches the holder's final member reference, so refresh the state that later
  // visitors read before reporting the function as removed.
  programScope.crawl()
  removed.push('debug-protection')
}

/**
 * Strip every custom code helper the sample carries. Returns the list of protections removed, so a
 * caller can report what it did rather than inferring it from a diff.
 */
export default function unlockEnv(ast) {
  const removed = []

  // This pass's gates read `binding.referencePaths`, so it depends on those references still
  // pointing into the live tree. That is now guaranteed by the pass that breaks it rather than
  // defended here: `prune-if-branch` detaches subtrees and crawls on its way out, so no stale
  // reference reaches this point. This pass previously opened with a `traverse.cache.clear()` to
  // repair it, which was a symptom patch at the consumer - removed once the producer was fixed,
  // and its removal verified byte-identical over the corpus.
  //
  // Guards first. Each one's callback holds references to the debug-protection function and to its
  // own controller, so removing guards is what makes the remaining references readable.
  traverse(ast, {
    VariableDeclarator(path) {
      if (!isCallsControllerInit(path.node.init)) return
      stripGuard(path, removed)
    },
  })

  // Re-crawl before reading any binding again. The guard removals above detached nodes, and a
  // binding records its references as of the last crawl - so without this the debug-protection
  // function still lists the reference that lived inside the guard callback we just deleted, that
  // reference matches none of the accepted shapes, and the pass declines on every sample that has
  // one. This is the stale-scope trap, and the tell was exactly the one on record - a matcher that
  // accepts a freshly parsed tree and rejects every tree a pass has touched.
  //
  // The crawl is the whole remedy here, because the only nodes detached before this point are the
  // ones this pass's own first phase removed, and a crawl repairs what it detached. It used to be
  // half of one: a `traverse.cache.clear()` opened this function to absorb staleness inherited
  // from `prune-if-branch`, which is now repaired at that producer instead.
  traverse(ast, {
    Program(path) {
      path.scope.crawl()
    },
  })

  traverse(ast, {
    FunctionDeclaration(path) {
      stripDebugProtectionFunction(path, removed)
    },
  })

  if (removed.length) debugLog(`unlock-env: removed ${removed.join(', ')}`)
  return ast
}
