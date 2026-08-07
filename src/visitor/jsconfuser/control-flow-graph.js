import * as t from '@babel/types'
import controlFlow from './control-flow.js'
import safeFunc from '../../utility/safe-func.js'

const { resolveStateNumber, makeLiteralResolverVisitor } = controlFlow
const { safeDeleteNode } = safeFunc

/**
 * Resolves an identifier reference to the function it is bound to - a `function F(){}`
 * declaration or a `var F = function(){}` initializer - or `null` for anything else (an
 * unbound name, a non-function value).
 *
 * This is the rename-proof primitive every CFF runtime-helper lookup in this module is built
 * on. The helpers `post()` prepends (`_cff_sum`/`_cff_slice`/`_cff_xor`/`_cff_hash` and their
 * `_cff_sequence`/`_strings` data) used to be found by literal name-suffix matching, which
 * `RenameVariables` (encoder Order 30, always on in the `high` preset) scrambles away
 * wholesale: never identify encoder-emitted structure by variable or function name.
 * Renaming necessarily preserves *binding structure* though - a call still resolves to the
 * same declaration whatever both are called - so every helper here is resolved from its own
 * use site instead, which works identically with or without renaming.
 */
function resolveFunctionBinding(refPath, name) {
  const binding = refPath.scope.getBinding(name)
  if (!binding || !binding.path) {
    return null
  }
  if (binding.path.isFunctionDeclaration()) {
    return binding.path
  }
  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.get('init')
    if (init.isFunctionExpression()) {
      return init
    }
  }
  return null
}

/**
 * Finds the Program-level `var X = <literal>` datum a CFF runtime helper reads: the
 * `_cff_sequence` array `_cff_slice` slices from, or the `_strings` blob `_cff_xor` decodes
 * out of. `post()` emits both as one Program-level `var sequence = [...], strings = "..."`
 * declaration (`controlFlowFlattening.ts`), so "a Program-scope binding whose declarator init
 * is a literal of this type, referenced from inside this helper's body" pins it down with no
 * name involved. Returns the declarator's `init` NodePath, or `null`.
 */
function findProgramDatumRead(fnPath, initType) {
  let found = null
  fnPath.traverse({
    ReferencedIdentifier(refPath) {
      if (found) {
        return
      }
      const binding = refPath.scope.getBinding(refPath.node.name)
      if (!binding || !binding.path || !binding.path.isVariableDeclarator()) {
        return
      }
      if (!binding.scope.path.isProgram()) {
        return
      }
      const init = binding.path.get('init')
      if (init.node && init.node.type === initType) {
        found = init
      }
    },
  })
  return found
}

/**
 * Reads a plain numeric array literal (the `_cff_sequence` array is always printed as bare
 * number literals - it's the array the slices index into, so it can't itself contain one).
 * Returns `null` on any other element shape.
 */
function readNumericArray(arrayExprPath) {
  const values = []
  for (const elPath of arrayExprPath.get('elements')) {
    if (elPath.isNumericLiteral()) {
      values.push(elPath.node.value)
    } else if (
      elPath.isUnaryExpression({ operator: '-' }) &&
      elPath.get('argument').isNumericLiteral()
    ) {
      values.push(-elPath.node.argument.value)
    } else {
      return null
    }
  }
  return values
}

// Slice-helper function node -> its `_cff_sequence` values (or `null` if it doesn't resolve).
// One CFF application decompresses hundreds of vectors through the same helper, so without
// this each would re-traverse the helper and re-read a ~100-element array.
const sequenceCache = new WeakMap()

/**
 * Resolves the `sequence` values behind one `...slice(min, max)` spread, from the spread's own
 * callee: the binding is a two-parameter `function slice(min, max){ return sequence["slice"](
 * min, max) }`, and `sequence` is the Program-level array it reads (`findProgramDatumRead`).
 * Returns the array's numeric values, or `null` if the callee isn't that shape.
 */
function resolveSliceSequence(callPath) {
  const calleePath = callPath.get('callee')
  if (!calleePath.isIdentifier()) {
    return null
  }
  const fnPath = resolveFunctionBinding(calleePath, calleePath.node.name)
  if (!fnPath || fnPath.node.params.length !== 2) {
    return null
  }
  if (sequenceCache.has(fnPath.node)) {
    return sequenceCache.get(fnPath.node)
  }
  const arrayPath = findProgramDatumRead(fnPath, 'ArrayExpression')
  const sequence = arrayPath ? readNumericArray(arrayPath) : null
  sequenceCache.set(fnPath.node, sequence)
  return sequence
}

/**
 * Undoes ControlFlowFlattening's `getSpreadArray` compression, as it appears on an
 * outlined nested function: a state vector is printed as a mix of plain number literals
 * and `...slice(min, max)`
 * spreads, where a spread stands for `sequence.slice(min, max)` against the one shared
 * `{ph}_cff_sequence` array literal every flattened Program prepends once. Both the slice
 * helper and that array are resolved from the spread itself (`resolveSliceSequence`), so no
 * caller has to carry them and no name is involved.
 *
 * Returns `null` on any unrecognized element shape rather than a partial vector, since a
 * partially-wrong state vector is worse than a clear failure - every later step
 * (transition-graph walking, literal-entanglement undoing) depends on this being exact.
 */
function decompressStateVector(arrayExprPath) {
  const vector = []
  for (const elPath of arrayExprPath.get('elements')) {
    if (elPath.isSpreadElement()) {
      const callPath = elPath.get('argument')
      if (!callPath.isCallExpression()) {
        return null
      }
      const args = callPath.get('arguments')
      if (
        args.length !== 2 ||
        !args[0].isNumericLiteral() ||
        !args[1].isNumericLiteral()
      ) {
        return null
      }
      const sequence = resolveSliceSequence(callPath)
      if (!sequence) {
        return null
      }
      const start = args[0].node.value
      const end = args[1].node.value
      if (start < 0 || end > sequence.length || start > end) {
        return null
      }
      for (let i = start; i < end; i++) {
        vector.push(sequence[i])
      }
    } else if (elPath.isNumericLiteral()) {
      vector.push(elPath.node.value)
    } else if (
      elPath.isUnaryExpression({ operator: '-' }) &&
      elPath.get('argument').isNumericLiteral()
    ) {
      vector.push(-elPath.get('argument').node.value)
    } else {
      return null
    }
  }
  return vector
}

/**
 * Applies one goto's state-mutation `SequenceExpression` (Stage 2's CallExpression
 * goto -> state update handling) to a known entry vector, returning the
 * vector the jump lands on. Each expression is `states[i] = N` (debug builds /
 * `addRelativeAssignments: false`) or `states[i] += (states[j] - diff)` (the default
 * "relative assignment" mangling) - either way the right-hand side is exactly the
 * arithmetic shape `resolveStateNumber` already evaluates.
 *
 * Reads within the sequence are live, not snapshotted: `mutatingStateValues` in the
 * encoder updates after each assignment as it emits the sequence, so a later expression
 * in the same jump can legitimately reference a slot an earlier expression in the *same*
 * sequence already changed. This function mirrors that by mutating a working copy in
 * place as it goes, left to right - not by resolving all expressions against the
 * original entry vector.
 *
 * Returns `null` (not a partial vector) if any expression doesn't match the shape above.
 */
function applyStateMutations(sequenceExprPath, statesName, vector) {
  return applyStateMutationList(
    sequenceExprPath.get('expressions'),
    statesName,
    vector,
  )
}

/**
 * `applyStateMutations` over an already-collected list of expression paths rather than a
 * `SequenceExpression` wrapper. This is the real primitive: a goto's updates only *usually*
 * arrive inside one `SequenceExpression`, since `AstScrambler` can spread them across
 * separate statements (see `matchGotoSequence`). Same semantics, including the live
 * left-to-right reads.
 */
function applyStateMutationList(exprPaths, statesName, vector) {
  const next = [...vector]
  for (const exprPath of exprPaths) {
    if (!exprPath.isAssignmentExpression()) {
      return null
    }
    const { operator } = exprPath.node
    if (operator !== '=' && operator !== '+=') {
      return null
    }
    const leftPath = exprPath.get('left')
    if (
      !leftPath.isMemberExpression({ computed: true }) ||
      !leftPath.get('object').isIdentifier({ name: statesName })
    ) {
      return null
    }
    const indexPath = leftPath.get('property')
    if (!indexPath.isNumericLiteral()) {
      return null
    }
    const index = indexPath.node.value
    if (!Number.isInteger(index) || index < 0 || index >= next.length) {
      return null
    }
    const rhs = resolveStateNumber(exprPath.get('right'), statesName, next)
    if (rhs === null) {
      return null
    }
    next[index] = operator === '=' ? rhs : next[index] + rhs
  }
  return next
}

/**
 * Generic boolean-expression evaluator over a known state vector - a superset of
 * control-flow.js's `resolveStateBoolean`, which is deliberately narrow (only `==`/`!=`,
 * since that's the only shape Stage 2 turns an actual source `BooleanLiteral` into). This
 * one also needs `<`/`>`/`<=`/`>=` and `!(...)` negation, because it's evaluating dead-code
 * guard predicates (`createPredicate`/`createFalsePredicate`) and switch-case
 * clash-avoidance clauses, both of which pick from all four comparison operators and can
 * be negated with a leading `!`. Used by the transition-graph walker to prove a dead-jump
 * branch is never taken and to test a switch case's guard clause, not to render a literal
 * back into source.
 */
function evaluateBooleanExpression(path, statesName, vector) {
  if (path.isUnaryExpression({ operator: '!' })) {
    const inner = evaluateBooleanExpression(
      path.get('argument'),
      statesName,
      vector,
    )
    return inner === null ? null : !inner
  }
  if (path.isBinaryExpression()) {
    const { operator } = path.node
    if (!['==', '!=', '<', '>', '<=', '>='].includes(operator)) {
      return null
    }
    const left = resolveStateNumber(path.get('left'), statesName, vector)
    const right = resolveStateNumber(path.get('right'), statesName, vector)
    if (left === null || right === null) {
      return null
    }
    switch (operator) {
      case '==':
        return left === right
      case '!=':
        return left !== right
      case '<':
        return left < right
      case '>':
        return left > right
      case '<=':
        return left <= right
      case '>=':
        return left >= right
    }
  }
  return null
}

/**
 * Groups a flattened function's dispatcher `switch(sumFn(states)){...}` cases the way JS
 * fallthrough actually groups them: Stage 3 gives every real/impossible
 * block a contiguous run of `SwitchCase`s where all but the last are empty-bodied decoys
 * (either plain random ints, or - when the block's own test was picked as a decoy by the
 * post-shuffle `pop()` - a stray complex test), and the last carries the block's real
 * body. Which specific test in a run is "the real one" doesn't matter for matching: every
 * test in a run reaches the same body, and the decoy ints are drawn from the same
 * collision-free generator as real `totalState`s, so they can never actually match a live
 * vector's sum - only `matchCaseGroup` needs to try every test in a group.
 */
function parseSwitchCaseGroups(switchPath) {
  const groups = []
  let pendingTests = []
  for (const casePath of switchPath.get('cases')) {
    const testPath = casePath.get('test')
    pendingTests.push(testPath)
    const consequent = casePath.get('consequent')
    if (consequent.length > 0) {
      groups.push({ tests: pendingTests, statements: consequent, casePath })
      pendingTests = []
    }
  }
  return groups
}

/**
 * Evaluates one switch-case test expression against a known state vector, mirroring the
 * two shapes Stage 3 emits for each case's test: a plain `totalState` int, or -
 * for a "complex test" - `states[j] - diff`, optionally wrapped in one or more
 * `states[k] != X && ...` clash-avoidance guards. `&&` short-circuits exactly like real JS:
 * a false guard makes the whole test `false` (which can never `===` a numeric sum), a true
 * guard defers to the right-hand side.
 */
function evaluateCaseTest(path, statesName, vector) {
  if (path.isLogicalExpression({ operator: '&&' })) {
    const guard = evaluateBooleanExpression(
      path.get('left'),
      statesName,
      vector,
    )
    if (guard === null) {
      return null
    }
    if (!guard) {
      return false
    }
    return evaluateCaseTest(path.get('right'), statesName, vector)
  }
  return resolveStateNumber(path, statesName, vector)
}

/**
 * Finds which case group a known state vector dispatches to - the switch-statement
 * equivalent of reading the interpreter's own `while`/`switch` by hand.
 * Matches with `===` semantics (real JS switch matching): a group matches if *any* of its
 * tests evaluates to exactly `sum(vector)`, since the caller already knows this vector is
 * live (not dead-code noise) and CFF guarantees at most one real block's test can equal a
 * reachable sum.
 */
function matchCaseGroup(groups, statesName, vector) {
  const sum = vector.reduce((a, b) => a + b, 0)
  for (const group of groups) {
    for (const testPath of group.tests) {
      const value = evaluateCaseTest(testPath, statesName, vector)
      if (value === sum) {
        return group
      }
    }
  }
  return null
}

/**
 * Reads the fixed harness shape Stage 3's switch/while assembly and the Program-level
 * wiring build around every flattened `mainFnName(states, scope, runtime, ...args)`: a
 * body of exactly one `while(sumFn(states) !==
 * END){ label: switch(sumFn(states)){...} }`. Returns `null` if `mainFnPath`'s body
 * doesn't match this exactly - callers should treat that as "not a CFF-flattened
 * function," not attempt a partial read.
 */
/**
 * Reads the fixed interpreter-loop shape shared by every CFF switch dispatcher:
 * `while (sumFn(<state>) !== <end>) <switchLabel>?: switch (sumFn(<state>)) { ... }`.
 * `whilePath` is the `WhileStatement`. Returns `{ sumFnName, endTotalState, statePath,
 * switchLabel, switchPath }` or `null`.
 *
 * `statePath` is the discriminant call's single argument NodePath - a plain Identifier for
 * the dispatcher's own state param and for a local-array-state inline function, or a
 * computed MemberExpression for a scope-member-state inline interpreter. This reader stays
 * agnostic about which; callers decide what they accept and derive their `statesName` from
 * it.
 *
 * Shared by `parseDispatcher` (the top-level `_main` dispatcher) and
 * `matchInlineFlattenedFunction` (nested inline-flattened functions) so both agree on the
 * loop's exact shape.
 */
function parseWhileSwitch(whilePath) {
  if (!whilePath.isWhileStatement()) {
    return null
  }

  const testPath = whilePath.get('test')
  if (!testPath.isBinaryExpression({ operator: '!==' })) {
    return null
  }
  const discriminantPath = testPath.get('left')
  const endPath = testPath.get('right')
  if (
    !discriminantPath.isCallExpression() ||
    !discriminantPath.get('callee').isIdentifier()
  ) {
    return null
  }
  const discriminantArgs = discriminantPath.get('arguments')
  if (discriminantArgs.length !== 1) {
    return null
  }
  const statePath = discriminantArgs[0]

  // `endTotalState` is a plain random int (`stateIntGen`, not derived from any state
  // var), but a *negative* one prints as `UnaryExpression(-, NumericLiteral)` in Babel's
  // AST, never a single negative-valued NumericLiteral node - missed at first since both
  // real samples this module was first verified against happened to land on a positive
  // end state (an even chance either way in practice).
  let endTotalState
  if (endPath.isNumericLiteral()) {
    endTotalState = endPath.node.value
  } else if (
    endPath.isUnaryExpression({ operator: '-' }) &&
    endPath.get('argument').isNumericLiteral()
  ) {
    endTotalState = -endPath.node.argument.value
  } else {
    return null
  }
  const sumFnName = discriminantPath.get('callee').node.name

  // The dispatcher switch is always constructed as a labeled statement
  // (`switchLabel: switch(...){...}` in Stage 3), and its `break`s are built
  // referencing that label - but downstream pipeline stages (e.g. label
  // simplification/removal, not part of this transform) can strip a label that's
  // provably redundant, since an unlabeled `break` inside a `switch` already exits the
  // nearest one. Accept either shape; `switchLabel` comes back `null` when absent, and
  // `matchGotoSequence` already treats that as "don't check the label."
  //
  // The `while`'s own body is a `BlockStatement` wrapping the switch in normal output, but
  // `minify` strips the block for a single-statement body (`while(x)switch(y){...}` instead
  // of `while(x){switch(y){...}}`), leaving the switch (or labeled switch) as the body
  // itself - accept both shapes rather than assuming a block wrapper is always present.
  const bodyPath = whilePath.get('body')
  let switchPath
  if (bodyPath.isBlockStatement()) {
    if (bodyPath.get('body').length !== 1) {
      return null
    }
    switchPath = bodyPath.get('body')[0]
  } else {
    switchPath = bodyPath
  }
  let switchLabel = null
  if (switchPath.isLabeledStatement()) {
    switchLabel = switchPath.node.label.name
    switchPath = switchPath.get('body')
  }
  if (!switchPath.isSwitchStatement()) {
    return null
  }

  return { sumFnName, endTotalState, statePath, switchLabel, switchPath }
}

function parseDispatcher(mainFnPath) {
  const params = mainFnPath.get('params')
  if (params.length < 1 || !params[0].isIdentifier()) {
    return null
  }
  const statesName = params[0].node.name

  const bodyStmts = mainFnPath.get('body.body')
  if (bodyStmts.length !== 1 || !bodyStmts[0].isWhileStatement()) {
    return null
  }

  const loop = parseWhileSwitch(bodyStmts[0])
  if (!loop) {
    return null
  }

  return {
    statesName,
    sumFnName: loop.sumFnName,
    endTotalState: loop.endTotalState,
    switchLabel: loop.switchLabel,
    switchPath: loop.switchPath,
  }
}

/**
 * Detects a nested *inline-flattened function* - the residual shape CFF's per-function
 * bottom-up flattening leaves behind when a flattened function's own interpreter is emitted
 * inline rather than as its own `_main`+harness application. The
 * local-array-state variant looks like:
 *
 *   <anything> = function (...restArg) {
 *     var s, scope, runtime, arg;                        // the destructured locals
 *     [s, scope = { ... }, runtime, arg] = restArg;      // unpack the packed call arguments
 *     while (sumFn(s) !== end) switch (sumFn(s)) { ... }  // the interpreter, state = `s`
 *     return undefined;                                   // optional trailing return
 *   }
 *
 * The state array `s` is the *first* destructured local (a plain Identifier); `scope` is the
 * second (an Identifier, or an AssignmentPattern with a `{ ... }` default), then `runtime`,
 * then an optional packed-arg local. This reads those names and the interpreter facts (via
 * `parseWhileSwitch`) but does not touch the AST - detection only.
 *
 * Returns `null` for anything that isn't exactly this shape (fail-closed, like every other
 * matcher in this module). The scope-member-state variant (an inline `while`/`switch` whose
 * state lives in a `scope[..][..]` member, emitted directly inside a case body rather than
 * wrapped in a function) is a separate shape handled elsewhere.
 */
function matchInlineFlattenedFunction(fnPath) {
  if (!fnPath.isFunction()) {
    return null
  }
  const params = fnPath.get('params')
  if (
    params.length !== 1 ||
    !params[0].isRestElement() ||
    !params[0].get('argument').isIdentifier()
  ) {
    return null
  }
  const restName = params[0].get('argument').node.name

  const bodyPath = fnPath.get('body')
  if (!bodyPath.isBlockStatement()) {
    return null
  }
  const stmts = bodyPath.get('body')

  // The `[s, scope = {...}, runtime, arg] = restArg` unpacking - located by shape, not
  // position, since a `var s, scope, ...;` hoist declaration usually precedes it.
  let destructurePath = null
  for (const stmt of stmts) {
    if (!stmt.isExpressionStatement()) {
      continue
    }
    const expr = stmt.get('expression')
    if (
      expr.isAssignmentExpression({ operator: '=' }) &&
      expr.get('left').isArrayPattern() &&
      expr.get('right').isIdentifier({ name: restName })
    ) {
      destructurePath = expr
      break
    }
  }
  if (!destructurePath) {
    return null
  }

  const elements = destructurePath.get('left').get('elements')
  const stateEl = elements[0]
  if (!stateEl || !stateEl.isIdentifier()) {
    return null
  }
  const statesName = stateEl.node.name

  // `scope`/`runtime`/`arg` each read back to a bare name whether they're a plain Identifier
  // or an AssignmentPattern with a default (the `scope` slot always carries a `{ ... }`
  // default). Absent trailing slots come back `null`.
  const readName = (el) => {
    if (!el || !el.node) {
      return null
    }
    if (el.isIdentifier()) {
      return el.node.name
    }
    if (el.isAssignmentPattern() && el.get('left').isIdentifier()) {
      return el.get('left').node.name
    }
    return null
  }
  const scopeName = readName(elements[1])
  const runtimeName = readName(elements[2])
  const argName = readName(elements[3])

  // The interpreter loop, whose discriminant reads the first destructured local.
  let loop = null
  let whilePath = null
  for (const stmt of stmts) {
    if (!stmt.isWhileStatement()) {
      continue
    }
    const parsed = parseWhileSwitch(stmt)
    if (parsed && parsed.statePath.isIdentifier({ name: statesName })) {
      loop = parsed
      whilePath = stmt
      break
    }
  }
  if (!loop) {
    return null
  }

  return {
    fnPath,
    restName,
    destructurePath,
    statesName,
    scopeName,
    runtimeName,
    argName,
    sumFnName: loop.sumFnName,
    endTotalState: loop.endTotalState,
    switchLabel: loop.switchLabel,
    switchPath: loop.switchPath,
    whilePath,
  }
}

/**
 * Reads one scope-member chain link's property name, accepting both the encoder's native
 * bracketed string-key form (`scope["x"]`, `computed: true` + `StringLiteral`) and the dot
 * form `minify` rewrites it to (`scope.x`, `computed: false` + `Identifier`) whenever the key
 * is a compile-time string that also happens to be a valid identifier (`minify.ts`'s
 * `MemberExpression: exit`, `a["key"] -> a.key`). Returns the property name string, or `null`
 * if `memberPath` isn't a MemberExpression in either of those two shapes.
 */
function readScopeMemberKey(memberPath) {
  if (!memberPath.isMemberExpression()) {
    return null
  }
  const prop = memberPath.get('property')
  if (memberPath.node.computed) {
    return prop.isStringLiteral() ? prop.node.value : null
  }
  return prop.isIdentifier() ? prop.node.name : null
}

/**
 * Detects the *scope-member-state* variant of the inline-flattened interpreter - the second
 * of the two shapes it comes in. Unlike `matchInlineFlattenedFunction`'s local-array
 * variant, this one isn't wrapped in its own function - CFF's per-function bottom-up
 * flattening emits it directly inside a parent application's switch case body, and its state
 * array lives in a *scope-object member* rather than a local:
 *
 *   case <n>:
 *     [scope[k1][k2], scope[..][..] = {...}, ...] = <packed>;      // unpack into scope members
 *     while (sumFn(scope[k1][k2]) !== end) switch (sumFn(scope[k1][k2])) { ... }
 *     return undefined;                                            // optional
 *
 * `whilePath` is the candidate `WhileStatement`. Detection: a `parseWhileSwitch` loop whose
 * state operand is a *scope-member chain* (`root["a"]["b"]...` or, under `minify`,
 * `root.a.b...` - see `readScopeMemberKey`) rooted at a plain Identifier - the enclosing
 * inline function's scope object. Pass
 * `options.scopeName` to require that root to be a specific scope name (how M3/M4 will bind
 * a nested interpreter to the function it belongs to); omit it to accept any Identifier root.
 *
 * Returns `{ whilePath, statePath, scopeName, stateKeys, sumFnName, endTotalState,
 * switchLabel, switchPath }` or `null` (fail-closed). `stateKeys` is the source-order string
 * key chain identifying which scope member holds the state array. This reads the shape but
 * does not mutate the AST - detection only.
 */
function matchScopeMemberInterpreter(whilePath, options = {}) {
  const loop = parseWhileSwitch(whilePath)
  if (!loop) {
    return null
  }

  // Walk the scope-member chain down to its root identifier (bracketed string-key or, under
  // `minify`, dot-notation - see `readScopeMemberKey`), which is what distinguishes this
  // state operand from a local-array state's bare Identifier.
  const keys = []
  let cur = loop.statePath
  let key
  while ((key = readScopeMemberKey(cur)) !== null) {
    keys.unshift(key)
    cur = cur.get('object')
  }
  if (keys.length === 0 || !cur.isIdentifier()) {
    return null
  }
  const scopeName = cur.node.name

  if (options.scopeName && scopeName !== options.scopeName) {
    return null
  }

  return {
    whilePath,
    statePath: loop.statePath,
    scopeName,
    stateKeys: keys,
    sumFnName: loop.sumFnName,
    endTotalState: loop.endTotalState,
    switchLabel: loop.switchLabel,
    switchPath: loop.switchPath,
  }
}

/**
 * Resolves a call expression's callee down to the target `Identifier` NodePath it actually
 * invokes, transparently unwrapping the `(1, fn)` comma-guard the encoder emits to force the
 * callee's `this` to `undefined` (`createCallExpression`, `controlFlowFlattening.ts`). Both a
 * bare `fn(...)` callee and a `(1, fn)(...)` `SequenceExpression` callee resolve to the `fn`
 * Identifier; any other callee shape returns `null`. Shared by every call-site matcher here
 * so the guarded and unguarded forms are handled identically in one place.
 */
function resolveGuardedCallee(calleePath) {
  if (calleePath.isSequenceExpression()) {
    const exprs = calleePath.get('expressions')
    const last = exprs[exprs.length - 1]
    return last && last.isIdentifier() ? last : null
  }
  if (calleePath.isIdentifier()) {
    return calleePath
  }
  return null
}

/**
 * Collects every static entry vector an inline-flattened function is called with: the set of
 * start states an inline `var = function(...){}` shared interpreter is entered at, so its
 * decode can pick the *external* entry (the call site not inside the fn's own body) - the
 * in-body self-calls are its fresh-scope nested wrappers, decoded separately.
 * An inline fn is invoked as
 * `(1, name)([vector], ...)` (the `(1, fn)` comma-guard the encoder emits so the callee's
 * `this` is undefined) or plainly as `name([vector], ...)`; the first argument is always a
 * `getSpreadArray`-compressed literal start vector, so every call site's entry state is
 * statically recoverable. Searches `searchRoot`'s subtree for such calls and decompresses
 * each vector with `decompressStateVector`. De-duplicates by vector value - the same literal
 * vector at two call sites is one entry. A call whose first argument isn't a static array
 * (a computed re-dispatch, if any) is skipped, not failed. Detection only - no AST mutation.
 *
 * `excludePath` (optional) drops any call site inside that subtree - pass the inline fn's own
 * body to keep only its *external* entries, since the in-body self-calls are its nested
 * wrappers, decoded separately.
 */
function collectInlineEntryVectors(searchRoot, name, { excludePath } = {}) {
  const vectors = []
  const seen = new Set()
  searchRoot.traverse({
    CallExpression(path) {
      const target = resolveGuardedCallee(path.get('callee'))
      if (!target || !target.isIdentifier({ name })) {
        return
      }
      if (
        excludePath &&
        (path.node === excludePath.node ||
          path.findParent((p) => p.node === excludePath.node))
      ) {
        return
      }
      const arg0 = path.get('arguments.0')
      if (!arg0 || !arg0.isArrayExpression()) {
        return
      }
      const vector = decompressStateVector(arg0)
      if (!vector) {
        return
      }
      const key = vector.join(',')
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      vectors.push(vector)
    },
  })
  return vectors
}

// The zero-assignment goto: one whose target block's state vector is *identical* to the
// current block's on every
// slot - `controlFlowFlattening.ts`'s own CallExpression/goto handling skips a slot's
// assignment entirely whenever `oldValue === newValue` (L1359: "No diff needed if the
// value doesn't change"), so this isn't a hypothetical edge case, just an unlucky-but-real
// one: any two blocks whose ~70-100-dimension random vectors happen to agree on *every*
// slot need zero assignments. Confirmed empirically (a dead-code fake jump whose randomly
// chosen target label happened to be its own block, guaranteeing every slot matches) -
// found via the stress-testing convention this project already uses for CFF (real
// obfuscator runs, not just source reading), not by inspecting source in advance. Reused
// by `matchGotoSequence`, which returns it as an empty expression list.

/**
 * Reads one statement's worth of a goto's state updates - the `states[i] (=|+=) <arith>`
 * assignments it contributes - or `null` if it isn't such a statement at all.
 *
 * Both partitions are accepted, because the encoder emits one and `AstScrambler` rewrites
 * it into the other:
 *
 * - `ExpressionStatement` wrapping a `SequenceExpression`, which is what
 *   `ControlFlowFlattening` itself prints
 *   (`t.expressionStatement(t.sequenceExpression(assignments))`);
 * - `ExpressionStatement` wrapping a single assignment, which is what's left once
 *   `AstScrambler` (Order 29, after CFF's 24) has spread that sequence into its merged
 *   no-op call and `ast-scrambler.js` has split the call back into one statement per
 *   argument. That un-merge cannot restore the original partition (the encode step is
 *   many-to-one), so matchers downstream of it have to accept either.
 *
 * Only the *shape* is checked here - assignment to a computed member of `statesName`.
 * Operator and index validity stay `applyStateMutationList`'s job, exactly as before.
 */
function readGotoAssignments(stmtPath, statesName) {
  if (!stmtPath.isExpressionStatement()) {
    return null
  }
  const expr = stmtPath.get('expression')
  const exprPaths = expr.isSequenceExpression()
    ? expr.get('expressions')
    : [expr]
  for (const exprPath of exprPaths) {
    if (!exprPath.isAssignmentExpression()) {
      return null
    }
    const left = exprPath.get('left')
    if (
      !left.isMemberExpression({ computed: true }) ||
      !left.get('object').isIdentifier({ name: statesName })
    ) {
      return null
    }
  }
  return exprPaths
}

/**
 * Matches a goto: its `states[i] (=|+=) <arithmetic>` assignments, immediately followed by
 * a `break` (optionally labeled - unlabeled when nested inside the dead-jump guard's own
 * block, since it doesn't need to name the enclosing switch's label to break out of it...
 * actually it does, `break switchLabel` always names it explicitly per
 * `GotoControlStatement` - `switchLabel` is accepted but not required to match, since a
 * mismatched label would just mean this isn't a goto pair at all and `null` is correct
 * either way).
 *
 * `stmtPaths` is the exact window to test, `break` last: a block's whole body, or the run
 * a caller sliced out of a statement list. Every statement before the `break` has to be
 * part of the goto, so a window holding anything else is not a match - callers scanning a
 * larger list slice the run themselves via `findGotoRunEnd`. The window can be longer than
 * two statements because `AstScrambler` dissolves the encoder's single-`SequenceExpression`
 * partition; see `readGotoAssignments`.
 *
 * A zero-assignment goto (see the note above this file's `readGotoAssignments`) has
 * nothing to wrap in an `ExpressionStatement` at all - `t.sequenceExpression([])` prints
 * (and, critically, *reparses*) as a bare `EmptyStatement`, not an `ExpressionStatement`
 * containing an empty `SequenceExpression` - so that shape is matched explicitly. It needs
 * no arithmetic either, and an empty list is exactly what `applyStateMutationList` turns
 * into an unchanged vector.
 *
 * Under `AstScrambler` that placeholder disappears altogether: in the encoder's own AST it
 * is still an `ExpressionStatement` wrapping the empty `SequenceExpression` (stages hand
 * nodes to each other, they don't reparse), so the accumulator spreads its *zero*
 * expressions into itself and emits nothing at all. A window of just `[break]` is
 * therefore the same zero-assignment goto and is accepted. Measured, not assumed: 8
 * `{controlFlowFlattening, renameVariables, dispatcher}` runs produce 6 `; break;` guards
 * and 0 bare ones, and adding `astScrambler` inverts that exactly (0 and 18).
 *
 * That relaxation cannot loosen the bare-`break` fail-closed guard in `interpretBlockGroup`,
 * because `findGotoRunEnd` never hands back a window starting at a `break` - only the
 * whole-block callers can produce one, and only the dead-jump guard block ever holds a
 * zero-assignment goto (a jump that changes no slot resolves to its own block, which is
 * meaningful only on a branch that is never taken).
 *
 * Returns the flat list of state-update expression paths (possibly empty), or `null`.
 */
function matchGotoSequence(stmtPaths, statesName, switchLabel) {
  if (stmtPaths.length < 1) {
    return null
  }
  const last = stmtPaths[stmtPaths.length - 1]
  if (!last.isBreakStatement()) {
    return null
  }
  if (switchLabel && last.node.label && last.node.label.name !== switchLabel) {
    return null
  }

  const head = stmtPaths.slice(0, -1)
  if (head.length === 1 && head[0].isEmptyStatement()) {
    return []
  }

  const exprPaths = []
  for (const stmtPath of head) {
    const assignments = readGotoAssignments(stmtPath, statesName)
    if (!assignments) {
      return null
    }
    exprPaths.push(...assignments)
  }
  return exprPaths
}

/**
 * Index of the `break` ending the goto run starting at `start`, or `-1` if no goto run
 * starts there. For callers scanning a statement list, where `AstScrambler` may have left
 * the updates spread over several statements *and* merged real user code into the head of
 * the same run - it merges across statement boundaries, so the goto is only ever the
 * maximal *trailing* stretch of state-update statements before the `break`. Anything
 * before that stretch is rejected here and left for the caller to emit normally.
 */
function findGotoRunEnd(stmts, start, statesName) {
  let i = start
  if (stmts[i].isEmptyStatement()) {
    i++
  } else {
    while (i < stmts.length && readGotoAssignments(stmts[i], statesName)) {
      i++
    }
    if (i === start) {
      return -1
    }
  }
  return i < stmts.length && stmts[i].isBreakStatement() ? i : -1
}

// Resolves what `matchGotoSequence` returned into the vector it jumps to. An empty list
// needs no arithmetic at all (the vector is unchanged by construction), which
// `applyStateMutationList` already produces by looping zero times.
function resolveGotoVector(exprPaths, statesName, vector) {
  return applyStateMutationList(exprPaths, statesName, vector)
}

// Stage 2's ReturnStatement handling wraps a real return as `(didReturnVar =
// true, returnArgument)` - matching the shape structurally (assign-then-value) is precise
// enough without needing to know the variable's actual generated name - but only for
// returns whose nearest enclosing function is the one CFF is flattening right now
// (`functionParent.get("body") !== blockPath`, controlFlowFlattening.ts's ReturnStatement
// visitor). A return physically inside an *outlined nested function*'s own portion of the
// shared table is, from that check's perspective, a return whose function parent is the
// nested function, not the one being flattened - so it's left as a plain `return value;`,
// verified against real encoder output (a nested `helper`'s `return sum;` came out
// unwrapped, sitting right next to the outer function's own wrapped return in the same
// switch). Accept both: try the wrapped shape first, fall back to the argument as-is.
//
// `keepReturnFlag` governs the `didReturnVar = true` assignment. A `_main` application inlines
// its whole body AND removes its harness (the `if (didReturn) return result` check), so the
// flag write is dead and dropping it is clean - the default. A *dispatcher-nested inline fn*
// instead stays a callable function whose harness in the enclosing scope is NOT
// removed: its parent's `if (flag) return ...` still reads the flag, so the write must be
// kept or the parent silently returns `undefined`. `decodeInlineFlattenedFunction` sets this.
//
// Returns `null` for an *argument-less* `return;`, which is a real shape rather than a
// failure: CFF's own block terminator prints as `return undefined;`, but `minify` (encoder
// Order 28, always on in the `high` preset) rewrites that to a bare `return;`. Callers
// therefore carry a `null` argument through as "returns undefined" instead of treating it
// as an unrecognized shape - reading it as failure made every minified application whose
// walk reached such a block fail closed, and with it the whole enclosing application. Same
// class as the `while(x)switch(y)` brace-stripping bug: a `minify` surface rewrite of a
// shape this module was only matching in its unminified spelling.
function parseReturnValue(returnPath, keepReturnFlag) {
  const argPath = returnPath.get('argument')
  if (!argPath.node) {
    return null
  }
  if (!keepReturnFlag && argPath.isSequenceExpression()) {
    const exprs = argPath.get('expressions')
    if (
      exprs.length === 2 &&
      exprs[0].isAssignmentExpression({ operator: '=' }) &&
      exprs[0].get('left').isIdentifier()
    ) {
      return exprs[1]
    }
  }
  return argPath
}

/**
 * Interprets one matched case group's statements against its (now current) entry vector,
 * separating real payload from the synthetic shapes CFF splices in. Three synthetic
 * shapes, distinguished
 * structurally (never by guessing from a test's contents):
 *
 * - A goto pair (`states[i]=...,...; break;`) not wrapped in an `if` - this block's own
 *   unconditional jump, ending interpretation with `{type:'jump'}`.
 * - An `if` with **no alternate** whose consequent is exactly a goto pair - a dead-code
 *   guard (`createFalsePredicate`, dead-code mechanism 2). Its predicate is built by the
 *   encoder to be false for this exact block's real vector, so `evaluateBooleanExpression`
 *   must confirm `false`; anything else (`true`, or unresolvable) means the vector this
 *   was called with is wrong, so this returns `null` rather than silently guessing.
 * - An `if` **with an alternate** where *both* branches are goto pairs - a real structural
 *   if/else-to-goto conversion (Stage 1). Every `if`/`else` with block bodies gets this
 *   treatment regardless of whether the user wrote an `else` at all (an absent one becomes
 *   an implicit goto to the merge point), so "has two goto-shaped branches" is what
 *   distinguishes a real branch from a dead-jump guard, not the presence of a source-level
 *   `else`. The test itself may depend on runtime data (it's the user's original
 *   condition), so unlike a dead-jump guard, this can't be resolved to one side at decode
 *   time - it ends interpretation with `{type:'branch'}` instead, carrying both successor
 *   vectors for the caller to explore.
 *
 * Any `if` matching neither shape - or any other statement - is genuine surviving user
 * code (only block-bodied if/else gets goto-converted at all) and is copied through to
 * the output as-is.
 *
 * Returns `null` on any unrecognized shape (rather than a best-effort partial result) or
 * a `{ statements, terminal }` pair once a terminal shape is found - `statements` holds
 * only the genuine payload seen before it, `terminal` is one of `{type:'jump', vector}`,
 * `{type:'branch', test, consequentVector, alternateVector}`, or
 * `{type:'return', argument}`.
 */
function interpretBlockGroup(
  group,
  vector,
  statesName,
  switchLabel,
  keepReturnFlag,
) {
  const stmts = group.statements
  const outputStatements = []

  for (let i = 0; i < stmts.length; i++) {
    const stmtPath = stmts[i]

    if (stmtPath.isReturnStatement()) {
      // `argument` is `null` for an argument-less `return;` (see `parseReturnValue`) - a
      // legitimate terminal, not a match failure, so it is carried through as-is.
      return {
        statements: outputStatements,
        terminal: {
          type: 'return',
          argument: parseReturnValue(stmtPath, keepReturnFlag),
        },
      }
    }

    if (stmtPath.isThrowStatement()) {
      // A `throw` terminates the block unconditionally, so the encoder emits no goto after
      // it - the same terminal position a `return` holds. Unlike a return there is nothing
      // to rebuild: the statement is carried through as an ordinary output statement (which
      // also gets it literal/scope-decoded along with the rest of the group, since its
      // argument is entangled like any other expression), and the terminal only records
      // that the walk stops here. Reached via `DeadCode`'s (Order 8) templates, whose
      // argument guards throw, flattened afterwards by CFF (Order 24).
      outputStatements.push(stmtPath)
      return {
        statements: outputStatements,
        terminal: { type: 'throw' },
      }
    }

    if (stmtPath.isIfStatement()) {
      const consequentPath = stmtPath.get('consequent')
      const alternatePath = stmtPath.get('alternate')

      if (!alternatePath.node) {
        const seq = consequentPath.isBlockStatement()
          ? matchGotoSequence(
              consequentPath.get('body'),
              statesName,
              switchLabel,
            )
          : null
        if (seq) {
          const predicate = evaluateBooleanExpression(
            stmtPath.get('test'),
            statesName,
            vector,
          )
          if (predicate !== false) {
            return null
          }
          continue
        }
      } else if (
        consequentPath.isBlockStatement() &&
        alternatePath.isBlockStatement()
      ) {
        const seqCons = matchGotoSequence(
          consequentPath.get('body'),
          statesName,
          switchLabel,
        )
        const seqAlt = matchGotoSequence(
          alternatePath.get('body'),
          statesName,
          switchLabel,
        )
        if (seqCons && seqAlt) {
          const consequentVector = resolveGotoVector(
            seqCons,
            statesName,
            vector,
          )
          const alternateVector = resolveGotoVector(seqAlt, statesName, vector)
          if (!consequentVector || !alternateVector) {
            return null
          }
          return {
            statements: outputStatements,
            terminal: {
              type: 'branch',
              test: stmtPath.get('test'),
              consequentVector,
              alternateVector,
            },
          }
        }
      }

      outputStatements.push(stmtPath)
      continue
    }

    // The goto's updates are one statement as the encoder prints them, but a run of them
    // after `AstScrambler` has been un-merged - and that run can have real user code
    // merged onto its head, since `AstScrambler` merges across statement boundaries. Take
    // only the maximal trailing stretch ending at the `break`; anything before it has
    // already been pushed to `outputStatements` by earlier iterations.
    const gotoEnd = findGotoRunEnd(stmts, i, statesName)
    if (gotoEnd !== -1) {
      const seq = matchGotoSequence(
        stmts.slice(i, gotoEnd + 1),
        statesName,
        switchLabel,
      )
      if (seq) {
        const nextVector = resolveGotoVector(seq, statesName, vector)
        if (!nextVector) {
          return null
        }
        return {
          statements: outputStatements,
          terminal: { type: 'jump', vector: nextVector },
        }
      }
    }

    if (stmtPath.isBreakStatement()) {
      // A bare `break` not consumed above as half of a goto pair is a shape this doesn't
      // recognize - bail rather than silently dropping it.
      return null
    }

    outputStatements.push(stmtPath)
  }

  return null
}

const MAX_WALK_STEPS = 5000

/**
 * Recursively walks the transition graph from a known vector, producing a small DAG:
 * sequential edges (single successor) stay linear, real if/else-converted branch points
 * fan out into two (`{type:'branch'}`), and both sides memoize back onto shared merge
 * points by vector value rather than re-walking them - a real if/else's two arms always
 * reconverge forward, and CFF emits no back-edges (loops and switches survive the
 * transform whole), so forward convergence is the only case to handle here.
 *
 * Node shapes: `{type:'end', statements}`, `{type:'return', statements, argument,
 * vector}`, `{type:'sequential', statements, next, vector}`, `{type:'branch',
 * statements, test, consequent, alternate, vector}`. `statements` on every node is that
 * block's own genuine payload (literal entanglement not yet undone - see
 * `undoLiteralEntanglementInGraph` below). `vector` (absent on `end`, which has no
 * statements to resolve anything against) is the entry vector this specific node was
 * reached with - exactly what a literal-entanglement pass over this node needs, since
 * Stage 2 mangles every literal against its own block's vector. Returns `null` if any
 * step along the way is unresolvable, or if walking runs past `MAX_WALK_STEPS` (a
 * defensive cap against an unexpectedly-diverging walk, not an expected case - real CFF
 * output has no cycles to diverge on).
 */
function resolveBlockGraph(
  groups,
  statesName,
  switchLabel,
  endTotalState,
  vector,
  memo = new Map(),
  steps = { count: 0 },
  keepReturnFlag = false,
) {
  const sum = vector.reduce((a, b) => a + b, 0)
  if (sum === endTotalState) {
    return { type: 'end', statements: [] }
  }

  const key = vector.join(',')
  if (memo.has(key)) {
    return memo.get(key)
  }

  steps.count++
  if (steps.count > MAX_WALK_STEPS) {
    return null
  }

  const group = matchCaseGroup(groups, statesName, vector)
  if (!group) {
    return null
  }
  const result = interpretBlockGroup(
    group,
    vector,
    statesName,
    switchLabel,
    keepReturnFlag,
  )
  if (!result) {
    return null
  }

  const node = { statements: result.statements, vector }
  memo.set(key, node)

  if (result.terminal.type === 'return') {
    node.type = 'return'
    node.argument = result.terminal.argument
    return node
  }

  // A `throw` terminal has no successor vector to walk and carries no argument of its own -
  // the ThrowStatement is already in `node.statements` (see `interpretBlockGroup`).
  if (result.terminal.type === 'throw') {
    node.type = 'throw'
    return node
  }

  if (result.terminal.type === 'jump') {
    const next = resolveBlockGraph(
      groups,
      statesName,
      switchLabel,
      endTotalState,
      result.terminal.vector,
      memo,
      steps,
      keepReturnFlag,
    )
    if (!next) {
      return null
    }
    node.type = 'sequential'
    node.next = next
    return node
  }

  // 'branch'
  const consequent = resolveBlockGraph(
    groups,
    statesName,
    switchLabel,
    endTotalState,
    result.terminal.consequentVector,
    memo,
    steps,
    keepReturnFlag,
  )
  const alternate = resolveBlockGraph(
    groups,
    statesName,
    switchLabel,
    endTotalState,
    result.terminal.alternateVector,
    memo,
    steps,
    keepReturnFlag,
  )
  if (!consequent || !alternate) {
    return null
  }
  node.type = 'branch'
  node.test = result.terminal.test
  node.consequent = consequent
  node.alternate = alternate
  return node
}

// `path.traverse(visitor)` only visits `path`'s *descendants*, never `path` itself - fine
// for a statement path (never itself a BinaryExpression/CallExpression), but a `branch`
// node's `test` or a `return` node's `argument` is an expression path, and can
// legitimately *be* the whole thing this visitor is looking for, with nothing wrapping
// it (e.g. the user's original code was `return 5;` or `return z;` - Stage 2's mangling
// and scope-member rewriting both apply anywhere, including a return argument with no
// statement wrapper around it). Apply the matching handler to the path itself first,
// then traverse its (possibly now-replaced) descendants. Shared by both
// `undoLiteralEntanglementInGraph` and `flattenScopeMembersInGraph` below - neither is
// literal-specific despite the name history.
//
// Takes a *factory*, not a visitor instance: Babel's `traverse()` mutates a visitor
// object in place the first time it's used (exploding each `Type(path){}` method into an
// internal `{enter:[...], exit:[...]}` shape), so reusing one instance across both the
// raw `visitor[path.node.type]` lookup below and a `.traverse()` call - or across more
// than one `.traverse()` call - breaks the lookup on the second use. A fresh, never-yet-
// traversed instance per call sidesteps that entirely.
function applyVisitor(path, makeVisitor) {
  const visitor = makeVisitor()
  const handler = visitor[path.node.type]
  if (handler) {
    handler(path)
  }
  path.traverse(visitor)
}

/**
 * Undoes literal entanglement (control-flow.js's `makeLiteralResolverVisitor`) over an
 * entire resolved block graph, in place, using each node's own `vector` - the link
 * between the two halves: the literal resolver and the graph walker are each
 * independently testable without the other, but only the walker can actually supply the
 * per-block vector the resolver needs. `xorFnName`/`stringsBlob`
 * are the same program-wide constants `makeLiteralResolverVisitor` already accepts
 * (omit to only undo numbers/booleans).
 *
 * Visits each node once even when `resolveBlockGraph`'s memoization means multiple
 * parents share the same node object (a branch's two arms reconverging) - safe to do
 * only because a shared node was reached with exactly one vector by construction (that's
 * what the memo key *is*), so there's no "which vector applies" ambiguity to resolve.
 */
function undoLiteralEntanglementInGraph(
  root,
  { statesName, xorFnName, stringsBlob },
) {
  const visited = new Set()

  function visit(node) {
    if (!node || visited.has(node)) {
      return
    }
    visited.add(node)

    if (node.vector) {
      const makeVisitor = () =>
        makeLiteralResolverVisitor({
          statesName,
          stateValues: node.vector,
          xorFnName,
          stringsBlob,
        })
      for (const stmtPath of node.statements) {
        applyVisitor(stmtPath, makeVisitor)
      }
      if (node.type === 'branch') {
        applyVisitor(node.test, makeVisitor)
      } else if (node.type === 'return' && node.argument) {
        applyVisitor(node.argument, makeVisitor)
      }
    }

    if (node.type === 'sequential') {
      visit(node.next)
    } else if (node.type === 'branch') {
      visit(node.consequent)
      visit(node.alternate)
    }
  }

  visit(root)
}

/**
 * Matches one `scopeName[scopeProperty][varName]` read/write chain - Stage 2's
 * identifier -> scope-member-expression rewrite. `scope` is a flat dictionary keyed
 * by *scope*, not a nested-per-ancestor structure despite the "chained via
 * ScopeManager.parent" framing that suggested otherwise: `getObjectExpression` walks the
 * scope-parent chain only to collect every ancestor scope's own `propertyName` into one
 * flat object, so every real reference - from any nesting depth - is exactly this same
 * two-level shape, never deeper and never shallower. Both keys are expected to already be
 * plain compile-time strings (`readScopeMemberKey` - bracketed `StringLiteral`, or the
 * dot-notation `Identifier` form `minify` rewrites it to when the key is a valid identifier
 * name), not still-mangled XOR calls - callers should run `undoLiteralEntanglementInGraph`
 * first, since Stage 2's generic `StringLiteral` handling applies to these key strings
 * exactly like any other string in the block (which makes it traversal-order dependent),
 * and this function intentionally doesn't also undo that -
 * one job each, same as the rest of this file.
 */
function matchScopeMemberChain(path, scopeName) {
  const varName = readScopeMemberKey(path)
  if (varName === null) {
    return null
  }
  const innerPath = path.get('object')
  const scopeProperty = readScopeMemberKey(innerPath)
  if (scopeProperty === null) {
    return null
  }
  const innerObj = innerPath.get('object')
  if (!innerObj.isIdentifier({ name: scopeName })) {
    return null
  }
  return { scopeProperty, varName }
}

/**
 * Undo the `this`-guard ControlFlowFlattening wraps a rewritten callee in.
 *
 * When it moves a variable into its scope object it re-spells every read as
 * `scope["a"]["b"]`, and a *direct call* of one then has to be re-guarded, because
 * `scope.a.b()` would pass `scope.a` as `this` where the original passed none:
 * `controlFlowFlattening.ts` emits `(1, scope["a"]["b"])()` for exactly that
 * ("Preserve proper 'this' context when directly calling functions").
 *
 * The guard's whole reason is the member chain, and the visitor above has just replaced that
 * chain with a plain identifier - for which `(1, f)()` and `f()` are the same call. Leaving
 * it is not neutral: a later matcher reading a call site expects the reference in callee
 * position, and this puts a SequenceExpression there instead, which is what walked
 * `deDispatcherInit` past its own dispatcher's call sites. Unwrapping it here fixes every
 * such consumer at once rather than teaching each one the spelling.
 */
function unwrapThisGuardCallee(path) {
  const seq = path.parentPath
  if (!seq || !seq.isSequenceExpression()) {
    return
  }
  const expressions = seq.node.expressions
  if (expressions.length !== 2 || expressions[1] !== path.node) {
    return
  }
  if (!t.isNumericLiteral(expressions[0])) {
    return
  }
  if (seq.key !== 'callee' || !seq.parentPath.isCallExpression()) {
    return
  }
  seq.replaceWith(path.node)
}

function makeScopeFlattenVisitor(scopeName, nameFor) {
  return {
    MemberExpression(path) {
      const match = matchScopeMemberChain(path, scopeName)
      if (!match) {
        return
      }
      path.replaceWith(
        t.identifier(nameFor(match.scopeProperty, match.varName)),
      )
      path.skip()
      unwrapThisGuardCallee(path)
    },
  }
}

/**
 * Flattens every `scope[scopeProperty][varName]` chain in a resolved block graph back to
 * a plain identifier, in place - the step that turns
 * "correct but addressed through a scope object" into actually-readable output. Unlike
 * `undoLiteralEntanglementInGraph`, this needs state shared *across* the whole graph, not
 * per-node: the same `(scopeProperty, varName)` pair is read from multiple blocks (every
 * reference to one source-level variable), and every occurrence must resolve to the same
 * identifier, so naming happens through one shared `nameFor` cache for the whole walk
 * rather than a fresh visitor per node.
 *
 * The original source-level name is genuinely gone by this point - `varName` is already
 * the encoder's own generated replacement (`ScopeManager.getNewName`), not the user's
 * name - so this keeps that generated name as the new plain identifier rather than
 * inventing a fresh one, except where two *different* `(scopeProperty, varName)` pairs
 * would otherwise collide on the same `varName` (each `ScopeManager` generates names
 * independently, so two sibling scopes can each produce their own unrelated variable
 * both happening to be named e.g. `"x"`) - disambiguated with a numeric suffix.
 *
 * Returns the list of identifier names introduced *by this call*, in first-seen order -
 * useful for a later pass that still needs to build (e.g.) a `var a, b, c;` declaration
 * once the graph is reassembled into a real function body; this function only rewrites
 * reads, it doesn't insert declarations itself; assembling this DAG into a real AST is
 * `foldBranchesInGraph`/`emitChain`'s job further down.
 *
 * `pairNames`/`usedNames` default to a fresh cache per call (one flattened
 * function/program decoded standalone), but a caller decoding an outlined nested function
 * (see `decodeFlattenedFunction` below) passes the *same* maps across every function in
 * one CFF application: `getObjectExpression`'s ancestor-scope properties are copied by
 * reference using the exact same `scopeProperty` string, not renamed, so a variable closed
 * over by a nested function and a variable of the same pair read in an ancestor function
 * are - by construction - the identical pair, and must decode to the identical identifier
 * wherever either occurs. Sharing the cache gets that for free; the first call to see a
 * given pair is the one whose `introduced` list ends up "owning" its `var` declaration,
 * which also happens to match real JS scoping (a variable can only be declared in one
 * function's scope).
 */
function flattenScopeMembersInGraph(
  root,
  { scopeName, pairNames = new Map(), usedNames = new Set() },
) {
  const introduced = []

  function nameFor(scopeProperty, varName) {
    const key = `${scopeProperty}::${varName}`
    if (pairNames.has(key)) {
      return pairNames.get(key)
    }
    let candidate = varName
    let suffix = 2
    while (usedNames.has(candidate)) {
      candidate = `${varName}_${suffix}`
      suffix++
    }
    usedNames.add(candidate)
    pairNames.set(key, candidate)
    introduced.push(candidate)
    return candidate
  }

  const makeVisitor = () => makeScopeFlattenVisitor(scopeName, nameFor)

  const visited = new Set()
  function visit(node) {
    if (!node || visited.has(node)) {
      return
    }
    visited.add(node)

    for (const stmtPath of node.statements) {
      applyVisitor(stmtPath, makeVisitor)
    }
    if (node.type === 'branch') {
      applyVisitor(node.test, makeVisitor)
      visit(node.consequent)
      visit(node.alternate)
    } else if (node.type === 'return' && node.argument) {
      applyVisitor(node.argument, makeVisitor)
    } else if (node.type === 'sequential') {
      visit(node.next)
    }
  }

  visit(root)

  return introduced
}

/**
 * Walks every path a resolved block graph carries - each node's statements, a branch's
 * test, a `return`'s argument - applying `fn(path)`. Shares `flattenScopeMembersInGraph`'s
 * traversal shape (including its visit-once guard, for the same reconverging-arms reason)
 * without sharing its rewriting.
 */
function walkGraphPaths(root, fn) {
  const visited = new Set()

  function visit(node) {
    if (!node || visited.has(node)) {
      return
    }
    visited.add(node)

    for (const stmtPath of node.statements) {
      fn(stmtPath)
    }
    if (node.type === 'branch') {
      fn(node.test)
      visit(node.consequent)
      visit(node.alternate)
    } else if (node.type === 'return' && node.argument) {
      fn(node.argument)
    } else if (node.type === 'sequential') {
      visit(node.next)
    }
  }

  visit(root)
}

/**
 * Reads a one-level `<scopeName>[<key>] = {}` sub-scope initializer off a statement path,
 * returning its key. This is the encoder's own scope-object construction, *not* a variable
 * read: `matchScopeMemberChain` deliberately requires two levels
 * (`scope[scopeProperty][varName]`), so `flattenScopeMembersInGraph` never rewrites one of
 * these and it survives with the scope object's name still on it.
 */
function readScopeAnchorKey(stmtPath, scopeName) {
  if (!stmtPath.isExpressionStatement()) {
    return null
  }
  const expr = stmtPath.get('expression')
  if (!expr.isAssignmentExpression({ operator: '=' })) {
    return null
  }
  const right = expr.node.right
  if (!t.isObjectExpression(right) || right.properties.length !== 0) {
    return null
  }
  const left = expr.get('left')
  if (!left.isMemberExpression()) {
    return null
  }
  if (!left.get('object').isIdentifier({ name: scopeName })) {
    return null
  }
  return readScopeMemberKey(left)
}

/**
 * Drops the scope object's own `scope[k] = {}` sub-scope initializers once
 * `flattenScopeMembersInGraph` has rewritten every real read of that scope away.
 *
 * **Why this belongs here and not in the Program-level cleanup.** The scope object's
 * binding does not survive this decode - its parameter slot is replaced wholesale - so by
 * the time `cleanupOrphanedScopeAnchors` runs, `scope` in a leftover `scope.k = {}`
 * resolves *up the scope chain to an unrelated same-named entity*, whose references it then
 * weighs instead. Corpus-wide that made every surviving anchor decline on `escapes` (or
 * `opaqueKey`) and none on a genuine read of its own key: the guard was correct and the
 * entity was wrong. Here the name is not resolved at all - `scopeName` is the binding this
 * decode already resolved from the interpreter's own shape - so there is nothing to
 * misresolve. Fix it at the pass that produces the shape, not at the one it defeats.
 *
 * **Removal is a filter on the emitted array, not a tree mutation.** `foldBranchesInGraph`
 * reassembles the body from `node.statements` and discards the original block, so dropping
 * a statement here means not emitting it - there is no `path.remove()` and no scope work,
 * and therefore nothing for a later re-crawl to trip over.
 *
 * Fails closed as a whole rather than per-anchor: a bare `scopeName` reference means the
 * object escapes and its property set is observable, and an unreadable key means the live
 * set cannot be enumerated. Either way no anchor is dropped, because both make *every*
 * key's liveness unknown rather than one key's.
 */
function dropDeadScopeAnchorsInGraph(root, { scopeName }) {
  // Pass 1: the anchors, and the holder's own binding taken from one of them.
  const anchorNodes = new Set()
  let holderBinding
  walkGraphPaths(root, (path) => {
    if (readScopeAnchorKey(path, scopeName) === null) {
      return
    }
    anchorNodes.add(path.node)
    if (holderBinding === undefined) {
      holderBinding =
        path
          .get('expression')
          .get('left')
          .get('object')
          .scope.getBinding(scopeName) || null
    }
  })
  if (!anchorNodes.size) {
    return 0
  }

  // Pass 2: which keys are still read, and whether the holder escapes.
  const liveKeys = new Set()
  let bail = false
  walkGraphPaths(root, (path) => {
    const isAnchor = anchorNodes.has(path.node)
    const inspect = (idPath) => {
      if (!idPath.isIdentifier({ name: scopeName })) {
        return
      }
      // Declaration sites are not references. Without this, an unrelated `var <name>`,
      // a `function <name>(…)`, or a nested function's own parameter of the same name
      // all read as the holder being used as a bare value - which is a bail, so the
      // whole graph's anchors survive. That was 28 of 142 graphs with anchors, and it
      // is why `RenameVariables`' short colliding names make this the default case
      // rather than an edge one.
      if (!idPath.isReferencedIdentifier()) {
        return
      }
      // And a *reference* can still belong to a different, shadowing binding of the
      // same name. Compare against the holder's own binding rather than the text; only
      // when the holder has no resolvable binding at all does name matching stand in,
      // and then only to fail closed (an unrelated reference can add a live key or
      // force a bail, never authorise a drop).
      if (
        holderBinding &&
        idPath.scope.getBinding(scopeName) !== holderBinding
      ) {
        return
      }
      const parent = idPath.parentPath
      if (
        !parent ||
        !parent.isMemberExpression() ||
        parent.node.object !== idPath.node
      ) {
        // Passed, returned, or reflected over as a bare value.
        bail = true
        return
      }
      // An anchor's own left-hand side is the write being judged, not a read of it.
      if (isAnchor && parent.parentPath.node === path.node.expression) {
        return
      }
      const key = readScopeMemberKey(parent)
      if (key === null) {
        bail = true
        return
      }
      liveKeys.add(key)
    }
    inspect(path)
    path.traverse({ Identifier: inspect })
  })

  if (bail) {
    return 0
  }

  let dropped = 0
  const visited = new Set()
  const prune = (node) => {
    if (!node || visited.has(node)) {
      return
    }
    visited.add(node)
    node.statements = node.statements.filter((stmtPath) => {
      if (!anchorNodes.has(stmtPath.node)) {
        return true
      }
      const key = readScopeAnchorKey(stmtPath, scopeName)
      if (key === null || liveKeys.has(key)) {
        return true
      }
      dropped++
      return false
    })
    if (node.type === 'branch') {
      prune(node.consequent)
      prune(node.alternate)
    } else if (node.type === 'sequential') {
      prune(node.next)
    }
  }
  prune(root)

  return dropped
}

// How many distinct parent edges (a `sequential`'s `next`, or a `branch`'s `consequent`/
// `alternate`) point at each reachable node. A node reached only one way belongs
// entirely to its one parent and can be inlined there; a node reached two or more ways
// is a genuine merge point (the `afterPath` a real if/else's two arms both jump to) and
// must be emitted
// exactly once, after whichever construct produced the two incoming edges - not inlined
// into either arm, which would duplicate it. `end` nodes are never merge points in
// practice: `resolveBlockGraph` allocates a fresh `{type:'end'}` object every time a
// walk reaches `endTotalState` rather than sharing one, so two paths ending at "the
// function just terminates here" are never the *same* object even though they mean the
// same thing - harmless, since an `end` node carries no statements to double-emit.
function computeMergeRefCounts(root) {
  const refCounts = new Map()
  const visited = new Set()

  function visit(node) {
    if (!node || visited.has(node)) {
      return
    }
    visited.add(node)
    if (node.type === 'sequential') {
      refCounts.set(node.next, (refCounts.get(node.next) || 0) + 1)
      visit(node.next)
    } else if (node.type === 'branch') {
      refCounts.set(node.consequent, (refCounts.get(node.consequent) || 0) + 1)
      refCounts.set(node.alternate, (refCounts.get(node.alternate) || 0) + 1)
      visit(node.consequent)
      visit(node.alternate)
    }
  }

  visit(root)
  return refCounts
}

/**
 * Folds a resolved (and, in practice, already literal/scope-decoded) block graph back
 * into real `t.Statement[]` - the if-diamond-folding half of this module's two-phase
 * split. The DAG from `resolveBlockGraph` already carries every real block in execution
 * order with its branch and fallthrough targets tagged, so this step is a mechanical walk
 * rather than a fresh reversal problem - the hard part (telling a real branch from a
 * dead-code guard) already happened in `interpretBlockGroup`.
 *
 * Walks the DAG once via `emitChain`, converting each node type directly: `sequential`
 * statements append and continue via `next`; `return` statements append a real
 * `t.returnStatement`; `branch` recursively folds each arm on its own (each arm's own
 * `emitChain` call stops *before* consuming a merge-point node reached by more than one
 * parent - see `computeMergeRefCounts` - handing that node back as `stoppedAt` instead),
 * then emits one `t.ifStatement`, and continues the outer chain from whichever arm(s)
 * reported a `stoppedAt` (an arm that ends in `return` reports `null`, correctly opting
 * out of the merge - the classic guard-clause shape, `if(x){return a} b();`, needs `b()`
 * attached after the `if`, not inside a fabricated `else`).
 *
 * Fails closed (`null`) rather than guessing if the two arms of one branch disagree
 * about where they reconverge - both landing on a real (different) merge node, not one
 * of them terminating - since only *simple* forward-converging if-diamonds are an
 * established CFF output shape; anything shaped
 * differently than that is a sign something upstream was mis-resolved, not a shape this
 * function should silently paper over.
 */
function foldBranchesInGraph(root) {
  const refCounts = computeMergeRefCounts(root)

  // `{ statements, stoppedAt }` - `stoppedAt` is the merge-point node this chain was cut
  // off before (not consumed), or `null` if the chain ran to a true terminal (`return`/
  // `end`) instead.
  //
  // `skipFirstCheck` bypasses the merge check for only the very next node examined - true
  // for the whole DAG's own root (nothing points to it, so it can't itself be a merge
  // point) and, after resolving a branch, for the merge node that branch's two arms just
  // agreed on (this call now *owns* that continuation, so it's the one designated place
  // allowed to consume it). It is deliberately **not** left on for every recursive
  // `emitChain(current.consequent)`/`emitChain(current.alternate)` call: a branch's arm
  // can itself directly *be* a merge point shared with some other branch entirely (two
  // unrelated real if/else diamonds whose arms happen to land on the same next vector),
  // and that must still be caught, not unconditionally inlined into just one of them.
  function emitChain(startNode, skipFirstCheck) {
    const statements = []
    let current = startNode
    let first = skipFirstCheck

    while (current) {
      if (current.type === 'end') {
        return { statements, stoppedAt: null }
      }
      if (!first && refCounts.get(current) >= 2) {
        return { statements, stoppedAt: current }
      }
      first = false

      statements.push(...current.statements.map((p) => p.node))

      if (current.type === 'return') {
        // A `null` argument is an argument-less `return;` - see `parseReturnValue`.
        statements.push(
          t.returnStatement(current.argument ? current.argument.node : null),
        )
        return { statements, stoppedAt: null }
      }

      // A `throw` node's own ThrowStatement was already pushed with the rest of its
      // statements above, so there is nothing to append - it just ends the chain, opting out
      // of any merge point exactly as a `return` does.
      if (current.type === 'throw') {
        return { statements, stoppedAt: null }
      }

      if (current.type === 'branch') {
        const consequent = emitChain(current.consequent, false)
        if (!consequent) {
          return null
        }
        const alternate = emitChain(current.alternate, false)
        if (!alternate) {
          return null
        }
        if (
          consequent.stoppedAt &&
          alternate.stoppedAt &&
          consequent.stoppedAt !== alternate.stoppedAt
        ) {
          return null
        }
        statements.push(
          t.ifStatement(
            current.test.node,
            t.blockStatement(consequent.statements),
            alternate.statements.length > 0
              ? t.blockStatement(alternate.statements)
              : null,
          ),
        )
        current = consequent.stoppedAt || alternate.stoppedAt
        first = true
        continue
      }

      // 'sequential'
      current = current.next
    }

    return { statements, stoppedAt: null }
  }

  const result = emitChain(root, true)
  return result && result.statements
}

/**
 * Builds the `var a, b, c;` declaration for the identifiers `flattenScopeMembersInGraph`
 * introduced - it only rewrites `scope[...][...]` reads to bare identifiers, it doesn't
 * declare them, since there's no real function body to declare into until
 * `foldBranchesInGraph` produces one. Every one of these was a `var`/`let`/`const` local
 * to the flattened function before Stage 2 rewrote it into a scope member expression;
 * `var` is used here regardless of the original kind, since
 * that distinction doesn't survive CFF either and `var`'s function-wide hoisting is what
 * the flattened function's own single-scope shape actually needs. Returns `null` for an
 * empty list rather than an empty `var;` declaration (not valid JS on its own).
 */
function declareIntroducedVariables(names) {
  if (names.length === 0) {
    return null
  }
  return t.variableDeclaration(
    'var',
    names.map((name) => t.variableDeclarator(t.identifier(name))),
  )
}

/**
 * Matches one outlined-nested-function wrapper's `FunctionExpression`:
 * `function(...restName){ return mainFnName(vector,
 * scopeObjExpr, runtimeIdent, restName) }`. This is what a hoisted `function fnName(...){}`
 * declaration becomes after CFF outlines it into the *same* shared switch/case table as
 * whatever function it was originally nested inside - re-verified against real encoder
 * output (not just source): the wrapper doesn't stay a separate top-level `var fnName =
 * function(){...}` the way `createCallExpression`'s call site alone might suggest, because
 * that declarator's own `id` is itself just another local of the *outer* flattened
 * function, so Stage 2's generic Identifier pass sweeps it up too - by the time this
 * matcher runs (after `flattenScopeMembersInGraph`), it reads back as an ordinary
 * `plainIdentifier = function(...){...}` assignment sitting in the outer function's own
 * statement list, not any special top-level shape. `runtimeName` is optional (an extra
 * cross-check, not load-bearing for correctness the way the other three are - see
 * `findOutlinedFunctionWrappers`).
 *
 * The `scopeObjExpr` argument (an ancestor-property-forwarding object literal, per
 * `ScopeManager.getObjectExpression`) is deliberately *not* inspected here: its ancestor
 * values are always a 1-level `scopeName["X"]` read (never the 2-level
 * `scopeName["X"]["Y"]` chain `flattenScopeMembersInGraph` matches), so it's inert either
 * way, and `mainFnName` is a per-CFF-application placeholder identifier unique enough on
 * its own that a `CallExpression` to it can only be one of two things by construction: the
 * one entry call site, or exactly this wrapper shape - no ambiguity that inspecting the
 * scope argument's contents would help resolve.
 *
 * Tolerates an optional leading debug-string-literal statement (`isDebug` builds prefix a
 * `"Calling X, Label: Y"` expression statement before the `return`) since it costs nothing
 * to accept and this matcher would otherwise be the one place that silently breaks under
 * `isDebug: true` output.
 */
function matchOutlinedFunctionWrapper(
  functionExprPath,
  { mainFnName, runtimeName },
) {
  const params = functionExprPath.get('params')
  if (
    params.length !== 1 ||
    !params[0].isRestElement() ||
    !params[0].get('argument').isIdentifier()
  ) {
    return null
  }
  const restName = params[0].get('argument').node.name

  const bodyStmts = functionExprPath.get('body.body')
  const stmts =
    bodyStmts.length === 2 &&
    bodyStmts[0].isExpressionStatement() &&
    bodyStmts[0].get('expression').isStringLiteral()
      ? bodyStmts.slice(1)
      : bodyStmts
  if (stmts.length !== 1 || !stmts[0].isReturnStatement()) {
    return null
  }

  const callPath = stmts[0].get('argument')
  if (!callPath.isCallExpression()) {
    return null
  }
  // The callee is either a bare `mainFnName(...)` or the `(1, mainFnName)(...)` comma-guard -
  // the latter is what an *inline* flattened function's own nested wrappers use, where the
  // outlined wrapper re-enters an inline `var = function(...){}` shared interpreter rather
  // than a top-level `_main` FunctionDeclaration.
  const callee = resolveGuardedCallee(callPath.get('callee'))
  if (!callee || !callee.isIdentifier({ name: mainFnName })) {
    return null
  }

  const args = callPath.get('arguments')
  if (args.length !== 4 || !args[0].isArrayExpression()) {
    return null
  }
  const entryVector = decompressStateVector(args[0])
  if (!entryVector) {
    return null
  }

  if (runtimeName && !args[2].isIdentifier({ name: runtimeName })) {
    return null
  }
  if (!args[3].isIdentifier({ name: restName })) {
    return null
  }

  return { restName, entryVector }
}

/**
 * Finds every outlined-nested-function wrapper reachable in a resolved block graph -
 * `matchOutlinedFunctionWrapper`'s search step. Walks the DAG the same memoized,
 * visit-once-per-node way as `flattenScopeMembersInGraph`/`undoLiteralEntanglementInGraph`,
 * and within each node checks `statements` plus (`branch`) `test` or (`return`)
 * `argument` - matching those two functions' own coverage, even though in practice a
 * wrapper is only ever produced as a plain assignment statement, never inline as a branch
 * test or return value; being thorough here costs nothing.
 *
 * Uses `applyVisitor` (not a bare shared visitor object) for the same reason those two
 * functions do: Babel mutates a visitor object in place the first time it's traversed
 * with, so reusing one `FunctionExpression` handler across more than one `.traverse()`
 * call would silently stop matching after the first statement.
 */
function findOutlinedFunctionWrappers(root, { mainFnName, runtimeName }) {
  const found = []
  const visited = new Set()

  const makeVisitor = () => ({
    FunctionExpression(path) {
      const match = matchOutlinedFunctionWrapper(path, {
        mainFnName,
        runtimeName,
      })
      if (match) {
        found.push({ functionPath: path, ...match })
        path.skip()
      }
    },
  })

  function visit(node) {
    if (!node || visited.has(node)) {
      return
    }
    visited.add(node)

    for (const stmtPath of node.statements) {
      applyVisitor(stmtPath, makeVisitor)
    }
    if (node.type === 'branch') {
      applyVisitor(node.test, makeVisitor)
      visit(node.consequent)
      visit(node.alternate)
    } else if (node.type === 'return' && node.argument) {
      applyVisitor(node.argument, makeVisitor)
    } else if (node.type === 'sequential') {
      visit(node.next)
    }
  }

  visit(root)
  return found
}

/**
 * The capstone of the transition-graph module: given one flattened function's entry
 * vector, produces its complete decoded body - `var` declarations and all - recursively
 * decoding any outlined nested functions it contains too. This is the same six-function
 * pipeline the real-sample test already chains by hand (`resolveBlockGraph` ->
 * `undoLiteralEntanglementInGraph` -> `flattenScopeMembersInGraph` ->
 * `foldBranchesInGraph` -> `declareIntroducedVariables`), plus the new nested-function
 * step threaded through it, factored out so it can call itself: an outlined nested
 * function's own body is decoded by this exact same process, just starting from a
 * different vector, because an outlined nested function re-enters the *same* shared
 * switch/case table (`ctx.groups` etc. don't change across
 * the recursion, only the vector does).
 *
 * `ctx` carries everything constant across one CFF application: the dispatcher facts
 * (`groups`, `statesName`, `switchLabel`, `endTotalState`), the literal-entanglement
 * constants (`xorFnName`, `stringsBlob`), `scopeName`, `mainFnName`/`runtimeName` (for
 * finding nested wrappers), `argName` (the shared
 * dispatcher's own rest-parameter name, reused directly as the decoded nested function's
 * own rest parameter - see below), and the naming caches `pairNames`/`usedNames` that must
 * be shared across the whole recursion, not reset per call (see
 * `flattenScopeMembersInGraph`'s doc comment).
 *
 * For each nested wrapper found, this replaces the wrapper `FunctionExpression`'s params
 * and body *in place* with the decoded function - `argName` (already the identifier every
 * reference inside that decoded body uses to read its packed arguments, since it's the
 * shared dispatcher's own parameter name, not the wrapper's own placeholder rest-param
 * name) becomes the decoded function's real rest parameter, so no separate renaming pass
 * over the decoded body is needed to make it self-consistent.
 *
 * Only when the decoded body actually mentions it, though. A function the original source
 * declared niladic decodes to a body that reads nothing from the packed arguments, and
 * giving it `(...argName)` anyway invents a parameter the source never had - dropping it is
 * free (a rest parameter contributes nothing to `fn.length`, and an uncalled name cannot be
 * observed) and leaving it in is not, since it re-spells a niladic function as a variadic
 * one and every later matcher reading for the niladic shape declines. That is an Upstream
 * Effect of *ours*, fixed here at the pass that emits it rather than tolerated in each
 * matcher it defeats, the same as `dropTrailingDeadReturn` above.
 *
 * Returns `null` (never a partial body) if any step - including a nested function's own
 * decode - fails, matching every other function in this module's fail-closed convention.
 */
/**
 * Drop a trailing `return;` / `return undefined;` from a reconstructed function body.
 *
 * The graph carries a function's implicit "and then it ends" as an explicit `return` node,
 * so `emitChain` writes one out and every reconstructed body ends in a statement that does
 * exactly what falling off the end already does. It is dead in the strict sense - last
 * statement of the body, no argument or an `undefined` one - so removing it is free, and
 * leaving it in is not: it displaces the real last statement, which is how a downstream
 * matcher that addresses a template's roles from the end of the body sees a shape it cannot
 * recognise. That is an Upstream Effect of *ours*, and this is the pass that emits it, so it
 * is fixed here once rather than tolerated in each matcher it defeats.
 *
 * Only the value-less forms: a `return <something else>` at the end of a body is the
 * function's real result. `undefined` is read as the value, consistently with the
 * `isIdentifier({ name: 'undefined' })` tests elsewhere in this file.
 */
function dropTrailingDeadReturn(statements) {
  const last = statements[statements.length - 1]
  if (!t.isReturnStatement(last)) {
    return statements
  }
  if (
    last.argument !== null &&
    !t.isIdentifier(last.argument, { name: 'undefined' })
  ) {
    return statements
  }
  return statements.slice(0, -1)
}

/**
 * Does a nested function bind `name` as one of its own parameters?
 */
function paramsBindName(fnNode, name) {
  return fnNode.params.some((param) =>
    Object.hasOwn(t.getBindingIdentifiers(param), name),
  )
}

/**
 * Does any node in a reconstructed body actually *read* `name`, as opposed to merely
 * spelling it?
 *
 * The distinction is the whole point, and skipping it is not an edge case here: every
 * wrapper in one recursion is handed the *same* `ctx.argName` (the shared dispatcher's
 * rest-parameter name), so a nested wrapper does not merely happen to collide with its
 * parent's parameter - it binds the identical name by construction. A scan that counts any
 * `Identifier` therefore reports "used" for every function that merely *contains* another
 * decoded function, which is exactly the case the caller needs decided. Descending into a
 * function that rebinds the name is reading someone else's variable.
 *
 * Still deliberately crude in the safe direction. Only parameter shadowing is modelled - a
 * nested `var name` shadows too, and is treated as a use, which keeps a redundant parameter
 * rather than dropping one that is read. The statements are freshly built and not yet
 * attached to the tree, so there is no scope to ask; this walks plain nodes by
 * `t.VISITOR_KEYS`.
 */
function statementsMentionName(statements, name) {
  let found = false
  const visit = (node) => {
    if (found || !node || typeof node.type !== 'string') return
    if (t.isFunction(node) && paramsBindName(node, name)) return
    if (node.type === 'Identifier' && node.name === name) {
      found = true
      return
    }
    for (const key of t.VISITOR_KEYS[node.type] || []) {
      const child = node[key]
      if (Array.isArray(child)) {
        for (const item of child) visit(item)
      } else {
        visit(child)
      }
    }
  }
  for (const statement of statements) {
    visit(statement)
    if (found) return true
  }
  return false
}

function decodeFlattenedFunction(vector, ctx) {
  const {
    groups,
    statesName,
    switchLabel,
    endTotalState,
    mainFnName,
    runtimeName,
    argName,
    xorFnName,
    stringsBlob,
    scopeName,
    pairNames,
    usedNames,
    keepReturnFlag,
  } = ctx

  const graph = resolveBlockGraph(
    groups,
    statesName,
    switchLabel,
    endTotalState,
    vector,
    new Map(),
    { count: 0 },
    keepReturnFlag,
  )
  if (!graph) {
    return null
  }

  undoLiteralEntanglementInGraph(graph, { statesName, xorFnName, stringsBlob })
  const introduced = flattenScopeMembersInGraph(graph, {
    scopeName,
    pairNames,
    usedNames,
  })

  const wrappers = findOutlinedFunctionWrappers(graph, {
    mainFnName,
    runtimeName,
  })
  for (const wrapper of wrappers) {
    const body = decodeFlattenedFunction(wrapper.entryVector, ctx)
    if (body === null) {
      return null
    }
    wrapper.functionPath.node.params =
      argName && statementsMentionName(body, argName)
        ? [t.restElement(t.identifier(argName))]
        : []
    wrapper.functionPath.node.body = t.blockStatement(body)
  }

  // After the wrapper loop, not before it: an outlined wrapper's decoded body is spliced
  // into a node this graph already holds, so a scope reference surviving inside one is
  // reachable from here - and it has to be, since a single escaping reference is what
  // makes dropping any anchor unsafe.
  dropDeadScopeAnchorsInGraph(graph, { scopeName })

  const statements = foldBranchesInGraph(graph)
  if (!statements) {
    return null
  }
  const declaration = declareIntroducedVariables(introduced)
  return dropTrailingDeadReturn(
    declaration ? [declaration, ...statements] : statements,
  )
}

/**
 * Resolves the string-entanglement helper for one CFF application - the `_cff_xor` function
 * and the `_strings` blob it decodes out of - from a live call site inside `searchRoot`
 * (that application's own function). Stage 2 emits every entangled string as
 * `xor(<state arithmetic>, <numeric start>, <numeric length>)`
 * (`controlFlowFlattening.ts`'s StringLiteral handling), so a three-argument call whose
 * callee binds to a three-parameter function reading a Program-level string blob is that
 * helper and nothing else.
 *
 * Identification deliberately rests on the *binding and the blob*, not on how the start and
 * length arguments happen to be spelled. Requiring both to be `NumericLiteral`s looks like a
 * free extra check and is not: this runs before `undoLiteralEntanglementInGraph`, and by
 * then those two positions can hold plain arithmetic rather than literals. On the 96-sample
 * corpus that gate rejected the only call sites present in 6 of 21 search roots, each of
 * which then decoded with no helper at all - and a helper-less decode cannot resolve any
 * entangled key, which is what leaves `flattenScopeMembersInGraph` half-resolving a scope
 * chain and emitting a wrong program. Same class as every other name- or spelling-keyed
 * identification this file has had to replace with a structural one.
 *
 * Returns `null` when the application entangles no strings at all - a legitimate, common
 * case (a file using only number/boolean entanglement never gets the helper emitted), which
 * is why callers treat this as optional rather than fail-closed.
 *
 * Resolution is per *application*, not per Program: the helper is Program-wide, but looking
 * for it from a use site inside the application that needs it means one application finding
 * nothing can't affect any other. `xorFnName` comes back as a name only because that's the
 * shape `makeLiteralResolverVisitor` consumes downstream - it's the name of a binding we
 * resolved structurally, not a name we matched on.
 */
function resolveXorHelper(searchRoot) {
  let found = null
  searchRoot.traverse({
    CallExpression(path) {
      if (found) {
        return
      }
      const calleePath = path.get('callee')
      if (!calleePath.isIdentifier()) {
        return
      }
      const args = path.get('arguments')
      if (args.length !== 3) {
        return
      }
      const fnPath = resolveFunctionBinding(calleePath, calleePath.node.name)
      if (!fnPath || fnPath.node.params.length !== 3) {
        return
      }
      const blobPath = findProgramDatumRead(fnPath, 'StringLiteral')
      if (!blobPath) {
        return
      }
      found = {
        xorFnName: calleePath.node.name,
        stringsBlob: blobPath.node.value,
      }
    },
  })
  return found
}

/**
 * Reads one harness slot that the encoder emits as a single-declarator `var` statement,
 * accepting the two forms it can reach decode time in. `MovedDeclarations` (Order 25) runs
 * *after* ControlFlowFlattening (Order 24), and rewrites any single-declarator `var` into a
 * bare assignment - `var x;` becomes `x = undefined;`, `var x = init;` becomes `x = init;` -
 * hoisting the declaration itself to the top of the enclosing block or packing it into the
 * enclosing function's parameter list (`movedDeclarations.ts`'s `insertionMethod` split).
 * Either way the harness's own statement keeps its position and its value, so the slot is
 * still matchable; only its statement type changed.
 *
 * Returns `{ name, initPath }` - `initPath` is `null` only for a genuine `var x;` with no
 * initializer - or `null` if the statement is neither form. The two forms are read
 * independently per slot, since `MovedDeclarations` decides per declaration (its
 * `isDefinedAtTop` early-return can skip one slot while moving the other).
 */
function readHarnessSlot(stmt) {
  if (!stmt) {
    return null
  }
  if (stmt.isVariableDeclaration()) {
    if (stmt.node.declarations.length !== 1) {
      return null
    }
    const decl = stmt.get('declarations.0')
    if (!decl.get('id').isIdentifier()) {
      return null
    }
    const initPath = decl.get('init')
    return {
      name: decl.node.id.name,
      initPath: decl.node.init ? initPath : null,
    }
  }
  if (stmt.isExpressionStatement()) {
    const expr = stmt.get('expression')
    if (!expr.isAssignmentExpression({ operator: '=' })) {
      return null
    }
    const left = expr.get('left')
    if (!left.isIdentifier()) {
      return null
    }
    return { name: left.node.name, initPath: expr.get('right') }
  }
  return null
}

/**
 * Matches the fixed harness `post()`'s call-site wiring builds around every flattened
 * Program/Function's entry call - `post()`'s Program-level wiring, built from
 * `controlFlowFlattening.ts`'s `startProgramStatements` Template - the statement(s)
 * immediately following the `mainFnName` `FunctionDeclaration` in its own enclosing
 * block. Two shapes, matching the encoder's own `isTopLevel ? ... : ...` split:
 *
 * - Program level: no `didReturnVar`/`result` wiring at all (a Program can't `return`) -
 *   just the bare call as an `ExpressionStatement`.
 * - Function level: `var {didReturnVar}; var {result} = mainFnName(...); if
 *   ({didReturnVar}) { return {result}; }` - three statements, always all three together
 *   (`allowReturns` is true for every non-Program case, since `blockPath.find(p =>
 *   p.isFunction())` trivially finds `blockPath`'s own enclosing function).
 *
 * Both `var` statements are read through `readHarnessSlot`, so the post-`MovedDeclarations`
 * assignment form of either is matched too. The Program-level shape needs no such handling -
 * it is a bare call statement with no declaration for `MovedDeclarations` to move.
 *
 * `stmts` is the enclosing block's full statement-path list; `afterIndex` is where to
 * start looking (immediately after the matched `mainFnName` declaration). Returns `null`
 * on any shape mismatch - the encoder always emits one of these two exact shapes for a
 * genuine CFF application, so anything else means this `_main`-suffixed function isn't
 * actually one (vanishingly unlikely given the placeholder naming, but fail closed rather
 * than assume).
 */
function matchEntryHarness(stmts, afterIndex, mainFnName, isProgram) {
  if (isProgram) {
    const stmt = stmts[afterIndex]
    if (!stmt || !stmt.isExpressionStatement()) {
      return null
    }
    const callPath = stmt.get('expression')
    if (
      !callPath.isCallExpression() ||
      !callPath.get('callee').isIdentifier({ name: mainFnName })
    ) {
      return null
    }
    const args = callPath.get('arguments')
    if (args.length === 0 || !args[0].isArrayExpression()) {
      return null
    }
    return {
      statements: [stmt],
      vectorPath: args[0],
      didReturnName: null,
      resultName: null,
    }
  }

  const didReturnDeclStmt = stmts[afterIndex]
  const resultDeclStmt = stmts[afterIndex + 1]
  const ifStmt = stmts[afterIndex + 2]
  if (!didReturnDeclStmt || !resultDeclStmt || !ifStmt) {
    return null
  }

  const didReturnSlot = readHarnessSlot(didReturnDeclStmt)
  // `var {didReturnVar};` is emitted uninitialized; `MovedDeclarations` spells that same
  // slot `{didReturnVar} = undefined;` (`movedDeclarations.ts` substitutes the literal
  // identifier `undefined` for a missing init). Accept only those two - any other value
  // means this isn't the harness's flag slot.
  if (
    !didReturnSlot ||
    (didReturnSlot.initPath &&
      !didReturnSlot.initPath.isIdentifier({ name: 'undefined' }))
  ) {
    return null
  }
  const didReturnName = didReturnSlot.name

  const resultSlot = readHarnessSlot(resultDeclStmt)
  if (!resultSlot || !resultSlot.initPath) {
    return null
  }
  const resultName = resultSlot.name
  const callPath = resultSlot.initPath
  if (
    !callPath.isCallExpression() ||
    !callPath.get('callee').isIdentifier({ name: mainFnName })
  ) {
    return null
  }
  const args = callPath.get('arguments')
  if (args.length === 0 || !args[0].isArrayExpression()) {
    return null
  }

  if (!ifStmt.isIfStatement() || ifStmt.node.alternate) {
    return null
  }
  if (!ifStmt.get('test').isIdentifier({ name: didReturnName })) {
    return null
  }
  const consequentPath = ifStmt.get('consequent')
  const consequentStmts = consequentPath.isBlockStatement()
    ? consequentPath.get('body')
    : [consequentPath]
  if (consequentStmts.length !== 1 || !consequentStmts[0].isReturnStatement()) {
    return null
  }
  if (!consequentStmts[0].get('argument').isIdentifier({ name: resultName })) {
    return null
  }

  return {
    statements: [didReturnDeclStmt, resultDeclStmt, ifStmt],
    vectorPath: args[0],
    didReturnName,
    resultName,
  }
}

/**
 * Removes what removing the harness orphans. Both shapes are this module's own residue, and
 * both are dead only *because* the harness went - which is why this runs at the removal site
 * rather than in either matcher:
 *
 * - **The hoisted declarator.** `MovedDeclarations` (Order 25, after CFF's 24) rewrites the
 *   harness's own `var {didReturnVar};` / `var {result} = {mainFnName}(...)` into an
 *   assignment at the harness site plus a bare declarator pushed onto the enclosing block's
 *   first `var` statement (`movedDeclarations.ts`, Mechanism 1 - it merges into that
 *   statement rather than emitting its own, so this removes *declarators*, never statements).
 *   `matchEntryHarness` reads the assignment form and removes it; the declarator is not among
 *   the statements it matched, so it is left standing with nothing to initialize it.
 * - **The `didReturnVar = true` writes.** Stage 2 wraps every return in the flattened
 *   function as `(didReturnVar = true, value)`, including returns nested inside statements
 *   CFF never goto-converted (it converts `if`/`else` only, so a pre-existing `switch` is
 *   copied through whole). `parseReturnValue` only unwraps a return that is a direct member
 *   of a reconstructed block's statement list, so every nested one keeps its wrap.
 *
 * **Gated on the flag being unread, not on which decode path produced it.** Once the harness
 * is gone nothing reads the flag, which is exactly the condition that makes dropping its
 * writes unobservable. `decodeInlineFlattenedFunction` keeps its own harness and therefore
 * its own reader (`keepReturnFlag`), so its flag never reaches zero references and this
 * declines on it without needing to know it exists. Fail closed on any write that is not one
 * of Stage 2's return wraps: with no reader the value is unobservable, but an assignment can
 * still carry side effects, and dropping the declarator alone would turn the remaining writes
 * into implicit globals.
 */
function dropDeadHarnessSlot(blockPath, name) {
  if (!name) {
    return
  }
  const binding = blockPath.scope.getBinding(name)
  if (!binding || binding.references) {
    return
  }

  const wraps = []
  for (const write of binding.constantViolations) {
    if (!write.isAssignmentExpression({ operator: '=' })) {
      return
    }
    const seq = write.parentPath
    if (!seq.isSequenceExpression() || !seq.parentPath.isReturnStatement()) {
      return
    }
    const exprs = seq.get('expressions')
    if (exprs.length < 2 || exprs[0].node !== write.node) {
      return
    }
    wraps.push(seq)
  }

  for (const seq of wraps) {
    // Everything after the write is kept: only `expressions[0]` - the write to a binding
    // already confirmed unread - is dropped. The wrapped value is not always a single
    // expression, because a sequence nested inside the wrap is *flattened into it* rather
    // than kept as its own node: `Dispatcher` (Order 6) re-spells a call as
    // `(payload = [...args], dispatch(...))`, so wrapping that return produces one
    // three-element `(didReturnVar = true, payload = [...args], dispatch(...))`. Reading
    // `expressions[1]` as "the value" would have silently discarded the payload assignment
    // the call depends on, so this drops the head and rebuilds the tail.
    const rest = seq.node.expressions.slice(1)
    seq.replaceWith(rest.length === 1 ? rest[0] : t.sequenceExpression(rest))
  }
  // Re-checks the reference count against a fresh crawl before deleting, and leaves a slot
  // `MovedDeclarations` packed into a parameter instead (Mechanism 1's other insertion
  // method) alone - removing that would change the enclosing function's arity.
  safeDeleteNode(name, binding.path)
}

/**
 * Decodes one whole CFF application - the `mainFnName` `FunctionDeclaration` plus its
 * matched entry harness - into the replacement body for whatever Program/Function it
 * originally was. Builds the `ctx` `decodeFlattenedFunction` needs from `mainFnPath`'s own
 * params (fixed `states, scope[= startObj], runtime, ...arg` order) plus this
 * application's own string-entanglement helper (`resolveXorHelper`), then
 * decompresses the harness's own start vector and calls `decodeFlattenedFunction`.
 *
 * `isProgram` gets one extra correction Function-level bodies don't need: Stage 1's "last
 * top-level expression statement -> return" conversion exists only to express a
 * completion value inside the synthetic function body CFF builds even for a flattened
 * Program - a bare `return` at real Program top level is a syntax error, so if the decoded
 * body's own last statement is a `ReturnStatement` (which, by construction, it can only be
 * if that conversion fired), it's unwrapped back into a plain expression statement (or
 * dropped entirely if it had no argument) before splicing into the Program.
 */
function decodeControlFlowApplication(mainFnPath, harness, isProgram) {
  const dispatcher = parseDispatcher(mainFnPath)
  if (!dispatcher) {
    return null
  }

  const startVector = decompressStateVector(harness.vectorPath)
  if (!startVector) {
    return null
  }

  const scopeParam = mainFnPath.node.params[1]
  if (!scopeParam) {
    return null
  }
  const scopeName =
    scopeParam.type === 'AssignmentPattern'
      ? scopeParam.left.name
      : scopeParam.name
  const runtimeName = mainFnPath.node.params[2]?.name
  const argName = mainFnPath.node.params[3]?.name

  const groups = parseSwitchCaseGroups(dispatcher.switchPath)
  const xor = resolveXorHelper(mainFnPath)

  const body = decodeFlattenedFunction(startVector, {
    groups,
    statesName: dispatcher.statesName,
    switchLabel: dispatcher.switchLabel,
    endTotalState: dispatcher.endTotalState,
    mainFnName: mainFnPath.node.id.name,
    runtimeName,
    argName,
    xorFnName: xor ? xor.xorFnName : null,
    stringsBlob: xor ? xor.stringsBlob : null,
    scopeName,
    pairNames: new Map(),
    usedNames: new Set(),
  })
  if (!body) {
    return null
  }

  if (isProgram) {
    const last = body[body.length - 1]
    if (last && t.isReturnStatement(last)) {
      body[body.length - 1] = last.argument
        ? t.expressionStatement(last.argument)
        : t.emptyStatement()
    }
  }

  return body
}

/**
 * Reads the call harness the encoder wraps around a *dispatcher-nested inline* flattened
 * function's entry call. Same three-slot shape `matchEntryHarness` reads for a `_main`
 * application - `{flag}; {result} = <call>; if ({flag}) return {result};`, both `var` slots
 * accepted in either the declaration or the post-`MovedDeclarations` assignment spelling via
 * `readHarnessSlot` - with two differences that come from the inline fn being an *expression*
 * assigned to a local rather than a `FunctionDeclaration`:
 *
 * - the callee carries the `(1, fn)` comma guard the encoder emits to null `this`, so it is
 *   read through `resolveGuardedCallee` rather than as a bare Identifier;
 * - the `if` may carry an `else { return undefined; }` (or `else { return; }`, which is how
 *   `minify` respells it - the same two spellings `parseReturnValue` reads). That alternate is not in
 *   `controlFlowFlattening.ts`'s own harness Template (which emits no `else` at all) - it is
 *   what the enclosing function's *own* flattening leaves once this application's harness has
 *   been folded back into a linear block - but it is what real samples carry, so it is
 *   accepted and reported as `hasAlternate`. The caller compensates for it rather than
 *   ignoring it: the alternate returns `undefined` exactly when the interpreter body falls off
 *   its end, so a collapse that splices that body in has to end it with a `return;` of its own.
 *
 * `afterIndex` is where in `stmts` to start (the caller scans forward from the inline fn's
 * own statement, since `MovedDeclarations` can separate the two). Requires the call to pass
 * *only* the state vector: an entry call that also passed a scope/runtime/argument would make
 * those parameters live values the harness supplies, which is precisely what a collapse
 * cannot preserve. Returns `null` on any mismatch.
 */
function matchInlineEntryHarness(stmts, afterIndex, name) {
  const flagStmt = stmts[afterIndex]
  const callStmt = stmts[afterIndex + 1]
  const ifStmt = stmts[afterIndex + 2]
  if (!flagStmt || !callStmt || !ifStmt) {
    return null
  }

  const flagSlot = readHarnessSlot(flagStmt)
  if (
    !flagSlot ||
    (flagSlot.initPath &&
      !flagSlot.initPath.isIdentifier({ name: 'undefined' }))
  ) {
    return null
  }

  const resultSlot = readHarnessSlot(callStmt)
  if (!resultSlot || !resultSlot.initPath) {
    return null
  }
  const callPath = resultSlot.initPath
  if (!callPath.isCallExpression()) {
    return null
  }
  const callee = resolveGuardedCallee(callPath.get('callee'))
  if (!callee || !callee.isIdentifier({ name })) {
    return null
  }
  const args = callPath.get('arguments')
  if (args.length !== 1 || !args[0].isArrayExpression()) {
    return null
  }

  if (!ifStmt.isIfStatement()) {
    return null
  }
  if (!ifStmt.get('test').isIdentifier({ name: flagSlot.name })) {
    return null
  }
  const readSingle = (branchPath) => {
    if (!branchPath || !branchPath.node) {
      return null
    }
    const list = branchPath.isBlockStatement()
      ? branchPath.get('body')
      : [branchPath]
    return list.length === 1 ? list[0] : null
  }
  const consequent = readSingle(ifStmt.get('consequent'))
  if (
    !consequent ||
    !consequent.isReturnStatement() ||
    !consequent.get('argument').isIdentifier({ name: resultSlot.name })
  ) {
    return null
  }

  let hasAlternate = false
  if (ifStmt.node.alternate) {
    const alternate = readSingle(ifStmt.get('alternate'))
    if (!alternate || !alternate.isReturnStatement()) {
      return null
    }
    const alternateArg = alternate.get('argument')
    if (
      alternateArg.node &&
      !alternateArg.isIdentifier({ name: 'undefined' })
    ) {
      return null
    }
    hasAlternate = true
  }

  return {
    statements: [flagStmt, callStmt, ifStmt],
    callPath,
    flagName: flagSlot.name,
    resultName: resultSlot.name,
    hasAlternate,
  }
}

/** Whether `path` is `root` or lies inside its subtree. */
function isWithin(path, root) {
  return (
    path.node === root.node ||
    Boolean(path.findParent((p) => p.node === root.node))
  )
}

/**
 * Collapses the call harness left around an inline-flattened function whose interpreter has
 * just been decoded, splicing the decoded body straight into the enclosing block and deleting
 * the now-empty wrapper. This is the readability half of the inline-fn decode: without it a
 * correct, fully-decoded body still reads as a rest-param destructure, a ~100-element entry
 * vector and a completion-flag dance, and - because that vector is built from
 * `_cff_slice(...)` calls - it also keeps the Program-level `_cff_slice`/`_cff_sequence`
 * helpers referenced, so `cleanupOrphanedCffHelpers` correctly declines to remove them. The
 * orphaned helper is a *symptom* of this residue, not an independent defect.
 *
 * Deliberately a separate step run *after* `decodeInlineFlattenedFunction`'s replacement
 * rather than a mode of it. The decode keeps `keepReturnFlag: true` either way, so a failed
 * or declined collapse leaves exactly the output it produced before this existed; the flag
 * writes the harness was reading are stripped here instead, keyed on the harness's *own* flag
 * name, which is also what makes the strip precise (a nested outlined function's own returns
 * are never flag-wrapped, so they are untouched by construction).
 *
 * Fail-closed on everything that would make the splice observable (any one of these leaves
 * the tree exactly as the decode left it):
 *
 * - no harness in the enclosing block matching `matchInlineEntryHarness`;
 * - more than one live reference to the interpreter outside its own body, or one that isn't
 *   the harness's call - the collapse consumes the single entry it was decoded from, so a
 *   second caller would be left calling a deleted function;
 * - a completion-flag or result binding used anywhere but the harness and the interpreter;
 * - a surviving reference to the interpreter's own `states` parameter, which is the decode's
 *   own scaffolding and has no call-time value worth materializing;
 * - a lifted declaration whose name already resolves in the enclosing scope, which the splice
 *   would turn into a collision or a shadow.
 *
 * A surviving reference to `scope`/`runtime`/`arg` is *not* a bail. Those three have a
 * statically known call-time value here, because `matchInlineEntryHarness` only accepts an
 * entry call passing the state vector alone: destructuring `[states, scope = D, runtime, arg]`
 * out of a one-element rest array binds `scope` to its own default `D` and leaves the other
 * two `undefined`. So each one still referenced is re-declared at the top of the spliced body
 * with exactly that value. This is what keeps the collapse firing on the common shape where
 * `flattenScopeMembersInGraph` rewrote every two-level `scope[a][b]` chain but a bare
 * one-level `scope[a] = {}` write survived.
 */
function collapseInlineFlattenedFunction(match, name) {
  const fnStmt = match.fnPath.getStatementParent()
  if (!fnStmt) {
    return false
  }
  const block = fnStmt.parentPath
  if (!block.isBlockStatement() && !block.isProgram()) {
    return false
  }
  const stmts = block.get('body')
  const index = stmts.findIndex((p) => p.node === fnStmt.node)
  if (index < 0) {
    return false
  }

  // Scanned forward rather than read at `index + 1`: `MovedDeclarations` (Order 25) can
  // separate the interpreter's own statement from its harness, exactly as it does for a
  // `_main` application (see `decodeControlFlowFlatteningInBlock`). The match keys on `name`,
  // so a scan cannot pick up a different interpreter's harness.
  let harness = null
  for (let j = index + 1; j < stmts.length && !harness; j++) {
    harness = matchInlineEntryHarness(stmts, j, name)
  }
  if (!harness) {
    return false
  }

  block.scope.getProgramParent().crawl()

  const fnBinding = block.scope.getBinding(name)
  if (!fnBinding) {
    return false
  }
  const external = fnBinding.referencePaths.filter(
    (refPath) => !isWithin(refPath, match.fnPath),
  )
  if (external.length !== 1 || !isWithin(external[0], harness.callPath)) {
    return false
  }
  // The interpreter's own statement has to be nothing but its assignment, since the splice
  // removes the statement whole (a `var name = function ...` declarator is removed on its own
  // instead, so a shared declaration is fine there).
  const assignPath = match.fnPath.parentPath
  if (
    assignPath.isAssignmentExpression() &&
    !(
      fnStmt.isExpressionStatement() &&
      fnStmt.node.expression === assignPath.node
    )
  ) {
    return false
  }

  const confined = (refPath) =>
    isWithin(refPath, match.fnPath) ||
    harness.statements.some((stmt) => isWithin(refPath, stmt))
  const outerDeclarators = []
  for (const slotName of [harness.flagName, harness.resultName]) {
    const binding = block.scope.getBinding(slotName)
    if (
      !binding ||
      !binding.referencePaths.every(confined) ||
      !binding.constantViolations.every(confined)
    ) {
      return false
    }
    if (binding.path.isVariableDeclarator()) {
      outerDeclarators.push(binding.path)
    }
  }
  if (fnBinding.path.isVariableDeclarator()) {
    outerDeclarators.push(fnBinding.path)
  }

  // Split the interpreter's own parameters into the dead ones (whose hoisted declarator goes
  // with it) and the ones the decoded body still reads (re-declared with their call-time
  // value, see above). Every one of the four is bound by the same hoisted `var`, so each
  // declarator path is collected now and removed later - the destructure that writes them is
  // about to go, and a binding re-read across that removal is no longer resolvable.
  const elements = match.destructurePath.get('left').get('elements')
  const valueFor = (slot) => {
    const el = elements[slot]
    return el && el.isAssignmentPattern() ? t.cloneNode(el.node.right) : null
  }
  const droppedNames = new Set([match.restName])
  const paramDeclarators = []
  const revived = []
  for (const [slot, paramName] of [
    [0, match.statesName],
    [1, match.scopeName],
    [2, match.runtimeName],
    [3, match.argName],
  ]) {
    if (!paramName) {
      continue
    }
    const binding = match.fnPath.scope.getBinding(paramName)
    if (!binding || !binding.path.isVariableDeclarator()) {
      return false
    }
    if (binding.references) {
      // `states` is the decode's own scaffolding - a surviving read of it means the walk left
      // state arithmetic behind, and there is no call-time value worth reconstructing.
      if (slot === 0) {
        return false
      }
      revived.push(
        t.variableDeclarator(t.identifier(paramName), valueFor(slot)),
      )
    } else {
      droppedNames.add(paramName)
    }
    paramDeclarators.push(binding.path)
  }

  // Everything the interpreter's own scope binds - minus what is dropped along with it -
  // becomes a declaration of the enclosing function once spliced.
  const targetScope =
    block.scope.getFunctionParent() || block.scope.getProgramParent()
  for (const bound of Object.keys(match.fnPath.scope.bindings)) {
    if (droppedNames.has(bound)) {
      continue
    }
    if (targetScope.hasBinding(bound, true)) {
      return false
    }
  }

  // The harness's `if (flag)` is going away, so the writes feeding it go with it.
  match.fnPath.get('body').traverse({
    ReturnStatement(path) {
      const argPath = path.get('argument')
      if (!argPath.node || !argPath.isSequenceExpression()) {
        return
      }
      const exprs = argPath.get('expressions')
      if (exprs.length !== 2) {
        return
      }
      const write = exprs[0]
      if (
        !write.isAssignmentExpression({ operator: '=' }) ||
        !write.get('left').isIdentifier({ name: harness.flagName }) ||
        !write.get('right').isBooleanLiteral({ value: true })
      ) {
        return
      }
      argPath.replaceWith(exprs[1].node)
    },
  })

  // Nothing above this line mutates: every check has run and every path that has to be
  // deleted is already in hand. Deletion is by the paths collected above rather than through
  // `safeDeleteNode`, whose reference-count re-check would add nothing here - the counts were
  // just verified, which is the whole reason, and it is a preference rather than a
  // requirement. `safeDeleteNode` is safe to call after a wrapper-body rewrite: its re-crawl
  // rebuilds the scope correctly from the new body, and the case where the rewrite dropped
  // the name outright now declines instead of dereferencing undefined.
  match.destructurePath.getStatementParent().remove()
  for (const declaratorPath of paramDeclarators) {
    if (!declaratorPath.removed) {
      declaratorPath.remove()
    }
  }

  const lifted = [...match.fnPath.node.body.body]
  if (revived.length) {
    lifted.unshift(t.variableDeclaration('var', revived))
  }
  const anchor = harness.statements[0]
  // `else { return; }` returns undefined exactly where the interpreter body runs off its end;
  // spliced into the enclosing block that would instead fall through to whatever follows.
  //
  // Unless there is nothing to fall through *to*: when the harness is the tail of a function
  // body, running off the end already returns undefined, and the appended `return;` is dead.
  // Not merely redundant - it displaces the real last statement, which is what a matcher
  // reading a template's roles from the end of a body has to see, and `deDispatcherInit`'s
  // does. Same Upstream Effect as `dropTrailingDeadReturn`'s, one splice later.
  const stmtList = anchor.container
  const lastHarnessNode = harness.statements[harness.statements.length - 1].node
  const fallsThrough = !(
    Array.isArray(stmtList) &&
    stmtList[stmtList.length - 1] === lastHarnessNode &&
    anchor.parentPath.isBlockStatement() &&
    anchor.parentPath.parentPath.isFunction()
  )
  if (
    harness.hasAlternate &&
    fallsThrough &&
    !t.isReturnStatement(lifted[lifted.length - 1])
  ) {
    lifted.push(t.returnStatement())
  }

  for (const stmt of harness.statements.slice(1).reverse()) {
    stmt.remove()
  }
  if (assignPath.isAssignmentExpression()) {
    fnStmt.remove()
  }
  for (const declaratorPath of outerDeclarators) {
    if (!declaratorPath.removed) {
      declaratorPath.remove()
    }
  }
  anchor.replaceWithMultiple(lifted)
  block.scope.getProgramParent().crawl()
  return true
}

/**
 * Decodes one inline-flattened function - the
 * `<name> = function (...rest) { var ...; [states, scope = {...}, runtime, arg] = rest;
 *  while (sum(states) !== end) switch (...) {...} }` shape `matchInlineFlattenedFunction`
 * detects: the multi-entry shared interpreter a dispatcher-nested function collapses to.
 *
 * Unlike a `_main` application (a FunctionDeclaration + call harness that
 * `decodeControlFlowApplication` inlines wholesale), an inline fn is decoded *in place* first:
 * its `scope`/`runtime`/`arg` are values its caller passes and the decoded body may still read
 * them, so only the `while`/`switch` interpreter statement is replaced and the rest-param
 * unpack that binds those names is left standing. `collapseInlineFlattenedFunction` then tries
 * to fold the whole wrapper away, which succeeds exactly when the decode left those parameters
 * dead - see there for the conditions and for why it is a second step rather than a mode.
 *
 * The entry vector is the fn's *external* call site: `collectInlineEntryVectors` with the fn's
 * own body excluded, so the in-body self-calls (its fresh-scope nested wrappers, decoded in
 * place by `decodeFlattenedFunction`'s `findOutlinedFunctionWrappers` recursion) don't count.
 * Fail-closed: needs exactly one distinct external entry vector and a successful
 * `decodeFlattenedFunction`, else nothing changes and it returns `false`. (One distinct
 * external entry matches every real sample seen; a genuine multi-external-entry inline fn -
 * not yet observed - is left untouched rather than mis-decoded from an arbitrary one.)
 */
function decodeInlineFlattenedFunction(match, searchRoot) {
  const parent = match.fnPath.parentPath
  let name = null
  if (parent.isAssignmentExpression() && parent.get('left').isIdentifier()) {
    name = parent.node.left.name
  } else if (parent.isVariableDeclarator() && parent.get('id').isIdentifier()) {
    name = parent.node.id.name
  }
  if (!name) {
    return false
  }

  const externalVectors = collectInlineEntryVectors(searchRoot, name, {
    excludePath: match.fnPath,
  })
  if (externalVectors.length !== 1) {
    return false
  }

  const xor = resolveXorHelper(match.fnPath)

  const body = decodeFlattenedFunction(externalVectors[0], {
    groups: parseSwitchCaseGroups(match.switchPath),
    statesName: match.statesName,
    switchLabel: match.switchLabel,
    endTotalState: match.endTotalState,
    mainFnName: name,
    runtimeName: match.runtimeName,
    argName: match.argName,
    xorFnName: xor ? xor.xorFnName : null,
    stringsBlob: xor ? xor.stringsBlob : null,
    scopeName: match.scopeName,
    pairNames: new Map(),
    usedNames: new Set(),
    // An inline fn stays callable and its enclosing `if (flag) return ...` harness is not
    // removed, so its returns must keep the `didReturnVar = true` write (see parseReturnValue).
    keepReturnFlag: true,
  })
  if (!body) {
    return false
  }

  match.whilePath.replaceWithMultiple(body)
  match.fnPath.scope.crawl()
  collapseInlineFlattenedFunction(match, name)
  return true
}

/**
 * Finds and decodes every CFF application directly inside one Program/Function's own
 * body - the actual plugin entry point, called from a `Program`/`Function` `exit` visitor
 * (mirroring the encoder's own "every Program and every Function is visited independently
 * on exit", and this codebase's established `deDispatcherInit`-style
 * `'Program|Function': exit` pattern for transforms with the same "look at my own direct
 * children" shape).
 *
 * A candidate is identified by *shape*, not by the `_main` name suffix `identifier()` builds:
 * `parseDispatcher` already demands a FunctionDeclaration whose entire body is one
 * `while (sum(states) !== end) switch (sum(states)) {...}` interpreter loop, which is both a
 * stricter filter than the suffix and immune to `RenameVariables` scrambling the suffix away
 * (see `resolveFunctionBinding`). `matchEntryHarness` still takes the declaration's own name
 * to match its call site - that's a binding name read off the node in hand, not a match on
 * encoder-chosen text.
 *
 * Re-scans `block`'s statement list fresh after every successful replacement rather than
 * iterating a single snapshot, since `mainFnPath.replaceWithMultiple(body)` changes the
 * list's indices out from under any earlier snapshot. A candidate whose harness doesn't
 * match, or whose decode fails, is remembered by node identity (`failed`) so a fresh scan
 * doesn't re-attempt and loop on it forever while still giving every *other* match in the
 * same block its own chance.
 */
function decodeControlFlowFlatteningInBlock(blockPath) {
  const isProgram = blockPath.isProgram()
  const block = isProgram
    ? blockPath
    : blockPath.get('body').isBlockStatement()
      ? blockPath.get('body')
      : null
  if (!block) {
    return
  }

  const failed = new Set()

  for (;;) {
    const stmts = block.get('body')
    let mainFnPath = null
    let harness = null

    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i]
      if (
        !stmt.isFunctionDeclaration() ||
        !stmt.node.id ||
        failed.has(stmt.node) ||
        !parseDispatcher(stmt)
      ) {
        continue
      }
      // The encoder emits the harness immediately after the declaration, but
      // `MovedDeclarations` (Order 25) can separate them: packing the declaration into the
      // enclosing function's parameters relocates it to the top of the body while the
      // harness run stays put, and `moved-declarations.js` restores the declaration where
      // the guard stood rather than back at its original offset. The run itself always
      // stays contiguous (each statement is rewritten in place), so scan forward for its
      // start instead of assuming adjacency. `matchEntryHarness` keys on `mainFnName`, so a
      // scan cannot pick up a different application's harness.
      let match = null
      for (let j = i + 1; j < stmts.length && !match; j++) {
        match = matchEntryHarness(stmts, j, stmt.node.id.name, isProgram)
      }
      if (!match) {
        failed.add(stmt.node)
        continue
      }
      mainFnPath = stmt
      harness = match
      break
    }

    if (!mainFnPath) {
      return
    }

    const body = decodeControlFlowApplication(mainFnPath, harness, isProgram)
    if (!body) {
      failed.add(mainFnPath.node)
      continue
    }

    // Splice the decoded body in at the *harness*, not at the declaration: the harness is
    // where the flattened code actually ran, and once `MovedDeclarations` has been reversed
    // the two are no longer adjacent (the restored declaration sits wherever its packing
    // guard stood, typically the top of the enclosing body). Remove back-to-front - the
    // trailing harness statements first, then the declaration, which precedes the anchor in
    // every case since the harness is only ever scanned for *after* it.
    const anchor = harness.statements[0]
    for (const stmtPath of harness.statements.slice(1).reverse()) {
      stmtPath.remove()
    }
    mainFnPath.remove()
    anchor.replaceWithMultiple(body)
    block.scope.crawl()
    // After the crawl, so both slots are read against the body that actually landed.
    dropDeadHarnessSlot(block, harness.didReturnName)
    dropDeadHarnessSlot(block, harness.resultName)
  }
}

// The four magic constants `HashFunctionTemplate` (`controlFlowFlattening.ts`) seeds its state
// with. Nothing downstream of CFF in the encoder's order rewrites a numeric *value*, so these
// survive `minify` and `renameVariables` alike - unlike the helper's name, and unlike its local
// variable names, both of which are scrambled.
const CFF_HASH_CONSTANTS = [0x9e3779b9, 0x243f6a88, 0x6a09e667, 0x7f4a7c15]

/**
 * Recognizes one of the four Program-wide CFF runtime helpers `post()` prepends, by the fixed
 * *shape* `controlFlowFlattening.ts` emits rather than by the `_cff_*` name suffix
 * `identifier()` builds - the suffix is gone under `renameVariables` (see
 * `resolveFunctionBinding`), and this sweep's whole job is finding helpers that no longer have
 * a use site to be resolved from, so it can't borrow the use-site resolution the decode uses.
 *
 * Returns the Program-level data declarator this helper reads (`_cff_slice`'s `_cff_sequence`
 * array, `_cff_xor`'s `_strings` blob) so the caller can remove that too once the helper that
 * kept it alive is gone, `null` for a helper that reads no data, or `false` for "not a helper".
 */
function matchCffRuntimeHelper(fnPath) {
  const params = fnPath.node.params
  const body = fnPath.get('body')
  if (!body.isBlockStatement()) {
    return false
  }
  const stmts = body.get('body')

  // slice: `function (min, max) { return sequence["slice"](min, max) }` - a lone `return` of a
  // two-argument member call on a Program-level array.
  if (params.length === 2) {
    if (stmts.length !== 1 || !stmts[0].isReturnStatement()) {
      return false
    }
    const call = stmts[0].get('argument')
    if (
      !call.isCallExpression() ||
      call.node.arguments.length !== 2 ||
      !call.get('callee').isMemberExpression()
    ) {
      return false
    }
    return findProgramDatumRead(fnPath, 'ArrayExpression') || false
  }

  // xor: `function (key, start, length) { for (...) { ... strings["charCodeAt"](start + i) ... }
  // return result }` - the only three-parameter function that reads a Program-level string blob.
  if (params.length === 3) {
    if (!stmts.some((s) => s.isForStatement())) {
      return false
    }
    return findProgramDatumRead(fnPath, 'StringLiteral') || false
  }

  if (params.length !== 1) {
    return false
  }

  // hash: a straight-line integer scrambler, identified by its four seed constants.
  const seen = new Set()
  fnPath.traverse({
    NumericLiteral(path) {
      seen.add(path.node.value)
    },
  })
  if (CFF_HASH_CONSTANTS.every((c) => seen.has(c))) {
    return null
  }

  // sum: `function (array) { for (var sum = 0, i = 0; ...) ...; return sum }` - a body of
  // exactly one `for` plus one `return`, whose init declares the accumulator and the index.
  if (
    stmts.length === 2 &&
    stmts[0].isForStatement() &&
    stmts[1].isReturnStatement() &&
    stmts[0].get('init').isVariableDeclaration() &&
    stmts[0].node.init.declarations.length === 2
  ) {
    return null
  }

  return false
}

/**
 * Reference-count-gated cleanup of the Program-wide CFF helpers (`safeDeleteNode`), for helpers
 * left with zero references once every application that used them has been decoded (or once a
 * dispatcher-closure collapse lifted their last call site out). Safe to run unconditionally: a
 * helper still referenced by an application this pass couldn't decode is simply left in place.
 *
 * Identification is entirely by shape (`matchCffRuntimeHelper`); the data vars are found through
 * the helper that reads them rather than independently, which is why they're all collected
 * *before* anything is deleted - deleting `_cff_slice` first would take away the only structural
 * evidence of which array was its `_cff_sequence`. Functions are removed first even so, since a
 * helper's own read of a var would otherwise keep that var alive past the helper's removal.
 *
 * Known limit, accepted deliberately: a helper the encoder emitted with *zero* call sites (real
 * case - an unused `_cff_xor`, whose `_strings` blob is then read only from inside that dead
 * body) is dead before this decoder ever runs. Its shape still matches, so it is still removed
 * here; but nothing in this module can distinguish "orphaned by our decode" from "arrived
 * orphaned", and that distinction doesn't change the output either way.
 */
function cleanupOrphanedCffHelpers(programPath) {
  programPath.scope.crawl()

  const helperPaths = []
  const dataNodes = new Set()
  for (const stmt of programPath.get('body')) {
    if (!stmt.isFunctionDeclaration() || !stmt.node.id) {
      continue
    }
    const datum = matchCffRuntimeHelper(stmt)
    if (datum === false) {
      continue
    }
    helperPaths.push(stmt)
    if (datum) {
      dataNodes.add(datum.node)
    }
  }
  if (helperPaths.length === 0) {
    return
  }

  for (const stmt of helperPaths) {
    safeDeleteNode(stmt.node.id.name, stmt)
  }

  programPath.scope.crawl()
  for (const stmt of programPath.get('body')) {
    if (!stmt.isVariableDeclaration()) {
      continue
    }
    for (const declPath of stmt.get('declarations')) {
      const idPath = declPath.get('id')
      if (idPath.isIdentifier() && dataNodes.has(declPath.node.init)) {
        safeDeleteNode(idPath.node.name, declPath)
      }
    }
  }
}

/**
 * Removes the now-dead `scope[scopeProperty] = {}` initializers that
 * `flattenScopeMembersInGraph` leaves behind.
 *
 * That function rewrites every `scope[scopeProperty][varName]` chain to a plain
 * identifier, which is what makes the decoded output readable - but the statement
 * that *created* the scope-property object in the first place is an ordinary
 * sibling statement in the enclosing block, not part of the block graph it walks,
 * so it survives with no reader left. It is not merely cosmetic: the surviving
 * statement pads whatever block it sits in, and a later pass matching that block by
 * shape reads it as an extra statement it has no role for.
 *
 * Reference-count-gated, in the same spirit as `cleanupOrphanedCffHelpers` above,
 * and deliberately conservative on three counts, since the object being written to
 * can be the concealed-globals object rather than a private local:
 *
 *   - the holder must resolve to a binding in this file (never a true global),
 *   - every reference to the holder must be the object of a member access, so a
 *     holder that escapes as a value - passed, returned, reflected over - is left
 *     alone,
 *   - no member access anywhere may read that property, including through a
 *     computed key this pass cannot evaluate.
 *
 * Anything short of all three leaves the statement in place: a redundant statement
 * is a readability cost, dropping a live write is a correctness bug.
 */
// Identifiers a `X.prop = {}` write may legitimately target without any binding in
// this file. Everything else that is unbound at such a site is our own dissolved scope
// object - see the note at the collection site below.
const GLOBAL_HOLDERS = new Set([
  'globalThis',
  'global',
  'window',
  'self',
  'module',
  'exports',
  'process',
  'document',
  'navigator',
  'console',
])

function cleanupOrphanedScopeAnchors(programPath) {
  programPath.scope.crawl()

  // Collect the candidate statements first, then judge each holder from its own
  // *binding* rather than from its name. Keying on the name text would let an
  // unrelated same-named parameter in some nested scope disqualify the holder -
  // exactly the failure mode `RenameVariables` makes routine here, since it hands
  // out short random names that collide freely across scopes.
  const anchors = []
  programPath.traverse({
    ExpressionStatement(path) {
      const expr = path.get('expression')
      if (!expr.isAssignmentExpression({ operator: '=' })) {
        return
      }
      const left = expr.get('left')
      if (!left.isMemberExpression()) {
        return
      }
      const right = expr.node.right
      if (!t.isObjectExpression(right) || right.properties.length !== 0) {
        return
      }
      const objPath = left.get('object')
      if (!objPath.isIdentifier()) {
        return
      }
      const key = readScopeMemberKey(left)
      if (key === null) {
        return
      }
      const binding = objPath.scope.getBinding(objPath.node.name)
      if (binding) {
        anchors.push({ stmtPath: path, lhsNode: left.node, binding, key })
        return
      }
      // No binding at all. That is either a write to a real global - which must be
      // left alone, since its property set is observable outside this file - or an
      // anchor whose holder we dissolved: the scope object is a parameter of the CFF
      // main function, and when the decode relocates that function's body the anchor
      // statement travels with it while the parameter does not. The second case is a
      // guaranteed `ReferenceError` the moment the statement runs, so the statement
      // cannot be doing useful work and removing it restores the program rather than
      // changing it. Distinguished by name against the global allowlist only, because
      // there is nothing else left to ask: the binding that would have answered
      // structurally is precisely what went missing.
      if (!GLOBAL_HOLDERS.has(objPath.node.name)) {
        anchors.push({ stmtPath: path, lhsNode: left.node, binding: null, key })
      }
    },
  })

  // Per binding: which property keys are still read, whether any read went through
  // a key this pass cannot evaluate, and whether the holder ever escapes as a bare
  // value (passed, returned, reflected over) - in which case its property set is
  // observable and nothing about it may be dropped.
  const info = new Map()
  const infoFor = (binding) => {
    let entry = info.get(binding)
    if (!entry) {
      entry = { read: new Set(), opaqueKey: false, escapes: false }
      for (const refPath of binding.referencePaths) {
        const parent = refPath.parentPath
        if (
          !parent ||
          !parent.isMemberExpression() ||
          parent.node.object !== refPath.node
        ) {
          entry.escapes = true
          continue
        }
        const key = readScopeMemberKey(parent)
        if (key === null) {
          entry.opaqueKey = true
          continue
        }
        // An anchor's own left-hand side is the write being judged, not a read of it.
        if (anchors.some((a) => a.lhsNode === parent.node)) {
          continue
        }
        entry.read.add(key)
      }
      info.set(binding, entry)
    }
    return entry
  }

  for (const anchor of anchors) {
    if (anchor.stmtPath.removed) {
      continue
    }
    // An unbound holder has no references to weigh - the statement throws either way.
    if (!anchor.binding) {
      anchor.stmtPath.remove()
      continue
    }
    const entry = infoFor(anchor.binding)
    if (entry.escapes || entry.opaqueKey || entry.read.has(anchor.key)) {
      continue
    }
    anchor.stmtPath.remove()
  }
}

/**
 * Standalone visitor for `cleanupOrphanedScopeAnchors`. Deliberately *not* folded into
 * `deControlFlowFlatteningGraphInit`'s own `Program: exit` even though that pass is what
 * orphans the anchors: judging one dead requires reading every other member key on the
 * same holder, and at CFF-decode time those keys are still unevaluated
 * `{ph}_STR_N(a, b)` calls and unfolded concatenations - which the holder-escape guard
 * correctly treats as unreadable, declining every anchor. The keys become StringLiterals
 * only after the string layer's second visit, so the plugin schedules this there
 * instead. Same "reschedule, don't improve the matcher" shape as the second
 * DuplicateLiteralsRemoval visit.
 */
function deScopeAnchorCleanupInit() {
  return {
    Program: {
      exit(path) {
        cleanupOrphanedScopeAnchors(path)
      },
    },
  }
}

/**
 * A second `cleanupOrphanedCffHelpers` sweep, scheduled after the Dispatcher decode
 * (`deDispatcher`). That decode is what removes the dispatcher template, and the template is
 * routinely the last thing referencing a CFF runtime helper - so helpers that were still live
 * during the sweep inside `deControlFlowFlatteningGraphInit` only reach zero references here.
 * Reference-count-gated, so running it twice is free when nothing changed.
 *
 * This slot used to also run a narrow dispatcher-closure collapse of its own. That matcher was
 * unreachable: `deDispatcher` runs immediately before it and already reverses every call-site
 * spelling `createDispatcherCall` emits, so the collapse matched nothing - not on the corpus and
 * not on the fixture written for it.
 */
function deCffHelperCleanupInit() {
  return {
    Program: {
      exit(path) {
        cleanupOrphanedCffHelpers(path)
      },
    },
  }
}

/**
 * The plugin-facing visitor: decodes every CFF application anywhere in the file via
 * `decodeControlFlowFlatteningInBlock`. `Function: exit` handles every flattened
 * (non-Program) function body; `Program: exit` - which fires last, after every nested
 * `Function: exit` has already run its own replacement - handles the Program's own
 * top-level CFF application (if any) and cleans up the now-possibly-unreferenced shared
 * runtime helpers.
 *
 * There is deliberately no Program-level pre-pass collecting the shared `post()` helpers up
 * front any more. That pre-pass identified them by name suffix, so `RenameVariables` made it
 * return nothing and its `if (!programConstants) return` guard then failed *every*
 * application in the Program closed at once - a total non-decode that stayed invisible to
 * runtime-correctness checks because the undecoded fallback still runs. Each helper is now
 * resolved from its own use site, by the code that needs it, so there is no shared gate left
 * to fail: an application that can't resolve something fails alone.
 *
 * The cleanup is unconditional-but-safe rather than gated on "did every application in
 * this file succeed": `safeDeleteNode` already only removes a binding with zero remaining
 * references, so a helper still needed by some application this pass couldn't decode (an
 * unhandled shape, or a genuinely failed match) is simply left alone.
 *
 * Returns a fresh visitor object per call, matching this codebase's established `xInit()`
 * convention.
 */
function deControlFlowFlatteningGraphInit() {
  return {
    Program: {
      exit(path) {
        decodeControlFlowFlatteningInBlock(path)
        cleanupOrphanedCffHelpers(path)
      },
    },
    Function: {
      exit(path) {
        decodeControlFlowFlatteningInBlock(path)
        // An inline-flattened function IS itself a `Function`, so its own `exit` is where we
        // decode it. Its external call site lives in an enclosing
        // scope, so the whole Program is the search root for the entry vector.
        const inlineMatch = matchInlineFlattenedFunction(path)
        if (inlineMatch) {
          const program = path.findParent((p) => p.isProgram())
          decodeInlineFlattenedFunction(inlineMatch, program)
        }
      },
    },
  }
}

export default {
  decompressStateVector,
  applyStateMutations,
  evaluateBooleanExpression,
  parseSwitchCaseGroups,
  evaluateCaseTest,
  matchCaseGroup,
  parseWhileSwitch,
  parseDispatcher,
  matchInlineFlattenedFunction,
  matchScopeMemberInterpreter,
  readScopeMemberKey,
  matchScopeMemberChain,
  collectInlineEntryVectors,
  readGotoAssignments,
  matchGotoSequence,
  findGotoRunEnd,
  interpretBlockGroup,
  resolveBlockGraph,
  undoLiteralEntanglementInGraph,
  flattenScopeMembersInGraph,
  foldBranchesInGraph,
  declareIntroducedVariables,
  matchOutlinedFunctionWrapper,
  findOutlinedFunctionWrappers,
  decodeFlattenedFunction,
  resolveFunctionBinding,
  findProgramDatumRead,
  resolveXorHelper,
  matchCffRuntimeHelper,
  matchEntryHarness,
  dropDeadHarnessSlot,
  matchInlineEntryHarness,
  decodeControlFlowApplication,
  collapseInlineFlattenedFunction,
  decodeInlineFlattenedFunction,
  cleanupOrphanedCffHelpers,
  cleanupOrphanedScopeAnchors,
  deScopeAnchorCleanupInit,
  deCffHelperCleanupInit,
  decodeControlFlowFlatteningInBlock,
  deControlFlowFlatteningGraphInit,
}
