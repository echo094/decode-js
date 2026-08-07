import * as t from '@babel/types'

import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode

import bindingDef from '../../utility/binding-def.js'
const resolveBindingFunction = bindingDef.resolveBindingFunction

import { processStackParam, unmaskStack } from './variable-masking.js'

/**
 * Reads an object/member key regardless of shape: a plain Identifier, or a
 * StringLiteral (computed or not - js-confuser's Preparation pass
 * unconditionally normalizes non-computed keys to quoted/computed form, and
 * Minify, not always enabled, can convert a valid-identifier string key back
 * afterward).
 */
function keyName(node) {
  if (t.isIdentifier(node)) return node.name
  if (t.isStringLiteral(node)) return node.value
  return null
}

/**
 * Matches the Program-level `{ph}_d_fnLength` helper (transforms/dispatcher.ts's
 * `Program|Function: exit`, the `blockPath.isProgram()` branch) - inserted
 * unconditionally on every Program, regardless of whether any block actually
 * dispatches a function, so it can be orphaned from the start (no matched
 * dispatcher instance ever pointed to it) rather than only becoming orphaned
 * after cleanup. Two shapes: an empty no-op (`preserveFunctionLength` off) or
 * `SetFunctionLengthTemplate`'s real body (see stack.js's own `checkFuncLen`
 * for the same template matched from the call-site side instead).
 *
 * Takes the function itself, in either spelling - `readFnLengthHelper` below is
 * what finds it and supplies the name to delete, since the assignment spelling
 * carries no `id` of its own.
 */
function matchFnLengthHelper(fnPath) {
  const node = fnPath.node
  const body = node.body.body

  if (node.params.length === 0 && body.length === 0) return true

  if (node.params.length !== 2) return false
  const [fnParam, lengthParam] = node.params
  if (!t.isIdentifier(fnParam)) return false
  if (
    !t.isAssignmentPattern(lengthParam) ||
    !t.isIdentifier(lengthParam.left) ||
    !t.isNumericLiteral(lengthParam.right)
  ) {
    return false
  }

  if (body.length !== 2) return false
  const [defineStmt, retStmt] = body
  if (
    !t.isExpressionStatement(defineStmt) ||
    !t.isCallExpression(defineStmt.expression) ||
    !t.isMemberExpression(defineStmt.expression.callee) ||
    keyName(defineStmt.expression.callee.property) !== 'defineProperty' ||
    defineStmt.expression.arguments.length !== 3 ||
    !t.isIdentifier(defineStmt.expression.arguments[0]) ||
    defineStmt.expression.arguments[0].name !== fnParam.name ||
    !t.isStringLiteral(defineStmt.expression.arguments[1]) ||
    defineStmt.expression.arguments[1].value !== 'length' ||
    !t.isObjectExpression(defineStmt.expression.arguments[2])
  ) {
    return false
  }
  if (
    !t.isReturnStatement(retStmt) ||
    !t.isIdentifier(retStmt.argument) ||
    retStmt.argument.name !== fnParam.name
  ) {
    return false
  }

  return true
}

/**
 * Reads a Program-level statement that *holds* a `{ph}_d_fnLength` candidate, returning the
 * function to shape-check and the binding name to delete, or `null`.
 *
 * Two spellings, and the second is the encoder's, not ours. `dispatcher.ts` prepends the
 * helper as a `FunctionDeclaration`, but ControlFlowFlattening (Order 24, well after
 * Dispatcher's Order 6) can outline that declaration into its own switch/case table like any
 * other, and what an outlined function reads back as - see `control-flow-graph.js`'s
 * `matchOutlinedFunctionWrapper` - is a plain `X = function () {}` assignment against a
 * hoisted `var X`, not a declaration. On a `high` corpus that is the *only* spelling the
 * helper survives in, so reading solely for a `FunctionDeclaration` declined on every one.
 *
 * `safeDeleteNode` handles both from here: it is the binding it works from, removing the
 * constant violation (the assignment, and with it the `ExpressionStatement` holding it) and
 * then the declarator.
 */
function readFnLengthHelper(stmtPath) {
  if (stmtPath.isFunctionDeclaration()) {
    if (!stmtPath.node.id) return null
    return { name: stmtPath.node.id.name, fnPath: stmtPath }
  }
  if (!stmtPath.isExpressionStatement()) return null
  const expr = stmtPath.get('expression')
  if (!expr.isAssignmentExpression({ operator: '=' })) return null
  if (!t.isIdentifier(expr.node.left)) return null
  const right = expr.get('right')
  if (!right.isFunctionExpression() || right.node.id) return null
  return { name: expr.node.left.name, fnPath: right }
}

/**
 * Matches one `fns` object property (transforms/dispatcher.ts): the wrapped
 * function's body optionally starts with `var [p1, p2, ...] = payloadName`
 * (only present when the original function took params - the pattern may end
 * in a RestElement, since the original could have a rest param) unpacking the
 * payload array; the rest of the body is the original body verbatim.
 *
 * VariableMasking (encode order 20, after Dispatcher's order 6) can mask this
 * entry the same as any other function, replacing the unpack line above with
 * `[maskName[k1], maskName[k2], ...] = payloadName;` and adding a rest param
 * (the mask array) to the entry's own FunctionExpression - a shape
 * `variable-masking.js`'s own decoder never resolves on its own, since a
 * fns-entry FunctionExpression has no name (not a FunctionDeclaration, so the
 * call-site-arity fallback bails), no truncation statement (always called
 * with exactly zero arguments via `fns[name]()`, trivially "predictable"),
 * and is never itself referenced by a direct literal call `getStackParamLen`
 * could read an arity from. But Dispatcher's own template always builds this
 * entry with zero declared params (confirmed against real
 * `{ dispatcher: true }` output - even a source function with its own
 * `...rest` param becomes `var [a, ...rest] = payload` inside a zero-param
 * wrapper, never a rest param on the wrapper itself) - so a masked entry is
 * unambiguously recognizable (a single RestElement param where the
 * unmasked shape has none) and len=0 is a structural fact, not a guess.
 * Unmask in place via `variable-masking.js`'s own exported
 * `processStackParam` before attempting the plain-shape match below.
 */
/**
 * Locate the entry's unpack line - Dispatcher's own `var [a, b] = payload` (`dispatcher.ts`,
 * emitted only when the original had parameters), in either spelling and at any index.
 *
 * Neither degree of freedom is optional, and neither is ours:
 *
 * - **The assignment spelling is the encoder's.** VariableMasking (Order 20, after
 *   Dispatcher's Order 6) rewrites a defining identifier inside the pattern through
 *   `replaceDefiningIdentifierToMemberExpression`, whose `var id = 1` -> `id = 1` branch
 *   replaces the whole `VariableDeclaration` with an `ExpressionStatement`. It is visible in
 *   raw obfuscator output: `dispatcher` alone emits `var [a, b] = payload`, `dispatcher` plus
 *   `variableMasking` emits `[stk["a"], stk["b"]] = payload`.
 * - **The displacement is partly ours.** `unmaskStack` unshifts a bare `var _local...;` for
 *   every non-parameter slot it promotes, so by the time this runs the unpack line is never
 *   at `body[0]`; MovedDeclarations (Order 25) displaces it too, prepending a declaration
 *   whenever the top statement is no longer a `var`. Reading `body[0]` therefore declined on
 *   every application that had been through either.
 *
 * What may be skipped over is decided by execution order, not declaration order
 * (`isInertAboveUnpack`). The hazard is a *read* of one of the promoted names reaching the
 * program ahead of the unpack line: today it would see `undefined`, and after the rewrite -
 * which drops the line and binds those names as parameters instead - it would see the
 * argument. A statement that evaluates nothing cannot be that read, however much it
 * declares.
 *
 * Returns `null` - which fails closed through the payload-read test below - rather than
 * matching partially, per this file's all-or-nothing contract.
 */

/**
 * Can this statement sit above the unpack line without evaluating a read of anything?
 *
 * Three shapes qualify, and each is inert for its own reason:
 *
 * - an **initializer-less `VariableDeclaration`**, which evaluates nothing at all;
 * - a **`FunctionDeclaration`**, which is hoisted - declaring it evaluates nothing, and any
 *   read inside its body happens when it is *called*, which nothing above the unpack line
 *   does;
 * - an **`X = function (...) {...}` / `X = (...) => {...}` assignment**, for the same reason:
 *   building a closure evaluates neither its body nor its parameter defaults.
 *
 * Deliberately not a `ClassExpression`, whose computed keys and `extends` clause *are*
 * evaluated at construction. Anything else - an `if`, a call, a declarator with an
 * initializer - can run arbitrary code and is refused; one entry in the corpus is declined
 * by exactly that, and correctly.
 *
 * Inertness is only half the test. The caller also has to rule out a skipped statement
 * *binding or writing* one of the promoted names, which is a different failure: the rewrite
 * drops the unpack line, so a surviving `function a(){}` or `a = function(){}` above it would
 * be the last word on `a` rather than being overwritten by the payload, and the incoming
 * argument would be lost.
 */
function isInertAboveUnpack(stmt) {
  if (t.isVariableDeclaration(stmt)) {
    return !stmt.declarations.some((d) => d.init)
  }
  if (t.isFunctionDeclaration(stmt)) {
    return true
  }
  return (
    t.isExpressionStatement(stmt) &&
    t.isAssignmentExpression(stmt.expression, { operator: '=' }) &&
    t.isIdentifier(stmt.expression.left) &&
    (t.isFunctionExpression(stmt.expression.right) ||
      t.isArrowFunctionExpression(stmt.expression.right))
  )
}

/**
 * The names a skipped statement introduces or writes in the entry's own scope - not the
 * bindings it creates *inside* itself, which is why this is written out rather than left to
 * `getBindingIdentifiers` (that reports a FunctionDeclaration's parameters too, and they are
 * bound in the function, not here).
 */
function namesTouchedAbove(stmt) {
  if (t.isVariableDeclaration(stmt)) {
    return stmt.declarations
      .filter((d) => t.isIdentifier(d.id))
      .map((d) => d.id.name)
  }
  if (t.isFunctionDeclaration(stmt)) {
    return stmt.id ? [stmt.id.name] : []
  }
  if (t.isExpressionStatement(stmt)) {
    return [stmt.expression.left.name]
  }
  return []
}
/**
 * Can this pattern element be spelled as a function parameter?
 *
 * The assignment form's `left` is an assignment target, which is a strictly wider grammar
 * than a parameter list: `[stk["a"], stk["b"]] = payload` is a perfectly legal assignment and
 * an impossible parameter list. That spelling is exactly what an entry whose unmasking
 * declined still carries, so without this the matcher would rebuild it into output that does
 * not parse. A hole is legal nested (`function f([a, , b]) {}`) but binds nothing at the top
 * level, which the caller rejects separately.
 */
function isParamLegal(node) {
  if (node === null) return true
  if (t.isIdentifier(node)) return true
  if (t.isRestElement(node)) return isParamLegal(node.argument)
  if (t.isAssignmentPattern(node)) return isParamLegal(node.left)
  if (t.isArrayPattern(node)) return node.elements.every(isParamLegal)
  if (t.isObjectPattern(node)) {
    return node.properties.every((p) =>
      t.isRestElement(p) ? isParamLegal(p.argument) : isParamLegal(p.value),
    )
  }
  return false
}

function findUnpackLine(body, payloadName) {
  const declaredAbove = new Set()
  const skipped = []

  for (let index = 0; index < body.length; index++) {
    const stmt = body[index]

    let elements = null
    let declaresOwnNames = false
    if (
      t.isVariableDeclaration(stmt) &&
      stmt.declarations.length === 1 &&
      t.isArrayPattern(stmt.declarations[0].id) &&
      t.isIdentifier(stmt.declarations[0].init) &&
      stmt.declarations[0].init.name === payloadName
    ) {
      elements = stmt.declarations[0].id.elements
      declaresOwnNames = true
    } else if (
      t.isExpressionStatement(stmt) &&
      t.isAssignmentExpression(stmt.expression, { operator: '=' }) &&
      t.isArrayPattern(stmt.expression.left) &&
      t.isIdentifier(stmt.expression.right) &&
      stmt.expression.right.name === payloadName
    ) {
      elements = stmt.expression.left.elements
    }

    if (elements) {
      // A top-level hole binds nothing and cannot be spelled as a parameter, and an
      // assignment target is a wider grammar than a parameter list. The encoder emits
      // neither - its pattern is built straight from the original parameter list - so both
      // checks only reject shapes that would have been rebuilt into output that does not
      // parse, the un-unmasked `[stk["a"], stk["b"]] = payload` being the one that occurs.
      if (elements.some((el) => el === null)) return null
      if (!elements.every(isParamLegal)) return null

      // The assignment form writes to bindings that already exist. Promoting one to a
      // parameter is only sound when the binding really is this entry's own local: a name
      // resolving to an enclosing scope would have its write silently redirected into the
      // parameter slot, leaving whatever else reads it addressing a binding nothing assigns
      // any more. Requiring the declaration to sit in the statements just skipped is a
      // stricter, purely local form of `unmaskDestructuredRest`'s same-scope check.
      if (!declaresOwnNames) {
        for (const el of elements) {
          for (const name of Object.keys(t.getBindingIdentifiers(el))) {
            if (!declaredAbove.has(name)) return null
          }
        }
      }

      // No *surviving* skipped statement may bind or write a name the pattern is about to
      // promote: the unpack line is dropped by the rewrite, so a `function a(){}` or
      // `a = function(){}` above it would become the last word on `a` rather than being
      // overwritten by the payload, silently losing the incoming argument.
      //
      // Declarations are exempt, and have to be: the assignment form *requires* its names to
      // be declared in the statements just skipped (the check above), and those declarators
      // are exactly what `stripPromotedDeclarators` removes, so they shadow nothing.
      const promoted = patternNames(elements)
      for (const stmt of skipped) {
        if (t.isVariableDeclaration(stmt)) continue
        if (namesTouchedAbove(stmt).some((name) => promoted.has(name))) {
          return null
        }
      }

      return { index, elements, declaresOwnNames }
    }

    if (!isInertAboveUnpack(stmt)) {
      return null
    }
    skipped.push(stmt)
    if (t.isVariableDeclaration(stmt)) {
      for (const d of stmt.declarations) {
        if (t.isIdentifier(d.id)) declaredAbove.add(d.id.name)
      }
    }
  }

  return null
}

/**
 * Drop the declarators the unpack line's own pattern is about to become parameters of.
 *
 * Only the assignment form needs this: its names are declared separately (by `unmaskStack`'s
 * unshifted `var`, or by MovedDeclarations' block hoist), and reconstruction promotes the
 * pattern to the parameter list, so leaving them would shadow every restored parameter with a
 * same-named local. The declaration form declares its own names inline and has nothing to
 * strip.
 *
 * This rewrites the *emitted* statement array, never the tree: the entry is rebuilt as a
 * fresh `FunctionDeclaration` and the original is discarded with the dispatcher. So nothing
 * here has to be undone when a later entry declines and takes the whole match down.
 */
function patternNames(elements) {
  const names = new Set()
  for (const el of elements) {
    for (const name of Object.keys(t.getBindingIdentifiers(el))) {
      names.add(name)
    }
  }
  return names
}

function stripPromotedDeclarators(before, promoted) {
  const out = []
  for (const stmt of before) {
    // `before` is whatever `isInertAboveUnpack` let through, which is no longer only
    // declarations. A FunctionDeclaration or a closure assignment declares nothing this step
    // has to strip - `findUnpackLine` has already refused the case where one of them touches
    // a promoted name - so it passes through untouched.
    if (!t.isVariableDeclaration(stmt)) {
      out.push(stmt)
      continue
    }
    const kept = stmt.declarations.filter(
      (d) => !(t.isIdentifier(d.id) && promoted.has(d.id.name)),
    )
    if (kept.length === stmt.declarations.length) {
      out.push(stmt)
    } else if (kept.length) {
      out.push(t.variableDeclaration(stmt.kind, kept))
    }
  }
  return out
}

/**
 * Does this entry capture a binding that lives in the dispatcher's own scope?
 *
 * Reconstruction lifts each entry body out to where the dispatcher itself stood, so a
 * reference resolving to the dispatcher's parameters or locals is bound before the rewrite
 * and unbound after it. The dispatcher template's own `fnLengths = {}` parameter is the one
 * that occurs: a `cff-graph` scope anchor (`X.prop = {}`) can survive inside an entry body
 * addressing it, and `deScopeAnchorCleanupInit` does not always reach it.
 *
 * This was previously satisfied by accident. Those entries declined on the `body[0]` read
 * before anything looked at what they captured, so the precondition never had to be stated -
 * and making the unpack line locatable is what exposed it, as a `ReferenceError` in one
 * corpus sample rather than as a decline. Fail closed: a dispatcher that survives undecoded
 * is the correct trade against emitting a program that throws.
 */
function entryCapturesDispatcherScope(propPath) {
  const dispatcherFn = propPath.getFunctionParent()
  if (!dispatcherFn) return false
  const dispatcherScope = dispatcherFn.scope

  let captures = false
  propPath
    .get('value')
    .get('body')
    .traverse({
      Identifier(idPath) {
        if (captures || !idPath.isReferencedIdentifier()) return
        const binding = idPath.scope.getBinding(idPath.node.name)
        if (binding && binding.scope.getFunctionParent() === dispatcherScope) {
          captures = true
        }
      },
    })
  return captures
}

/**
 * Can this `fns` entry actually be rebuilt, or would `parseFnsEntry`'s no-parameter
 * fallback quietly produce a wrong function?
 *
 * That fallback is the genuine "original function took no parameters" case - no unpack
 * line to strip. But it is reached by *any* body `findUnpackLine` does not recognise,
 * which makes it a silent wrong answer rather than a decline for every spelling it does
 * not know. What reaches it now is the entry whose unmasking declined, still carrying
 * VariableMasking's (Order 20, after Dispatcher's Order 6) raw
 * `[stk["a"], stk["b"]] = payload`: an assignment target no parameter list can spell. It
 * would be returned as a zero-parameter function whose body still reads the payload
 * variable that the dispatcher cleanup then deletes - `undefined is not iterable` the
 * moment it runs.
 *
 * The test is therefore the consequence rather than any list of spellings: if the body
 * still reads `payloadName` after the unpack line would have been stripped, this entry
 * cannot be rebuilt. Declining takes the whole dispatcher down with it
 * (`matchDispatcherFn` is all-or-nothing), which leaves the obfuscated form standing -
 * the correct trade until the reconstruction understands those spellings.
 *
 * This is what `parseCreateFunction`'s old positional body check was accidentally
 * gating shut: when that was relaxed, 47 of 49 applications began matching and **all**
 * of them decoded to a wrong program.
 */
function fnsEntryIsReconstructible(propPath, payloadName) {
  const body = propPath.node.value.body.body
  if (findUnpackLine(body, payloadName)) return true

  let readsPayload = false
  propPath
    .get('value')
    .get('body')
    .traverse({
      Identifier(idPath) {
        if (
          idPath.node.name === payloadName &&
          idPath.isReferencedIdentifier()
        ) {
          readsPayload = true
        }
      },
    })
  return !readsPayload
}

function parseFnsEntry(propPath, payloadName) {
  const prop = propPath.node
  const newName = keyName(prop.key)
  if (newName === null) return null
  if (!t.isFunctionExpression(prop.value)) return null

  const masked =
    prop.value.params.length === 1 &&
    t.isRestElement(prop.value.params[0]) &&
    t.isIdentifier(prop.value.params[0].argument)

  // Decline before unmasking where that is possible at all. `processStackParam`
  // rewrites the entry in place, so declining afterwards leaves it rewritten but not
  // decoded - measurably worse output for no gain. A *masked* entry has to be unmasked
  // before the question can be asked, though: its unpack line only becomes the
  // recognisable `var [a, b] = payload` once the stack slots are resolved, so checking
  // it early false-declines the whole dispatcher (caught by the `masked-fns-entry`
  // fixture). Only the unmasked case can be judged for free, and only it is.
  if (!masked && !fnsEntryIsReconstructible(propPath, payloadName)) return null

  // Unmask unconditionally, and deliberately do not undo it when the entry then turns
  // out to be unreconstructible. This is not a side effect to be tidied away: a masked
  // `fns` entry is anonymous, zero-arity and never directly called, so
  // `variable-masking.js` cannot resolve it on its own (see the note above) - this is
  // the only place it gets unmasked at all. Restoring the original on a decline was
  // measured and made the corpus *larger*, since the masked spelling is the bigger one.
  if (masked) {
    const stackName = prop.value.params[0].argument.name
    processStackParam(propPath.get('value'), 0)
    // Folding leaves any slot `checkStackInvalid` marked invalid standing - an
    // `UpdateExpression` slot (`stk[3]++`) being the usual one, since no *value* can be
    // substituted into it. That marking is scoped to substitution: `unmaskStack` never
    // reads it, promoting every remaining slot to a real local instead, which `stk[3]++`
    // survives as `_local++`. It is unreachable from `deVariableMasking` here because
    // that gates on a truncation statement and Dispatcher marks its entries PREDICTABLE,
    // so one is never emitted - but the exact length it wants is the same structural `0`
    // used above, so it is safe to drive directly.
    unmaskStack(propPath.get('value'), 0)
    if (!fnsEntryIsReconstructible(propPath, payloadName)) return null
    // The stack must be *gone*, not merely reduced. Reconstruction rebuilds this entry
    // with the unpack pattern's own identifiers as its parameters, which drops the rest
    // param the stack lived in - so any slot still addressed through it becomes a
    // reference to nothing. `variable-masking.js` legitimately leaves such slots behind:
    // one touched by an `UpdateExpression` (`stk[3]++`) is marked invalid and never
    // resolved, and no arity fact of ours can rescue it. Fail closed rather than emit a
    // function whose body reads a parameter that is no longer there.
    let stackSurvives = false
    propPath
      .get('value')
      .get('body')
      .traverse({
        Identifier(idPath) {
          if (
            idPath.node.name === stackName &&
            idPath.isReferencedIdentifier()
          ) {
            stackSurvives = true
          }
        },
      })
    if (stackSurvives) return null
  }

  if (entryCapturesDispatcherScope(propPath)) return null

  // Dispatcher builds every entry with zero declared parameters and only ever calls it as
  // `fns[name]()` - the same template invariant the `unmaskStack(..., 0)` above rests on. Our
  // own `unmaskDestructuredRest` can restore a parameter list before this pass runs, though,
  // and reconstruction replaces the parameter list outright, so those names would go unbound.
  // Because the call site passes nothing they are always `undefined` on entry, which is
  // exactly a bare `var` local - re-bind them as one rather than declining. Anything that is
  // not a plain identifier is a shape this reasoning does not cover, so fail closed.
  const ownParams = prop.value.params
  if (!ownParams.every((p) => t.isIdentifier(p))) return null

  const valuePath = propPath.get('value')
  const localsFor = (promoted) => {
    const kept = ownParams.filter((p) => {
      if (promoted.has(p.name)) {
        return false
      }
      // A parameter nothing reads needs no binding at all. The call site passes no
      // arguments, so the name is `undefined` whether it is declared or not - but the
      // declaration is not free: a dead `var` is a *statement*, and a sibling matcher
      // reading a one-statement proxy body declines on it, which is enough to fail an
      // entire Flatten scope object. Fail closed on an unresolvable
      // binding rather than dropping a name we cannot account for.
      const binding = valuePath.scope.getBinding(p.name)
      return !binding || binding.referencePaths.length > 0
    })
    return kept.length
      ? [
          t.variableDeclaration(
            'var',
            kept.map((p) => t.variableDeclarator(t.identifier(p.name))),
          ),
        ]
      : []
  }

  const body = prop.value.body.body
  const unpack = findUnpackLine(body, payloadName)
  if (unpack) {
    const promoted = patternNames(unpack.elements)
    const before = unpack.declaresOwnNames
      ? body.slice(0, unpack.index)
      : stripPromotedDeclarators(body.slice(0, unpack.index), promoted)
    return {
      newName,
      params: unpack.elements,
      body: [
        ...localsFor(promoted),
        ...before,
        ...body.slice(unpack.index + 1),
      ],
    }
  }

  return { newName, params: [], body: [...localsFor(new Set()), ...body] }
}

/**
 * Matches the `createFunction` helper inside the nonCall branch: `function
 * createFunction(){ var fn = function(...args){ payload = args; return
 * fns[name].apply(this) }; var fnLength = fnLengths[name]; if (fnLength) {
 * fnLengthHelperName(fn, fnLength) } return fn }`. Purely a shape check -
 * nothing here affects decoding, since the reconstructed functions are plain
 * declarations, not length-wrapped closures; `{ph}_d_fnLength` itself is
 * cleaned up independently by `matchFnLengthHelper` below, structurally
 * rather than by name.
 *
 * The `if (fnLength) {...}` consequent accepts a second shape too, added
 * 2026-07-23: when `preserveFunctionLength` is off, `{ph}_d_fnLength` is the
 * empty no-op `function(){}`, and `anti-tooling.js`'s own decoder (which runs
 * earlier in the pipeline than this file) recognizes that shape generically
 * and strips the call, splicing its two arguments in as bare identifier
 * statements in the same order - `fn; fnLength;` instead of
 * `fnLengthHelperName(fn, fnLength);`. Both shapes are accepted so this
 * matcher doesn't depend on whether AntiTooling's decoder happened to run
 * first.
 */
function parseCreateFunction(createFnNode, payloadName) {
  const all = createFnNode.body.body

  // A trailing argument-less `return;` is unreachable residue sitting after the real
  // one, not part of the template.
  let end = all.length
  while (
    end > 0 &&
    t.isReturnStatement(all[end - 1]) &&
    !all[end - 1].argument
  ) {
    end--
  }
  if (end < 3) return null

  const ret = all[end - 1]
  const fnLengthIf = all[end - 2]
  const head = all.slice(0, end - 2)

  if (!t.isReturnStatement(ret) || !t.isIdentifier(ret.argument)) return null
  const fnName = ret.argument.name

  // Collect what the head binds, in either spelling. MovedDeclarations (Order 25)
  // rewrites each single-declarator `var` into a bare assignment and hoists the
  // declaration - into the block's leading `var` here, since this helper's own
  // enclosing function is not the one being packed - so `var fn = ...` arrives as a
  // declarator with no initializer plus `fn = ...` further down. Both slots are read
  // by name-from-role (the returned identifier, the `if` test) rather than by position.
  const bound = new Map()
  for (const st of head) {
    if (t.isVariableDeclaration(st)) {
      for (const d of st.declarations) {
        if (!t.isIdentifier(d.id)) return null
        if (d.init) bound.set(d.id.name, d.init)
      }
      continue
    }
    if (!t.isExpressionStatement(st)) return null
    const e = st.expression
    if (
      !t.isAssignmentExpression(e) ||
      e.operator !== '=' ||
      !t.isIdentifier(e.left)
    ) {
      return null
    }
    bound.set(e.left.name, e.right)
  }

  const fnExpr = bound.get(fnName)
  if (
    !t.isFunctionExpression(fnExpr) ||
    fnExpr.params.length !== 1 ||
    !t.isRestElement(fnExpr.params[0]) ||
    !t.isIdentifier(fnExpr.params[0].argument)
  ) {
    return null
  }
  const argsName = fnExpr.params[0].argument.name
  const fnBody = fnExpr.body.body
  if (fnBody.length !== 2) return null
  const [assign, applyReturn] = fnBody
  if (
    !t.isExpressionStatement(assign) ||
    !t.isAssignmentExpression(assign.expression) ||
    !t.isIdentifier(assign.expression.left) ||
    assign.expression.left.name !== payloadName ||
    !t.isIdentifier(assign.expression.right) ||
    assign.expression.right.name !== argsName
  ) {
    return null
  }
  if (
    !t.isReturnStatement(applyReturn) ||
    !t.isCallExpression(applyReturn.argument)
  ) {
    return null
  }

  if (
    !t.isIfStatement(fnLengthIf) ||
    fnLengthIf.alternate ||
    !t.isBlockStatement(fnLengthIf.consequent) ||
    !t.isIdentifier(fnLengthIf.test)
  ) {
    return null
  }
  const fnLengthName = fnLengthIf.test.name
  if (!bound.has(fnLengthName)) return null

  const consequentBody = fnLengthIf.consequent.body
  if (consequentBody.length === 1) {
    const call = consequentBody[0]
    if (
      !t.isExpressionStatement(call) ||
      !t.isCallExpression(call.expression) ||
      call.expression.arguments.length !== 2 ||
      !t.isIdentifier(call.expression.arguments[0]) ||
      call.expression.arguments[0].name !== fnName
    ) {
      return null
    }
  } else if (consequentBody.length === 2) {
    const [first, second] = consequentBody
    if (
      !t.isExpressionStatement(first) ||
      !t.isIdentifier(first.expression) ||
      first.expression.name !== fnName ||
      !t.isExpressionStatement(second) ||
      !t.isIdentifier(second.expression) ||
      second.expression.name !== fnLengthName
    ) {
      return null
    }
  } else {
    return null
  }

  return true
}

/**
 * Matches the whole dispatcher function body (transforms/dispatcher.ts):
 *
 *   function dispatcherName(name, flagArg, returnTypeArg, fnLengths = {...}) {
 *     var output;
 *     var fns = { "newName": function(){...}, ... };
 *     if (flagArg === CLEAR_KEY) { payloadName = []; }
 *     if (flagArg === NONCALL_KEY) {
 *       function createFunction() {...}
 *       output = cacheName[name] || (cacheName[name] = createFunction());
 *     } else {
 *       output = fns[name]();
 *     }
 *     if (returnTypeArg === RETURN_AS_OBJECT_KEY) {
 *       return { "RETURN_AS_OBJECT_PROPERTY_KEY": output };
 *     } else {
 *       return output;
 *     }
 *   }
 *
 * Structural only - no identifier-name assumptions. Returns every extracted
 * name/key needed to recognize this dispatcher's own call sites and to
 * reconstruct each dispatched function.
 */
/**
 * The dispatcher candidate a block statement offers, as `{ fnPath, name }`, or null.
 *
 * A `FunctionDeclaration` is one spelling, not the spelling. `control-flow-graph.js`
 * reconstructs a flattened function as `X = function (...) {...}` beside a hoisted `var X`,
 * and the dispatcher is as flattenable as anything else (ControlFlowFlattening is encoder
 * Order 24, Dispatcher Order 6), so on a `high` sample that is where a large share of them
 * arrive. Scanning for `isFunctionDeclaration()` alone walked past every one.
 *
 * The name comes from the holder's binding rather than from the assignment's left-hand
 * text: `resolveBindingFunction` is asked what the binding actually defines, and the
 * candidate is taken only when that is this very function. A binding written more than
 * once resolves to null there, which is what has to happen - reconstruction deletes the
 * holder, and a second write means deleting it would drop something else's definition.
 */
function readDispatcherCandidate(stmtPath) {
  if (stmtPath.isFunctionDeclaration()) {
    return stmtPath.node.id
      ? { fnPath: stmtPath, name: stmtPath.node.id.name }
      : null
  }
  // The binding has to define this very function, whichever spelling holds it.
  const takeIfDefinedHere = (namePath, fnPath) => {
    if (!namePath.isIdentifier() || !fnPath.isFunctionExpression()) return null
    const binding = stmtPath.scope.getBinding(namePath.node.name)
    if (!binding) return null
    const defined = resolveBindingFunction(binding)
    if (!defined || defined.node !== fnPath.node) return null
    return { fnPath, name: namePath.node.name }
  }

  // `var d = function (…) {…}` - the spelling ControlFlowFlattening leaves when nothing
  // afterwards splits it, and the one an ordinary source would use. Accepted per declarator,
  // so a merged declaration holding the dispatcher among others still matches; the caller
  // removes it through `safeDeleteNode`, which takes the declarator rather than the
  // statement.
  if (stmtPath.isVariableDeclaration()) {
    for (const declPath of stmtPath.get('declarations')) {
      const candidate = takeIfDefinedHere(
        declPath.get('id'),
        declPath.get('init'),
      )
      if (candidate) return candidate
    }
    return null
  }

  if (!stmtPath.isExpressionStatement()) return null
  const exprPath = stmtPath.get('expression')
  if (!exprPath.isAssignmentExpression({ operator: '=' })) return null
  return takeIfDefinedHere(exprPath.get('left'), exprPath.get('right'))
}

function matchDispatcherFn(fnPath, dispatcherName) {
  const node = fnPath.node
  if (!dispatcherName || node.params.length < 4) return null

  // The template's own four parameters are always the first four. Anything past
  // them is a slot MovedDeclarations (encoder Order 25) packed a single-declarator
  // `var` into - that transform's variable half is deliberately left unreversed, so on a
  // `high` sample the body's own `var output`
  // and `var fns` have migrated into the signature and the extra slots are the
  // normal case rather than an anomaly. They carry nothing this matcher needs.
  const [nameParam, flagArgParam, returnTypeArgParam, fnLengthsParam] =
    node.params
  if (!t.isIdentifier(nameParam)) return null
  if (!t.isIdentifier(flagArgParam)) return null
  if (!t.isIdentifier(returnTypeArgParam)) return null
  if (
    !t.isAssignmentPattern(fnLengthsParam) ||
    !t.isIdentifier(fnLengthsParam.left) ||
    !t.isObjectExpression(fnLengthsParam.right)
  ) {
    return null
  }
  const flagArgName = flagArgParam.name
  const returnTypeArgName = returnTypeArgParam.name

  // The template's three branch roles are the last three statements; everything
  // before them is a declaration prologue whose shape is not fixed. MovedDeclarations
  // (Order 25) is what dismantles it, and it has two insertion methods rather than
  // one: `var output` / `var fns` either move onto the parameter list, or have their
  // declarator appended to whatever `var` already leads the block - which is what
  // builds the merged `var output, fns, createFn;` prologue. Either way a bare
  // assignment is left behind here, and a hoisted FunctionDeclaration can sit in
  // front of both. Addressing the roles from the end keeps all of those readable,
  // where fixed positions from the front recognised only the untouched template.
  const body = node.body.body
  if (body.length < 3) return null
  const prologueLength = body.length - 3
  const clearIf = body[prologueLength]
  const nonCallIf = body[prologueLength + 1]
  const returnRole = body[prologueLength + 2]

  // Need payloadName before parsing fns entries (they reference it) - read it
  // off the clear-payload branch first.
  if (
    !t.isIfStatement(clearIf) ||
    clearIf.alternate ||
    !t.isBinaryExpression(clearIf.test) ||
    clearIf.test.operator !== '===' ||
    !t.isIdentifier(clearIf.test.left) ||
    clearIf.test.left.name !== flagArgName ||
    !t.isStringLiteral(clearIf.test.right) ||
    !t.isBlockStatement(clearIf.consequent) ||
    clearIf.consequent.body.length !== 1
  ) {
    return null
  }
  const clearStmt = clearIf.consequent.body[0]
  if (
    !t.isExpressionStatement(clearStmt) ||
    !t.isAssignmentExpression(clearStmt.expression) ||
    !t.isIdentifier(clearStmt.expression.left) ||
    !t.isArrayExpression(clearStmt.expression.right) ||
    clearStmt.expression.right.elements.length !== 0
  ) {
    return null
  }
  const payloadName = clearStmt.expression.left.name
  const clearPayloadKey = clearIf.test.right.value

  if (
    !t.isIfStatement(nonCallIf) ||
    !nonCallIf.alternate ||
    !t.isBinaryExpression(nonCallIf.test) ||
    nonCallIf.test.operator !== '===' ||
    !t.isIdentifier(nonCallIf.test.left) ||
    nonCallIf.test.left.name !== flagArgName ||
    !t.isStringLiteral(nonCallIf.test.right) ||
    !t.isBlockStatement(nonCallIf.consequent) ||
    nonCallIf.consequent.body.length !== 2 ||
    !t.isBlockStatement(nonCallIf.alternate) ||
    nonCallIf.alternate.body.length !== 1
  ) {
    return null
  }
  const nonCallKey = nonCallIf.test.right.value

  // `output` and `fns` are named by the role they play in the non-call branch's
  // else arm - `output = fns[name]()` - rather than by which prologue statement
  // happens to declare them. That arm is the one place both appear in a fixed
  // relationship whatever the prologue did with their declarations.
  const elseStmt = nonCallIf.alternate.body[0]
  if (
    !t.isExpressionStatement(elseStmt) ||
    !t.isAssignmentExpression(elseStmt.expression) ||
    !t.isIdentifier(elseStmt.expression.left) ||
    !t.isCallExpression(elseStmt.expression.right) ||
    !t.isMemberExpression(elseStmt.expression.right.callee) ||
    !t.isIdentifier(elseStmt.expression.right.callee.object)
  ) {
    return null
  }
  const outputName = elseStmt.expression.left.name
  const fnsName = elseStmt.expression.right.callee.object.name

  // Locate the `fns` object literal in the prologue, in either spelling: still its
  // own `var fns = {...}` declarator, or a bare `fns = {...}` assignment left
  // behind when the declaration was hoisted into a parameter slot. Anything in the
  // prologue that is neither a declaration nor a simple `X = ...` assignment means
  // this is not the template, so the match is declined whole rather than guessed at.
  let fnsPropertyPaths = null
  const bodyPaths = fnPath.get('body').get('body')
  for (let i = 0; i < prologueLength; i++) {
    const stmtPath = bodyPaths[i]
    if (stmtPath.isFunctionDeclaration()) continue
    if (stmtPath.isVariableDeclaration()) {
      for (const declPath of stmtPath.get('declarations')) {
        if (!t.isIdentifier(declPath.node.id)) return null
        if (declPath.node.id.name !== fnsName) continue
        // A declarator with no initializer is the *declaration* half of a split
        // declaration - `var output, fns;` up top and `fns = {...}` as its own
        // statement below, which is what MovedDeclarations' `variableDeclaration`
        // insertion produces by appending to whichever `var` already leads the block.
        // The object literal is found on that assignment, so this declarator carries no
        // information and must not be read as a failed match.
        if (!declPath.node.init) continue
        if (!t.isObjectExpression(declPath.node.init)) return null
        fnsPropertyPaths = declPath.get('init.properties')
      }
      continue
    }
    if (!stmtPath.isExpressionStatement()) return null
    const exprPath = stmtPath.get('expression')
    if (!exprPath.isAssignmentExpression({ operator: '=' })) return null
    if (!t.isIdentifier(exprPath.node.left)) return null
    if (exprPath.node.left.name !== fnsName) continue
    if (!t.isObjectExpression(exprPath.node.right)) return null
    fnsPropertyPaths = exprPath.get('right.properties')
  }
  if (!fnsPropertyPaths) return null

  // The helper arrives as its own `function createFunction(){…}`, or as a bare
  // `createFn = function (){…}` assignment beside a hoisted declarator. What rewrites it
  // into the second form is **not established** - it is not MovedDeclarations, whose
  // FunctionDeclaration handling requires the declaration to be a direct child of the
  // packed function (this one sits inside the non-call branch's block) and emits a
  // conditional `if(!F){F=…}` prologue rather than a bare assignment. Both spellings are
  // accepted on the strength of being observed, not of being attributed.
  const [createFnStmt, cacheAssignStmt] = nonCallIf.consequent.body
  let createFnNode = null
  if (t.isFunctionDeclaration(createFnStmt) && createFnStmt.id) {
    createFnNode = createFnStmt
  } else if (
    t.isExpressionStatement(createFnStmt) &&
    t.isAssignmentExpression(createFnStmt.expression) &&
    createFnStmt.expression.operator === '=' &&
    t.isIdentifier(createFnStmt.expression.left) &&
    t.isFunctionExpression(createFnStmt.expression.right)
  ) {
    createFnNode = createFnStmt.expression.right
  }
  if (!createFnNode) return null
  if (!parseCreateFunction(createFnNode, payloadName)) {
    return null
  }

  if (
    !t.isExpressionStatement(cacheAssignStmt) ||
    !t.isAssignmentExpression(cacheAssignStmt.expression) ||
    !t.isIdentifier(cacheAssignStmt.expression.left) ||
    cacheAssignStmt.expression.left.name !== outputName
  ) {
    return null
  }
  const cacheLogical = cacheAssignStmt.expression.right
  if (
    !t.isLogicalExpression(cacheLogical) ||
    cacheLogical.operator !== '||' ||
    !t.isMemberExpression(cacheLogical.left) ||
    !t.isIdentifier(cacheLogical.left.object)
  ) {
    return null
  }
  const cacheName = cacheLogical.left.object.name

  if (elseStmt.expression.right.callee.object.name !== fnsName) return null

  // The return role in either spelling: the template's own if/else, or the single
  // conditional return Minify folds it into. Both carry the same two keys.
  let returnAsObjectKey
  let objProp
  if (t.isIfStatement(returnRole)) {
    if (
      !returnRole.alternate ||
      !t.isBinaryExpression(returnRole.test) ||
      returnRole.test.operator !== '===' ||
      !t.isIdentifier(returnRole.test.left) ||
      returnRole.test.left.name !== returnTypeArgName ||
      !t.isStringLiteral(returnRole.test.right) ||
      !t.isBlockStatement(returnRole.consequent) ||
      returnRole.consequent.body.length !== 1 ||
      !t.isBlockStatement(returnRole.alternate) ||
      returnRole.alternate.body.length !== 1
    ) {
      return null
    }
    const objReturn = returnRole.consequent.body[0]
    if (
      !t.isReturnStatement(objReturn) ||
      !t.isObjectExpression(objReturn.argument) ||
      objReturn.argument.properties.length !== 1
    ) {
      return null
    }
    const idReturn = returnRole.alternate.body[0]
    if (
      !t.isReturnStatement(idReturn) ||
      !t.isIdentifier(idReturn.argument) ||
      idReturn.argument.name !== outputName
    ) {
      return null
    }
    returnAsObjectKey = returnRole.test.right.value
    objProp = objReturn.argument.properties[0]
  } else if (
    t.isReturnStatement(returnRole) &&
    t.isConditionalExpression(returnRole.argument)
  ) {
    const cond = returnRole.argument
    if (
      !t.isBinaryExpression(cond.test) ||
      cond.test.operator !== '===' ||
      !t.isIdentifier(cond.test.left) ||
      cond.test.left.name !== returnTypeArgName ||
      !t.isStringLiteral(cond.test.right) ||
      !t.isObjectExpression(cond.consequent) ||
      cond.consequent.properties.length !== 1 ||
      !t.isIdentifier(cond.alternate) ||
      cond.alternate.name !== outputName
    ) {
      return null
    }
    returnAsObjectKey = cond.test.right.value
    objProp = cond.consequent.properties[0]
  } else {
    return null
  }

  if (
    !t.isObjectProperty(objProp) ||
    keyName(objProp.key) === null ||
    !t.isIdentifier(objProp.value) ||
    objProp.value.name !== outputName
  ) {
    return null
  }
  const returnAsObjectPropertyKey = keyName(objProp.key)

  // Parsing the `fns` entries is deliberately the **last** thing this matcher does,
  // after every other part of the template has been confirmed. It is the only step here
  // that mutates: `parseFnsEntry` unmasks a masked entry via `processStackParam(entry,
  // 0)`, and that `0` is not read from the code - no truncation statement exists,
  // because this transform marks its entries PREDICTABLE and VariableMasking therefore
  // omits one, and there is no name or direct call site to infer an arity from either.
  // The count is purely an invariant of Dispatcher's own template: entries are always
  // built with zero declared parameters. So it is only sound to apply once the thing
  // really is that template - which is what everything above has just established.
  //
  // Within the loop, every entry is still parsed even once one has failed. Returning
  // early would skip the rest, and parsing an entry is what unmasks it, so a
  // first-failure bail costs the remaining entries a decode unrelated to whether this
  // dispatcher matches - measured at +108B and +21 residual array reads corpus-wide.
  const fnsEntries = new Map()
  let entriesReconstructible = true
  for (const propPath of fnsPropertyPaths) {
    if (!t.isObjectProperty(propPath.node)) return null
    const entry = parseFnsEntry(propPath, payloadName)
    if (!entry) {
      entriesReconstructible = false
      continue
    }
    fnsEntries.set(entry.newName, entry)
  }
  if (!entriesReconstructible) return null

  return {
    dispatcherName,
    payloadName,
    cacheName,
    clearPayloadKey,
    nonCallKey,
    returnAsObjectKey,
    returnAsObjectPropertyKey,
    fnsEntries,
  }
}

/**
 * Given a reference to `dispatcherName`, resolves the full call-site pattern:
 * extracts the referenced entry's name key and, for an
 * invocation, the original call arguments (from a preceding payload-assignment
 * sequence, or none for the zero-arg/clearPayload case).
 */
function matchCallSite(refPath, match) {
  if (refPath.key !== 'callee' || !refPath.parentPath) return null
  const callPath = refPath.parentPath
  if (!callPath.isCallExpression() && !callPath.isNewExpression()) return null

  const args = callPath.node.arguments
  if (args.length < 1 || !t.isStringLiteral(args[0])) return null
  const entry = match.fnsEntries.get(args[0].value)
  if (!entry) return null

  const flagArg = args[1]
  const flagKey = flagArg && t.isStringLiteral(flagArg) ? flagArg.value : null

  const wrapCandidate = callPath.parentPath
  const isWrapped =
    wrapCandidate &&
    wrapCandidate.isMemberExpression() &&
    wrapCandidate.node.computed &&
    keyName(wrapCandidate.node.property) === match.returnAsObjectPropertyKey &&
    wrapCandidate.node.object === callPath.node
  const outerPath = isWrapped ? wrapCandidate : callPath

  if (flagKey === match.nonCallKey) {
    return { entry, isCall: false, outerPath }
  }

  if (flagKey === match.clearPayloadKey) {
    return { entry, isCall: true, callArgs: [], outerPath }
  }

  // Non-zero-arg invocation: always paired with a preceding payload
  // assignment inside a shared SequenceExpression.
  const seq = outerPath.parentPath
  if (
    !seq ||
    !seq.isSequenceExpression() ||
    seq.node.expressions[seq.node.expressions.length - 1] !== outerPath.node
  ) {
    return null
  }
  const assignExpr = seq.node.expressions[seq.node.expressions.length - 2]
  if (
    !assignExpr ||
    !t.isAssignmentExpression(assignExpr) ||
    !t.isIdentifier(assignExpr.left) ||
    assignExpr.left.name !== match.payloadName ||
    !t.isArrayExpression(assignExpr.right)
  ) {
    return null
  }

  return {
    entry,
    isCall: true,
    callArgs: assignExpr.right.elements,
    outerPath: seq,
  }
}

export default function deDispatcherInit() {
  return {
    'Program|Function': {
      exit(blockPath) {
        const block = blockPath.isProgram()
          ? blockPath
          : blockPath.get('body').isBlockStatement()
            ? blockPath.get('body')
            : null

        if (block) {
          // `dispatcherPath` is the *statement*, not the function: it is what the
          // reconstructed declarations are inserted before, and what `safeDeleteNode` is
          // handed to remove. For the assignment spelling that statement holds only the
          // write, so the hoisted `var X;` declarator goes with it - which `safeDeleteNode`
          // does anyway, removing the binding's constant violations and then its path.
          let dispatcherPath = null
          let match = null
          for (const stmt of block.get('body')) {
            const candidate = readDispatcherCandidate(stmt)
            if (!candidate) continue
            const m = matchDispatcherFn(candidate.fnPath, candidate.name)
            if (!m) continue
            dispatcherPath = stmt
            match = m
            break
          }

          if (match) {
            block.scope.crawl()
            const binding = block.scope.getBinding(match.dispatcherName)

            if (binding) {
              const syntheticNames = new Map()
              for (const name of match.fnsEntries.keys()) {
                syntheticNames.set(
                  name,
                  block.scope.generateUidIdentifier(name).name,
                )
              }

              let allResolved = true
              for (const refPath of binding.referencePaths.slice()) {
                const callSite = matchCallSite(refPath, match)
                if (!callSite) {
                  allResolved = false
                  continue
                }
                const syntheticName = syntheticNames.get(callSite.entry.newName)

                if (!callSite.isCall) {
                  callSite.outerPath.replaceWith(t.identifier(syntheticName))
                  continue
                }

                callSite.outerPath.replaceWith(
                  t.callExpression(
                    t.identifier(syntheticName),
                    callSite.callArgs,
                  ),
                )
              }

              // Insert reconstructed functions where the dispatcher itself was.
              for (const [newName, entry] of match.fnsEntries) {
                const syntheticName = syntheticNames.get(newName)
                dispatcherPath.insertBefore(
                  t.functionDeclaration(
                    t.identifier(syntheticName),
                    entry.params,
                    t.blockStatement(entry.body),
                  ),
                )
              }

              block.scope.crawl()

              if (
                allResolved &&
                safeDeleteNode(match.dispatcherName, dispatcherPath)
              ) {
                const payloadBinding = block.scope.getBinding(match.payloadName)
                if (payloadBinding) {
                  safeDeleteNode(match.payloadName, payloadBinding.path)
                }
                const cacheBinding = block.scope.getBinding(match.cacheName)
                if (cacheBinding) {
                  safeDeleteNode(match.cacheName, cacheBinding.path)
                }
              }
            }
          }
        }

        if (blockPath.isProgram()) {
          blockPath.scope.crawl()
          for (const stmt of blockPath.get('body')) {
            const held = readFnLengthHelper(stmt)
            if (!held) continue
            if (!matchFnLengthHelper(held.fnPath)) continue
            safeDeleteNode(held.name, stmt)
          }
        }
      },
    },
  }
}
