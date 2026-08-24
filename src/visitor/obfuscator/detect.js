import traverse from '@babel/traverse'
import * as t from '@babel/types'

import logger from '../../utility/logger.js'

const debugLog = logger.debugLog

/**
 * Locate javascript-obfuscator's string-array subsystem and resolve its entrypoint.
 *
 * **Detection is separated from decoding, and it is shape-first.** This file matches a union of
 * emitted shapes and hands back handles - the holder, every root calls wrapper, the rotator if
 * one is present, and the variable-form aliases. It does not decide, or even ask, which encoder
 * version produced the sample. The returned `signature` describes the shapes that matched for
 * diagnostics and development evidence; its correspondence with encoder eras stays in the
 * documentation rather than becoming runtime version logic.
 *
 * **Why the two are separated at all.** Fusing them makes a fingerprint miss indistinguishable
 * from "no string array present" - the two collapse into one falsy return, and the diagnostic a
 * user actually needs ("this looks like a string array, but the wrapper would not resolve")
 * cannot be produced. So this file reports three outcomes, never a boolean:
 *
 *   - `resolved`   - the entrypoint is complete and the decoder can run.
 *   - `absent`     - no string-array evidence at all. **A verdict, not a failure.** It is what
 *                    the terminating round of a peel loop is supposed to report, and it must not
 *                    read as a refusal.
 *   - `unreadable` - evidence is present and the entrypoint would not resolve. This is the
 *                    refusal, and it keeps its narrow meaning: a layer that is ours, which we
 *                    could not read.
 *
 * Separating `absent` from `unreadable` needs a second, deliberately weaker probe, because the
 * strict matchers cannot tell "nothing here" from "here but not in a shape I know" - see
 * `weakEvidence`.
 *
 * **Nothing here keys on identifier text.** `RenameIdentifiers` runs before every stage this
 * file reads, so no name in the subsystem is stable. Matching is on AST shape, and every
 * cross-reference is resolved through a binding rather than by comparing names.
 */

/* ------------------------------------------------------------------------- *
 * Shape helpers
 * ------------------------------------------------------------------------- */

const isStringArrayLiteral = (node) =>
  t.isArrayExpression(node) &&
  node.elements.length > 0 &&
  node.elements.every((element) => t.isStringLiteral(element))

/**
 * A string literal that JavaScript coerces to a number: `'0x151'`, `'42'`.
 *
 * `stringArrayIndexesType: 'hexadecimal-numeric-string'` emits the index as a *string* and lets
 * the arithmetic coerce it, so a wrapper's offset arrives spelled `param - '0x28b'` and a use site
 * spelled `-'0x151'`. Read as opaque, those are the whole of one option's output.
 */
function numericStringValue(node) {
  if (!t.isStringLiteral(node)) {
    return null
  }
  const text = node.value.trim()
  if (!/^[+-]?(0[xX][0-9a-fA-F]+|\d+(\.\d+)?)$/.test(text)) {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * Fold an arithmetic tree over numeric literals to its value.
 *
 * Required rather than convenient: `numbersToExpressions` re-spells every numeric constant as an
 * arithmetic tree, so a matcher demanding a `NumericLiteral` for the index shift reads it as
 * absent on exactly the high-strength samples that matter most. Folding matches the shape; testing
 * for a literal matches one spelling of it.
 *
 * A bare string literal is deliberately **not** folded here - see `foldCoerced`.
 */
function foldNumber(node) {
  if (t.isNumericLiteral(node)) {
    return node.value
  }
  if (t.isUnaryExpression(node) && node.operator === '-') {
    // Unary minus coerces unconditionally, so a numeric string is safe here whatever it wraps.
    const value = foldNumber(node.argument) ?? numericStringValue(node.argument)
    return value === null || value === undefined ? null : -value
  }
  if (t.isBinaryExpression(node)) {
    // **`+` concatenates when either operand is a string**, so a numeric string folds only under
    // the operators that coerce. Folding `1 + '0x2'` to 3 would be silently wrong output, which is
    // the one failure mode an evaluating decoder is supposed to be immune to.
    const coerces =
      node.operator === '-' || node.operator === '*' || node.operator === '/'
    const fold = (side) =>
      foldNumber(side) ?? (coerces ? numericStringValue(side) : null)
    const left = fold(node.left)
    const right = fold(node.right)
    if (left === null || right === null) {
      return null
    }
    switch (node.operator) {
      case '+':
        return left + right
      case '-':
        return left - right
      case '*':
        return left * right
      case '/':
        return left / right
      default:
        return null
    }
  }
  return null
}

/**
 * Fold an operand that sits in a **coercing** position - the right-hand side of a `-`, say.
 *
 * `foldNumber` deliberately does not accept a bare string literal at top level, because it has no
 * way of knowing whether its caller is in a `+`, where a numeric string concatenates instead of
 * coercing. A caller that does know its operator says so by using this.
 */
function foldCoerced(node) {
  return foldNumber(node) ?? numericStringValue(node)
}

/**
 * Flatten a function body's effects into a list of expressions.
 *
 * Adjacent-statement merging fuses the templates' statements into sequence expressions, so
 * counting statements in a body matches a spelling rather than a shape. Every matcher below reads
 * effects through this instead of indexing `body.body`.
 */
function bodyEffects(fnNode) {
  const flat = []
  const push = (expr) => {
    if (t.isSequenceExpression(expr)) {
      expr.expressions.forEach(push)
    } else {
      flat.push(expr)
    }
  }
  for (const statement of fnNode.body.body ?? []) {
    if (t.isExpressionStatement(statement)) {
      push(statement.expression)
    } else if (t.isReturnStatement(statement) && statement.argument) {
      push(statement.argument)
    }
  }
  return flat
}

/* ------------------------------------------------------------------------- *
 * The three components
 * ------------------------------------------------------------------------- */

/**
 * The holder, self-replacing-function form:
 *
 *     function F() { var A = ['…', '…']; F = function () { return A }; return F() }
 *
 * The first call builds the array and rewrites the binding to a closure returning it. The
 * self-reassignment is what distinguishes this from an ordinary function that happens to declare
 * an array, so it is required rather than incidental.
 */
function matchHolderFn(node) {
  if (!t.isFunctionDeclaration(node) || node.params.length !== 0 || !node.id) {
    return null
  }
  const selfName = node.id.name
  let literal = null
  let arrayName = null
  for (const statement of node.body.body) {
    if (!t.isVariableDeclaration(statement)) {
      continue
    }
    for (const declarator of statement.declarations) {
      if (
        isStringArrayLiteral(declarator.init) &&
        t.isIdentifier(declarator.id)
      ) {
        literal = declarator.init
        arrayName = declarator.id.name
      }
    }
  }
  if (!literal) {
    return null
  }
  const reassignsSelf = bodyEffects(node).some(
    (expr) =>
      t.isAssignmentExpression(expr) &&
      t.isIdentifier(expr.left, { name: selfName }) &&
      t.isFunctionExpression(expr.right),
  )
  if (!reassignsSelf) {
    return null
  }
  return { kind: 'fn-self-replacing', name: selfName, arrayName, literal, node }
}

/**
 * The holder, plain-declaration form: `var NAME = ['…', '…'];`
 *
 * Deliberately permissive here and filtered later. A hand-written `var parts = ['a','b','c']` has
 * this exact shape, so a match is only treated as the subsystem's holder once a wrapper indexes it
 * or a rotator rotates it - see `selectHolder`. Tightening at the match site instead would make
 * the two indistinguishable at the point where the reason is no longer visible.
 *
 * **Matched on the declarator, not on the declaration that contains it.** What this returns is
 * what the decoder removes, and `var a = 1, NAME = ['…'];` is a legal spelling - handing back the
 * declaration would take the sibling declarator with it. The extra `var` wrapper needed to
 * re-declare the array in an isolate is cheap to add back; a deleted sibling is not recoverable.
 */
function matchHolderVar(node) {
  if (
    !t.isVariableDeclarator(node) ||
    !isStringArrayLiteral(node.init) ||
    !t.isIdentifier(node.id)
  ) {
    return null
  }
  return {
    kind: 'var-declaration',
    name: node.id.name,
    arrayName: node.id.name,
    literal: node.init,
    node,
  }
}

/**
 * The root calls wrapper: two parameters, subtracts a constant from the first, indexes the array
 * with the result.
 *
 * One matcher covers all five wrapper eras, because what varies between them is *where* the body
 * lives and *how* it reaches the array, not what it does:
 *
 *   - the self-replacing eras hide the real body in an inner closure assigned to the binding, so
 *     the matcher looks through that assignment when it is present;
 *   - the array is reached either by reading an identifier directly, or by calling the holder,
 *     or - from the era where the holder became a function - by calling it once into a local that
 *     the body then indexes.
 *
 * Both facts are returned rather than branched on, since they are exactly the discriminators the
 * era table is keyed on.
 */
function matchWrapper(fnNode, selfName) {
  if (!fnNode || fnNode.params.length !== 2) {
    return null
  }

  const inner = bodyEffects(fnNode).find(
    (expr) =>
      t.isAssignmentExpression(expr) &&
      t.isIdentifier(expr.left, { name: selfName }) &&
      t.isFunctionExpression(expr.right),
  )
  const target = inner ? inner.right : fnNode

  let shift = null
  let reads = null
  traverse(
    t.file(
      t.program([
        t.expressionStatement(
          t.functionExpression(null, target.params, target.body),
        ),
      ]),
    ),
    {
      AssignmentExpression(path) {
        const { left, right } = path.node
        if (
          t.isIdentifier(left) &&
          t.isBinaryExpression(right, { operator: '-' }) &&
          t.isIdentifier(right.left, { name: left.name })
        ) {
          const value = foldNumber(right.right)
          if (value !== null) {
            shift = value
          }
        }
      },
      MemberExpression(path) {
        const { object, computed } = path.node
        if (!computed || reads) {
          return
        }
        if (t.isIdentifier(object)) {
          reads = { via: 'identifier', name: object.name }
        } else if (
          t.isCallExpression(object) &&
          t.isIdentifier(object.callee)
        ) {
          reads = { via: 'call', name: object.callee.name }
        }
      },
    },
  )

  // The era where the holder became a function hoists `var a = HOLDER();` into the outer body and
  // indexes the local. That reads as `via: 'identifier'` above, which would collide with the
  // eras that genuinely index a plain array binding - so resolve the local one step further.
  if (reads?.via === 'identifier') {
    for (const statement of fnNode.body.body ?? []) {
      if (!t.isVariableDeclaration(statement)) {
        continue
      }
      for (const declarator of statement.declarations) {
        if (
          t.isIdentifier(declarator.id) &&
          declarator.id.name === reads.name &&
          t.isCallExpression(declarator.init) &&
          t.isIdentifier(declarator.init.callee)
        ) {
          reads = { via: 'call-hoisted', name: declarator.init.callee.name }
        }
      }
    }
  }

  if (shift === null || !reads) {
    return null
  }
  return {
    kind: inner ? 'self-replacing' : 'plain',
    selfName,
    shift,
    reads,
    node: fnNode,
  }
}

/**
 * The rotator: an immediately-invoked two-parameter function that push/shifts the array in a loop
 * until a stop condition holds.
 *
 * **The IIFE is not necessarily the statement's whole expression.** Adjacent-statement merging
 * fuses it with whatever follows, so on a sample that also enables a timer the rotator arrives as
 * `(function (a, b) { … })(A, 0xb89ba), setInterval(…)`. A matcher reading `.expression` directly
 * reports the rotator ABSENT there - and that direction is the dangerous one, because a decode
 * that runs the holder and wrapper without the rotator returns real strings from an unrotated
 * array. Output then parses, runs, and reads clean on every residue axis while being wrong. So
 * the candidate list is flattened before matching.
 */
function matchRotator(statement) {
  if (!t.isExpressionStatement(statement)) {
    return null
  }
  const candidates = []
  const flatten = (expr) => {
    if (t.isSequenceExpression(expr)) {
      expr.expressions.forEach(flatten)
    } else if (t.isUnaryExpression(expr)) {
      flatten(expr.argument)
    } else {
      candidates.push(expr)
    }
  }
  flatten(statement.expression)
  for (const candidate of candidates) {
    const hit = matchRotatorCall(candidate, statement)
    if (hit) {
      return hit
    }
  }
  return null
}

function matchRotatorCall(call, statement) {
  if (!t.isCallExpression(call)) {
    return null
  }
  const fn = call.callee
  if (!t.isFunctionExpression(fn) || fn.params.length !== 2) {
    return null
  }

  let pushes = false
  let hasTry = false
  let hasCounterLoop = false
  let hasParseInt = false
  let divides = false
  traverse(t.file(t.program([t.expressionStatement(fn)])), {
    CallExpression(path) {
      const callee = path.node.callee
      if (
        t.isMemberExpression(callee) &&
        ((t.isStringLiteral(callee.property) &&
          callee.property.value === 'push') ||
          t.isIdentifier(callee.property, { name: 'push' }))
      ) {
        pushes = true
      }
      if (t.isIdentifier(callee, { name: 'parseInt' })) {
        hasParseInt = true
      }
    },
    TryStatement() {
      hasTry = true
    },
    WhileStatement(path) {
      if (t.isUpdateExpression(path.node.test, { operator: '--' })) {
        hasCounterLoop = true
      }
    },
    BinaryExpression(path) {
      if (path.node.operator === '/') {
        divides = true
      }
    },
  })
  if (!pushes) {
    return null
  }

  const firstArg = call.arguments[0]
  return {
    // `counter-loop` states its trip count as a literal second argument and can be unrotated by
    // reading. `compare-loop` states it nowhere - it searches until a checksum over the array's
    // own contents matches - which is why anything decoding that era has to run the loop rather
    // than compute it.
    kind: hasTry ? 'compare-loop' : hasCounterLoop ? 'counter-loop' : 'other',
    comparison: hasParseInt
      ? divides
        ? 'parseint-div'
        : 'parseint-mul'
      : 'none',
    argName: t.isIdentifier(firstArg) ? firstArg.name : null,
    // Both handles, because they are not the same node and the decoder needs each for a
    // different job. `call` is what gets evaluated and what gets removed; `node` is the statement
    // it arrived in, which on a merged sample also carries unrelated effects that must survive.
    call,
    node: statement,
  }
}

/* ------------------------------------------------------------------------- *
 * The weak probe
 * ------------------------------------------------------------------------- */

/**
 * Is there string-array-shaped evidence here at all?
 *
 * **This exists to make `absent` and `unreadable` different answers**, and it is deliberately
 * weaker than the matchers above - a probe that mirrors a matcher gate for gate can only ever
 * find near-misses, and is blind by construction to the case that matters: a whole holder kind or
 * wrapper form nobody wrote a branch for.
 *
 * Each signal is cheap and shape-keyed, and **none is conclusive alone** - which is why the
 * caller requires two before refusing. One is not a threshold chosen for caution: every signal
 * here occurs in ordinary hand-written code, and `array-of-strings` fires on a literal as plain
 * as `var parts = ['alpha', 'beta', 'gamma']`. Refusing on that would make the terminating round
 * of a peel loop report a refusal over source that was never obfuscated, which inverts the one
 * distinction this probe exists to draw. Two signals is the weakest rule that still separates
 * them; the asymmetry is deliberate, because a missed diagnostic costs a re-run while a false
 * refusal discards a completed decode.
 */
function weakEvidence(ast) {
  const signals = []
  traverse(ast, {
    ArrayExpression(path) {
      if (
        signals.includes('array-of-strings') ||
        path.node.elements.length < 3 ||
        !path.node.elements.every((element) => t.isStringLiteral(element))
      ) {
        return
      }
      signals.push('array-of-strings')
    },
    CallExpression(path) {
      const callee = path.node.callee
      if (!t.isMemberExpression(callee)) {
        return
      }
      const property = t.isStringLiteral(callee.property)
        ? callee.property.value
        : t.isIdentifier(callee.property) && !callee.computed
          ? callee.property.name
          : null
      if (
        (property === 'push' || property === 'shift') &&
        !signals.includes('push-shift')
      ) {
        signals.push('push-shift')
      }
    },
    Function(path) {
      // A two-parameter function that subtracts a constant from a parameter is the wrapper's
      // arithmetic with none of its structure required.
      if (signals.includes('index-shift') || path.node.params.length !== 2) {
        return
      }
      const names = path.node.params
        .filter(t.isIdentifier)
        .map((param) => param.name)
      if (!names.length) {
        return
      }
      let found = false
      path.traverse({
        BinaryExpression(inner) {
          if (
            inner.node.operator === '-' &&
            t.isIdentifier(inner.node.left) &&
            names.includes(inner.node.left.name) &&
            foldNumber(inner.node.right) !== null
          ) {
            found = true
          }
        },
      })
      if (found) {
        signals.push('index-shift')
      }
    },
  })
  return signals
}

/* ------------------------------------------------------------------------- *
 * Entrypoint resolution
 * ------------------------------------------------------------------------- */

/**
 * Pick the subsystem's own holder out of every array-of-strings in the file.
 *
 * A self-replacing holder is unambiguous - nothing hand-written has that shape. A plain
 * declaration is not, so it counts only when something in the subsystem reads it. Where several
 * survive, the largest wins: the encoder emits one array per program and a decoy would be
 * smaller, whereas picking the first found makes the answer depend on traversal order.
 */
function selectHolder(holders, wrappers, rotators) {
  const readNames = new Set(
    [
      ...wrappers.map((wrapper) => wrapper.reads.name),
      ...rotators.map((rotator) => rotator.argName),
    ].filter(Boolean),
  )
  const used = holders.filter(
    (holder) =>
      holder.kind === 'fn-self-replacing' || readNames.has(holder.name),
  )
  let best = null
  for (const holder of used) {
    if (
      !best ||
      holder.literal.elements.length > best.literal.elements.length
    ) {
      best = holder
    }
  }
  return best
}

/**
 * Collect the variable-form scope aliases: `var a = W;` where `W` resolves to a root wrapper,
 * possibly through another alias.
 *
 * **Resolved through bindings, never by name.** Renamed output reuses short names across
 * non-overlapping scopes, so a name-keyed sweep both over- and under-counts, and a declaration id
 * is not a reference.
 *
 * The function-form scope wrapper is a different shape and is collected separately, by
 * `collectScopeWrappers` - it is machinery in its own right rather than an alias.
 */
/**
 * Resolve an identifier to the root wrapper it names, through `var a = W` alias chains.
 *
 * Returns the wrapper's own node rather than a boolean, because with several encodings
 * configured there are several root wrappers and *which* one a site reached decides which decode
 * body has to evaluate it. Resolution already has that answer; discarding it would make the
 * decoder guess.
 *
 * **Resolved through bindings, never by name.** Renamed output reuses short names across
 * non-overlapping scopes, so a name-keyed sweep both over- and under-counts.
 */
function resolveWrapperNode(path, name, wrapperNodes, depth = 0) {
  if (depth > 4) {
    return null
  }
  const binding = path.scope.getBinding(name)
  if (!binding) {
    return null
  }
  const declared = binding.path.node
  if (t.isFunctionDeclaration(declared) && wrapperNodes.has(declared)) {
    return declared
  }
  if (t.isVariableDeclarator(declared)) {
    if (
      t.isFunctionExpression(declared.init) &&
      wrapperNodes.has(declared.init)
    ) {
      return declared.init
    }
    if (t.isIdentifier(declared.init)) {
      return resolveWrapperNode(
        binding.path,
        declared.init.name,
        wrapperNodes,
        depth + 1,
      )
    }
  }
  return null
}

/**
 * The function-form scope wrapper's shape: `function X(a, b) { return W(a - N, b); }`.
 *
 * Every argument is either a bare parameter or `parameter - <constant>`, and at least one is the
 * shifted kind. "At least one" rather than "exactly one" is required by chained calls: once the
 * upper is another scope wrapper the encoder pads the call to
 * `stringArrayWrappersParametersMaxCount` arguments and spells **every** one of them
 * `parameter - <constant>`, real and fake alike.
 *
 * Returns the forwarding call, which is what names the upper wrapper.
 */
function matchScopeWrapperShape(fnNode) {
  const body = fnNode.body?.body
  if (
    !Array.isArray(body) ||
    body.length !== 1 ||
    !t.isReturnStatement(body[0])
  ) {
    return null
  }
  const call = body[0].argument
  if (!t.isCallExpression(call) || !t.isIdentifier(call.callee)) {
    return null
  }
  const params = new Set(
    fnNode.params
      .filter((param) => t.isIdentifier(param))
      .map((param) => param.name),
  )
  if (params.size !== fnNode.params.length) {
    return null
  }
  let shifted = false
  for (const arg of call.arguments) {
    if (t.isIdentifier(arg) && params.has(arg.name)) {
      continue
    }
    if (
      t.isBinaryExpression(arg, { operator: '-' }) &&
      t.isIdentifier(arg.left) &&
      params.has(arg.left.name) &&
      foldCoerced(arg.right) !== null
    ) {
      shifted = true
      continue
    }
    return null
  }
  return shifted ? call : null
}

/**
 * Collect the function-form scope wrappers, in **extraction order**: every wrapper appears after
 * the wrapper it forwards to.
 *
 * Two things make this more than a traversal.
 *
 * **The shape alone does not identify one.** `function f(a, b) { return g(a - 1, b); }` is a
 * legal thing for a program to contain. What identifies a scope wrapper is that its forwarding
 * chain *terminates at a root wrapper*, so candidates are matched structurally and then grown as
 * a fixpoint outward from the root wrappers. A candidate whose chain never reaches one is not
 * ours and is left entirely alone.
 *
 * **The fixpoint is a membership test, not a sort.** It answers "is this one of ours", and the
 * root-ward layering falls out of it for free. The caller emits the result in that order because a
 * dependency-ordered prelude is easier to debug, but nothing depends on the order: every wrapper
 * is lifted as a hoisted function declaration, so a chain resolves whichever way round it is
 * written. Do not add a guard here asserting the order matters - it does not, and it has been
 * measured by reversing the emission.
 */
function collectScopeWrappers(ast, rootWrapperNodes, machineryNodes) {
  const insideMachinery = (path) => {
    for (let cursor = path.parentPath; cursor; cursor = cursor.parentPath) {
      if (machineryNodes.has(cursor.node)) {
        return true
      }
    }
    return false
  }

  const candidates = []
  const record = (path, node, name, decl) => {
    if (insideMachinery(path)) {
      return
    }
    const call = matchScopeWrapperShape(node)
    if (call) {
      candidates.push({ path, node, name, decl, call })
    }
  }

  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.node.id) {
        record(path, path.node, path.node.id.name, 'function-declaration')
      }
    },
    VariableDeclarator(path) {
      if (
        t.isFunctionExpression(path.node.init) &&
        t.isIdentifier(path.node.id)
      ) {
        record(
          path,
          path.node.init,
          path.node.id.name,
          'var-function-expression',
        )
      }
    },
  })

  // Grow outward from the root wrappers. Each round admits the candidates whose upper is already
  // admitted, so the result is layered root-ward by construction and a chain that never reaches a
  // root wrapper simply never gets admitted.
  const admitted = []
  const admittedNodes = new Set()
  let pending = candidates
  for (;;) {
    const next = []
    let grew = false
    for (const candidate of pending) {
      const upper = resolveWrapperNode(
        candidate.path,
        candidate.call.callee.name,
        new Set([...rootWrapperNodes, ...admittedNodes]),
      )
      if (!upper) {
        next.push(candidate)
        continue
      }
      // A wrapper that resolves to itself would loop forever in the prelude; the encoder cannot
      // emit one, so this only fires on a hand-edited or hostile sample.
      if (upper === candidate.node) {
        continue
      }
      admitted.push({ ...candidate, upper })
      admittedNodes.add(candidate.node)
      grew = true
    }
    if (!grew) {
      break
    }
    pending = next
  }

  return admitted
}

function collectAliases(ast, wrapperNodes, machineryNodes) {
  const aliases = []
  const undeclared = []
  const foreignWrappers = []
  const seenForeign = new Set()

  // Is this path inside something the decoder is going to delete wholesale?
  //
  // **Required, not an optimisation.** The encoder injects scope wrappers into *every* lexical
  // scope, including the rotator's own body and the wrapper's inner closure. Those reference the
  // root wrapper with non-constant arguments and so look exactly like the scope wrapper this pass
  // does not own - but they vanish with the machinery that contains them, so treating them as
  // blockers would refuse on samples that are entirely decodable. Measured: it is the whole
  // difference between the maximal profile being finishable and not.
  const insideMachinery = (path) => {
    for (let cursor = path.parentPath; cursor; cursor = cursor.parentPath) {
      if (machineryNodes.has(cursor.node)) {
        return true
      }
    }
    return false
  }

  const resolvesToWrapper = (path, name) =>
    resolveWrapperNode(path, name, wrapperNodes) !== null

  traverse(ast, {
    VariableDeclarator(path) {
      if (!t.isIdentifier(path.node.init) || !t.isIdentifier(path.node.id)) {
        return
      }
      if (resolvesToWrapper(path, path.node.init.name)) {
        aliases.push({ name: path.node.id.name, path })
      }
    },

    // `_ = W;` with no declaration makes `_` a global, and `scope.getBinding` returns nothing for
    // it. Left unreported that reads as a clean zero rather than as a failure, which is the one
    // direction a census must never fail in - a real sample needed this edited by hand before any
    // tool could touch it.
    AssignmentExpression(path) {
      const { left, right } = path.node
      if (!t.isIdentifier(left) || !t.isIdentifier(right)) {
        return
      }
      if (path.scope.getBinding(left.name)) {
        return
      }
      if (resolvesToWrapper(path, right.name)) {
        undeclared.push({ name: left.name, path })
      }
    },

    // A call into the root wrapper whose arguments cannot be evaluated - the signature of a
    // function-form scope wrapper passing its own parameters through. That shape is not this
    // pass's to decode, and it pins the machinery alive.
    //
    // **Keyed on the call, then attributed to its innermost enclosing function.** Written the
    // other way round - visiting functions and searching their bodies - every ancestor of a scope
    // wrapper also matches, since a traversal from a function descends through nested ones. That
    // reports a count with no meaning: on one profile it read more blocking wrappers than there
    // were blocked references.
    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee) || insideMachinery(path)) {
        return
      }
      if (!resolvesToWrapper(path, path.node.callee.name)) {
        return
      }
      const opaque = path.node.arguments.some(
        (arg) => !t.isStringLiteral(arg) && foldNumber(arg) === null,
      )
      if (!opaque) {
        return
      }
      const owner = path.getFunctionParent()
      const key = owner ? owner.node : ast.program
      if (seenForeign.has(key)) {
        return
      }
      seenForeign.add(key)
      foreignWrappers.push({ path: owner, call: path })
    },
  })

  return { aliases, undeclared, foreignWrappers }
}

/* ------------------------------------------------------------------------- *
 * The detector
 * ------------------------------------------------------------------------- */

/**
 * @param {import('@babel/types').File} ast
 * @returns {{
 *   status: 'resolved' | 'absent' | 'unreadable',
 *   signature: { holder: string, wrapper: string, rotate: string },
 *   holder: object | null,
 *   wrappers: object[],
 *   rotators: object[],
 *   aliases: object[],
 *   undeclared: object[],
 *   scopeWrappers: object[],
 *   foreignWrappers: object[],
 *   notes: string[],
 * }}
 */
function detectStringArray(ast) {
  const holders = []
  const wrappers = []
  const rotators = []
  const notes = []

  for (const statement of ast.program.body) {
    const rotator = matchRotator(statement)
    if (rotator) {
      rotators.push(rotator)
    }
  }

  // The holder is not necessarily at program level - control-flow flattening can move it - so the
  // whole tree is searched rather than the top-level statement list.
  traverse(ast, {
    FunctionDeclaration(path) {
      const holder = matchHolderFn(path.node)
      if (holder) {
        holders.push({ ...holder, path })
      }
      const wrapper = matchWrapper(path.node, path.node.id?.name)
      if (wrapper) {
        wrappers.push({ ...wrapper, decl: 'function-declaration', path })
      }
    },
    VariableDeclarator(path) {
      const holder = matchHolderVar(path.node)
      if (holder) {
        holders.push({ ...holder, path })
      }
      if (
        !t.isFunctionExpression(path.node.init) ||
        !t.isIdentifier(path.node.id)
      ) {
        return
      }
      const wrapper = matchWrapper(path.node.init, path.node.id.name)
      if (wrapper) {
        wrappers.push({ ...wrapper, decl: 'var-function-expression', path })
      }
    },
  })

  const holder = selectHolder(holders, wrappers, rotators)

  // Every root wrapper whose array read resolves to the holder, not just one: with several
  // encodings configured the encoder emits one wrapper per encoding, each with its own decode
  // body, and stopping at the first leaves the rest of the call sites undecodable.
  const rootWrappers = holder
    ? wrappers.filter(
        (wrapper) =>
          wrapper.reads.name === holder.arrayName ||
          wrapper.reads.name === holder.name,
      )
    : []

  const signature = {
    holder: holder ? holder.kind : 'none',
    wrapper: rootWrappers.length
      ? `${rootWrappers[0].decl}/${rootWrappers[0].kind}/reads-${rootWrappers[0].reads.via}`
      : 'none',
    rotate: rotators.length
      ? `${rotators[0].kind}/${rotators[0].comparison}`
      : 'none',
  }

  const empty = {
    status: 'absent',
    signature,
    holder: null,
    wrappers: [],
    rotators: [],
    aliases: [],
    undeclared: [],
    scopeWrappers: [],
    foreignWrappers: [],
    notes,
  }

  if (!holder || !rootWrappers.length) {
    const signals = weakEvidence(ast)
    if (signals.length < 2) {
      debugLog(
        `[obfuscatorx] detect: no string array present` +
          (signals.length ? ` (${signals[0]} alone is not evidence)` : ''),
      )
      return empty
    }
    // Evidence present, entrypoint unresolved. This is the refusal, and it says which half failed
    // so the report can be read without re-running anything.
    notes.push(
      `string-array evidence present (${signals.join(', ')}) but the entrypoint did not resolve: ` +
        `${holder ? 'holder matched' : 'no holder'}, ` +
        `${rootWrappers.length ? `${rootWrappers.length} root wrapper(s)` : 'no root wrapper'}`,
    )
    debugLog(`[obfuscatorx] detect: ${notes[notes.length - 1]}`)
    return { ...empty, status: 'unreadable' }
  }

  const wrapperNodes = new Set(rootWrappers.map((wrapper) => wrapper.node))
  // Everything the decoder removes as one unit. Anything lexically inside it is not residue and
  // not a blocker - it goes when the machinery goes.
  const machineryNodes = new Set([
    holder.node,
    ...rootWrappers.map((wrapper) => wrapper.node),
    // The rotator's *call*, not the statement it sits in: adjacent-statement merging fuses that
    // statement with unrelated effects, and a wrapper reference inside one of those is a real
    // use site rather than machinery.
    ...rotators.map((rotator) => rotator.call),
  ])
  // The function-form scope wrappers are machinery too, so they are resolved *before* the alias
  // sweep and then folded into both sets it reads: their bodies stop looking like foreign calls
  // into the root wrapper, and an alias to one resolves the same way an alias to a root wrapper
  // does.
  const scopeWrappers = collectScopeWrappers(ast, wrapperNodes, machineryNodes)
  for (const wrapper of scopeWrappers) {
    machineryNodes.add(wrapper.node)
    wrapperNodes.add(wrapper.node)
  }

  const { aliases, undeclared, foreignWrappers } = collectAliases(
    ast,
    wrapperNodes,
    machineryNodes,
  )

  // Returned as well as noted, because the decoder has to *gate* on it rather than log it. An
  // alias with no binding has call sites nothing can enumerate, so deleting the machinery after
  // missing one is fail-open corruption rather than countable residue.
  for (const item of undeclared) {
    notes.push(
      `wrapper alias '${item.name}' is assigned without a declaration, so it is a global and ` +
        `has no binding to resolve through; its call sites cannot be found by scope lookup`,
    )
  }
  if (foreignWrappers.length) {
    notes.push(
      `${foreignWrappers.length} function(s) call the string-array machinery with non-constant ` +
        `arguments and are not resolvable scope wrappers; those call sites are not this pass's ` +
        `to decode, and the machinery cannot be removed while they reference it`,
    )
  }
  if (!rotators.length) {
    // Legal - rotation is an option - so this is recorded, never treated as a miss. What tells
    // the two apart is not visible here: it is whether the extracted machinery evaluates, which
    // only the decoder can try.
    notes.push(
      'no rotator present; the array is either unrotated or the rotator was not matched',
    )
  }

  debugLog(
    `[obfuscatorx] detect: holder=${signature.holder} wrapper=${signature.wrapper} ` +
      `rotate=${signature.rotate}, ${rootWrappers.length} root wrapper(s), ` +
      `${aliases.length} alias(es)` +
      (scopeWrappers.length
        ? `, ${scopeWrappers.length} scope wrapper(s)`
        : '') +
      (foreignWrappers.length
        ? `, ${foreignWrappers.length} foreign wrapper(s)`
        : ''),
  )

  return {
    status: 'resolved',
    signature,
    holder,
    wrappers: rootWrappers,
    rotators,
    aliases,
    undeclared,
    scopeWrappers,
    foreignWrappers,
    notes,
  }
}

export default detectStringArray
export { weakEvidence, foldNumber, resolveWrapperNode }
