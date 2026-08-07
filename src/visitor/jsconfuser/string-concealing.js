import generator from '@babel/generator'
import * as t from '@babel/types'

import ivm from 'isolated-vm'
const isolate = new ivm.Isolate()

import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode
const safeGetName = safeFunc.safeGetName
const safeReplace = safeFunc.safeReplace
import bindingDef from '../../utility/binding-def.js'
const resolveBindingFunction = bindingDef.resolveBindingFunction

/**
 * Matches the per-block retrieval wrapper stringConcealing.ts always generates,
 * regardless of which string encoding is in play (default base91 or a
 * customStringEncodings implementation):
 *
 *   function fnName(start, length) {
 *     return decodeFnName(arrayName["slice"](start, start + length));
 *   }
 *
 * One `arrayName` is shared program-wide (the single decoy-padded string every block
 * slices into); `decodeFnName`/`fnName` are unique per block.
 *
 * Two spellings of that same shape reach this pass from earlier decode passes rather than
 * from the encoder, and both are matched here: the body can open with declaration-only
 * `var`s (variable-masking.js's un-masking declares the slots it could not turn into
 * parameters, and nothing in the wrapper reads them), and the callee can be wrapped
 * as `(1, decodeFnName)`, which is the same call with `this` pinned to undefined.
 */
function matchStringConcealingWrapper(fnPath) {
  const node = fnPath.node
  if (
    node.params.length !== 2 ||
    !t.isIdentifier(node.params[0]) ||
    !t.isIdentifier(node.params[1])
  ) {
    return null
  }
  const [startParam, lengthParam] = node.params.map((p) => p.name)

  // Not every Function has a block body - a concise arrow's is an expression.
  if (!t.isBlockStatement(node.body)) return null
  const body = node.body.body
  const returned = body[body.length - 1]
  if (!body.length || !t.isReturnStatement(returned)) return null
  for (const stmt of body.slice(0, -1)) {
    if (
      !t.isVariableDeclaration(stmt) ||
      stmt.declarations.some((declarator) => declarator.init)
    ) {
      return null
    }
  }
  const call = returned.argument
  if (!t.isCallExpression(call) || call.arguments.length !== 1) return null
  const callee = t.isSequenceExpression(call.callee)
    ? call.callee.expressions[call.callee.expressions.length - 1]
    : call.callee
  if (!t.isIdentifier(callee)) return null

  const sliceCall = call.arguments[0]
  if (
    !t.isCallExpression(sliceCall) ||
    !t.isMemberExpression(sliceCall.callee) ||
    !sliceCall.callee.computed ||
    !t.isIdentifier(sliceCall.callee.object) ||
    !t.isStringLiteral(sliceCall.callee.property) ||
    sliceCall.callee.property.value !== 'slice' ||
    sliceCall.arguments.length !== 2
  ) {
    return null
  }

  const [sliceStart, sliceEnd] = sliceCall.arguments
  if (!t.isIdentifier(sliceStart) || sliceStart.name !== startParam) return null
  if (
    !t.isBinaryExpression(sliceEnd) ||
    sliceEnd.operator !== '+' ||
    !t.isIdentifier(sliceEnd.left) ||
    sliceEnd.left.name !== startParam ||
    !t.isIdentifier(sliceEnd.right) ||
    sliceEnd.right.name !== lengthParam
  ) {
    return null
  }

  return {
    decodeFnName: callee.name,
    arrayName: sliceCall.callee.object.name,
  }
}

/**
 * Walks a Program-level declaration's body for further Program-scope identifier
 * references, collecting each into `collected` and recursing into it - the decode
 * function itself doesn't need to be understood (base91 or any well-formed custom
 * encoding both work, since the whole point of evaluating it in a sandbox rather than
 * hand-porting its algorithm is that it doesn't matter what the algorithm is), only
 * every declaration it (transitively) depends on to actually run standalone. In
 * practice this pulls in the shared `{ph}_bufferToString` chain
 * (bufferToStringTemplate.ts: the getGlobal sniffer, `__globalObject`,
 * `__TextDecoder`/`__Uint8Array`/`__Buffer`/`__String`/`__Array`, `utf8ArrayToStr`)
 * whenever the encoding's decode function calls it, same shared bundle every block's
 * decode function was compiled against.
 */
/**
 * The declaration a binding actually names, whatever spelling it arrived in.
 *
 * `binding.path` is the declaration only for the plainest ones. MovedDeclarations (encoder
 * Order 25) can pack one onto the enclosing function's parameter list, and the binding then
 * reads `kind: 'param'` with `binding.path` pointing at the parameter's own Identifier -
 * which is not a declaration at all. That breaks this file three separate ways: an
 * `isFunctionDeclaration()` test reports false for something that is one, a `collected` entry
 * puts a bare name into the bundle where a definition belongs, and an ancestry test asks
 * about the wrong node. The real declaration is demoted to a constant violation, which is
 * exactly what `utility/binding-def.js` exists to read.
 */
function declarationPath(binding) {
  if (binding.kind === 'param') {
    const fnPath = resolveBindingFunction(binding)
    if (fnPath && fnPath.isFunctionDeclaration()) {
      return fnPath
    }
  }
  return binding.path
}

function collectProgramDeps(searchPath, collected, valueOverrides) {
  searchPath.traverse({
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return
      const refName = path.node.name
      const binding = path.scope.getBinding(refName)
      if (!binding) return
      const declPath = declarationPath(binding)
      if (
        !declPath.isFunctionDeclaration() &&
        !declPath.isVariableDeclarator()
      ) {
        return
      }
      // Keyed by the declaration's own AST node, not its (possibly renamed) name -
      // renameVariables can coincidentally give two unrelated declarations the exact
      // same text (e.g. this dependency and the wrapper itself, see
      // evalWrapperCallSites), and a name-keyed Map would silently conflate them.
      if (collected.has(declPath.node)) return
      // A var/function declared *inside* what is being generated (e.g. the decode fn's
      // own locals) is already part of its code, not a separate free-variable dependency
      // to hoist out as its own top-level declaration. Asked of the real path ancestry
      // rather than of `node.start`/`node.end`: the passes that run before this one
      // rebuild whole subtrees (VariableMasking reparses a function body, the
      // ControlFlowFlattening decode synthesises statements outright), so a node's source
      // offsets are routinely absent, or relative to a fragment instead of to the
      // program. A stale offset let a local declared *inside* the decode function be
      // hoisted beside it, where its own parameter is out of scope, and the bundle then
      // failed to evaluate at all.
      if (searchPath.isAncestor(declPath)) return
      collectProgramDeps(
        addDependency(binding, collected, valueOverrides),
        collected,
        valueOverrides,
      )
    },
  })
}

/**
 * The value a binding holds, resolved from the *binding* rather than from its
 * declarator's own `init`, as both the value node and the path it lives at.
 *
 * MovedDeclarations (encoder Order 20+, so it runs after StringConcealing and rewrites
 * its output) splits `var x = <value>` into `var x;` + `x = <value>`, which leaves
 * `init` null and the value in the binding's single write. Reading `init` alone made
 * every wrapper on such a sample fail closed.
 */
function resolveDeclaredValue(binding) {
  if (!binding.path.isVariableDeclarator()) return null
  if (binding.path.node.init) {
    return { node: binding.path.node.init, path: binding.path.get('init') }
  }
  if (binding.constantViolations.length !== 1) return null
  const write = binding.constantViolations[0]
  if (
    !write.isAssignmentExpression() ||
    write.node.operator !== '=' ||
    !write.get('right').node
  ) {
    return null
  }
  return { node: write.node.right, path: write.get('right') }
}

function resolveDeclaredString(binding) {
  const value = resolveDeclaredValue(binding)
  return value && t.isStringLiteral(value.node) ? value.node : null
}

/**
 * Adds one declaration to the bundle and returns the path to search for its own further
 * dependencies - the declaration itself, or, when it was split as above, the separate
 * write that actually holds its value. Without that second case a dependency declared as
 * `var decode;` + `decode = function (…) {…}` reached the bundle as a bare `var decode;`
 * and every call through it failed with "decode is not a function".
 */
function addDependency(binding, collected, valueOverrides) {
  const declPath = declarationPath(binding)
  collected.set(declPath.node, declPath)
  if (!declPath.isVariableDeclarator() || declPath.node.init) return declPath
  const value = resolveDeclaredValue(binding)
  if (!value) return declPath
  valueOverrides.set(declPath.node, value.node)
  return value.path
}

/**
 * Document order for two collected declarations, as the trail of container keys down
 * from the Program root. `var` initializers have to run top-to-bottom in the generated
 * bundle, and `node.start` cannot order them for the same reason `collectProgramDeps`
 * cannot use it for containment.
 */
function documentOrderKey(path) {
  const trail = []
  for (let p = path; p && p.parentPath; p = p.parentPath) {
    trail.push({ list: p.listKey || '', key: p.key })
  }
  return trail.reverse()
}

function compareDocumentOrder(a, b) {
  const ka = documentOrderKey(a)
  const kb = documentOrderKey(b)
  for (let i = 0; i < Math.min(ka.length, kb.length); ++i) {
    if (ka[i].list !== kb[i].list) return ka[i].list < kb[i].list ? -1 : 1
    if (ka[i].key === kb[i].key) continue
    if (typeof ka[i].key === 'number' && typeof kb[i].key === 'number') {
      return ka[i].key - kb[i].key
    }
    return String(ka[i].key) < String(kb[i].key) ? -1 : 1
  }
  return ka.length - kb.length
}

function declToCode(declPath, valueOverrides) {
  if (declPath.isVariableDeclarator()) {
    // A declarator whose value was resolved off a separate assignment has to carry it
    // here instead - the bundle is evaluated standalone, without that assignment.
    const override = valueOverrides && valueOverrides.get(declPath.node)
    const node = override
      ? t.variableDeclarator(declPath.node.id, override)
      : declPath.node
    return `var ${generator(node).code};`
  }
  return generator(declPath.node).code
}

/**
 * If two collected declarations coincidentally end up with the identical text after
 * renameVariables (e.g. a Program-level dependency and this wrapper, or two unrelated
 * dependencies), flattening them into one isolate-global eval scope would merge them
 * into a single JS binding and silently corrupt whichever one runs later - reproduced
 * against real renameVariables output 2026-07-25: a wrapper coincidentally reused a
 * TextDecoder-alias's name, so `typeof aliasName` inside the shared bufferToString
 * helper picked up the wrapper function itself and recursed infinitely
 * (`Maximum call stack size exceeded`), leaving the whole wrapper undecoded. Earlier-
 * in-source-position entries keep their name; every later duplicate is renamed out of
 * the way via the real Babel scope (same idiom as flatten.js's substituteFlatAccess),
 * which correctly propagates to every reference throughout the whole program, not just
 * within this bundle's own text.
 */
function resolveBundleNameCollisions(ordered) {
  const seen = new Set()
  for (const declPath of ordered) {
    const name = declPath.node.id.name
    if (seen.has(name)) {
      // A FunctionDeclaration's own name is bound in its *parent* scope (hoisted),
      // not its own internal one - renaming from declPath.scope directly would walk
      // up via getBinding and find that correctly *unless* something inside the
      // function's own body shadows the same name (e.g. a local var coincidentally
      // renamed to match its enclosing function, the same self-shadowing shape that
      // broke calculator.js), in which case it would rename that unrelated local
      // instead. Skip straight to the parent scope, same special-case safe-func.js's
      // safeDeleteNode already applies for this exact reason.
      const scope = declPath.isFunctionDeclaration()
        ? declPath.parentPath.scope
        : declPath.scope
      scope.rename(name)
    } else {
      seen.add(name)
    }
  }
}

/**
 * The binding a wrapper is reachable through: a declaration's own name, or the variable a
 * function expression was assigned to - `var w = function …` and the split `var w;` +
 * `w = function …` alike. Anything else (an immediately-invoked expression, an object
 * property, a callback argument) has no binding whose references are this wrapper's call
 * sites, and is left alone.
 *
 * The binding must resolve back to *this* function for it to be usable, which is what
 * rejects a variable that holds the wrapper only some of the time - a reassigned variable's
 * references are not all call sites of this wrapper, so replacing them from this bundle
 * would be wrong rather than merely incomplete.
 */
function resolveWrapperBinding(fnPath) {
  const parent = fnPath.parentPath
  let name = null
  let scope = null
  if (fnPath.isFunctionDeclaration()) {
    name = fnPath.node.id?.name
    // A FunctionDeclaration's name is bound in its parent scope, and resolving from its
    // own scope would find a shadowing local instead - see resolveBundleNameCollisions.
    scope = fnPath.parentPath.scope
  } else if (parent.isVariableDeclarator() && fnPath.key === 'init') {
    name = t.isIdentifier(parent.node.id) ? parent.node.id.name : null
    scope = parent.scope
  } else if (
    parent.isAssignmentExpression() &&
    parent.node.operator === '=' &&
    fnPath.key === 'right'
  ) {
    name = t.isIdentifier(parent.node.left) ? parent.node.left.name : null
    scope = parent.scope
  }
  if (!name) return null

  const binding = scope.getBinding(name)
  if (!binding) return null
  if (fnPath.isFunctionDeclaration()) {
    // Not `binding.path === fnPath`. MovedDeclarations (encoder Order 25) can pack a
    // declaration onto the enclosing function's parameter list, and the binding then reads
    // `kind: 'param'` with `binding.path` pointing at the parameter's own Identifier while
    // the real FunctionDeclaration is demoted to a constant violation - so the identity
    // check failed on a wrapper that was otherwise entirely matchable, and the concealed
    // call sites survived the whole pipeline. `resolveBindingFunction` is what reads a
    // binding's actual definition through either spelling; comparing the *node* it resolves
    // to keeps the check exactly as strict as it was.
    return resolveBindingFunction(binding)?.node === fnPath.node
      ? binding
      : null
  }
  if (!binding.path.isVariableDeclarator()) return null
  return resolveDeclaredValue(binding)?.node === fnPath.node ? binding : null
}

/**
 * Builds the standalone eval bundle for one wrapper (array + decode fn + its
 * transitive deps + the wrapper itself), runs it in an isolate, then evaluates every
 * `fnName(start, length)` call site directly and substitutes the literal string
 * result. Declarations are sorted by original source position - `var` initializers
 * need to run top-to-bottom (e.g. `__globalObject` before the `__TextDecoder` etc.
 * lines that read it), and function declarations don't care either way.
 *
 * Returns the full set of declarations pulled into the bundle (so the caller can
 * defer-and-retry deleting them once every wrapper sharing the same array/bufferToString
 * chain has been processed), or null if the match didn't hold up (missing/malformed
 * array, eval failure).
 */
function evalWrapperCallSites(fnPath, wrapperBinding, decodeFnName, arrayName) {
  // fnPath.scope is the wrapper's *own* internal scope - array/decodeFn are sibling
  // declarations in whichever block the wrapper itself sits in (Program root, or any
  // nested function body StringConcealing chose - see stringConcealing.ts's "select
  // random block parent"), so resolve them from fnPath.scope (which walks up through
  // that enclosing chain), not a fixed Program-level scope.
  const arrayBinding = fnPath.scope.getBinding(arrayName)
  const decodeBinding = fnPath.scope.getBinding(decodeFnName)
  if (!arrayBinding || !arrayBinding.path.isVariableDeclarator()) return null
  if (!decodeBinding) return null
  const arrayValue = resolveDeclaredString(arrayBinding)
  if (!arrayValue) return null

  // Keyed by AST node, not name - see collectProgramDeps' comment. wrapperName can
  // coincidentally collide with arrayName/decodeFnName/a transitive dependency's name
  // under renameVariables even though they're unrelated declarations; a name-keyed Map
  // would let this last .set() silently overwrite one of them.
  const collected = new Map()
  const valueOverrides = new Map()
  addDependency(arrayBinding, collected, valueOverrides)
  // The decode function is a declaration in the encoder's own output, but by the time
  // this pass runs it can equally be a `var decode;` + `decode = function (…) {…}` pair -
  // MovedDeclarations splits it, and the ControlFlowFlattening decode reconstructs it
  // that way too. Either spelling is usable; anything else is not a function to call.
  const decodeValue = resolveDeclaredValue(decodeBinding)
  if (
    !declarationPath(decodeBinding).isFunctionDeclaration() &&
    !(decodeValue && t.isFunction(decodeValue.node))
  ) {
    return null
  }
  const decodeSearchPath = addDependency(
    decodeBinding,
    collected,
    valueOverrides,
  )
  collectProgramDeps(decodeSearchPath, collected, valueOverrides)
  // The wrapper enters the bundle through its own *declaration*, which is the function
  // itself only when it is a FunctionDeclaration. StringConcealing emits one, but by the
  // time this pass runs the wrapper is just as often `var w;` + `w = function (…) {…}` -
  // and then what the bundle has to carry is that declarator plus its resolved value,
  // exactly as for any other split dependency.
  if (fnPath.isFunctionDeclaration()) {
    collected.set(fnPath.node, fnPath)
  } else {
    addDependency(wrapperBinding, collected, valueOverrides)
  }

  const ordered = [...collected.values()].sort(compareDocumentOrder)
  resolveBundleNameCollisions(ordered)
  // The wrapper's own binding may have just been renamed above (if it collided with an
  // earlier-position dependency). `scope.rename` renames the binding's identifier node in
  // place, so reading it back gives the current name whatever the rename did.
  const wrapperName = wrapperBinding.identifier.name
  const bundleCode = ordered
    .map((declPath) => declToCode(declPath, valueOverrides))
    .join('\n')

  const vm = isolate.createContextSync()
  try {
    vm.evalSync(bundleCode)
  } catch (e) {
    console.warn(
      `[StringConcealing] Failed to eval decoder bundle for ${wrapperName}: ${e.message}`,
    )
    return null
  }

  // Re-read rather than reusing the captured binding: renaming above may have re-crawled
  // the scope, which replaces the binding objects wholesale.
  const binding = wrapperBinding.scope.getBinding(wrapperName)
  if (!binding) return null
  let allReplaced = true
  for (const ref of binding.referencePaths) {
    // A call site reaches the wrapper either directly or through the `(1, wrapper)(…)`
    // spelling - the same call with `this` pinned to undefined. The wrapper itself is the
    // encoder's (ControlFlowFlattening wraps a callee it rewrote into a member expression,
    // so the member call keeps its receiver); the form seen *here*, around a bare
    // identifier, is left by our own ControlFlowFlattening decode resolving that member
    // expression without removing the wrapper it existed for. See the doc's Upstream
    // Effects. Stepping out to the sequence expression is only sound while what it discards
    // is inert, so every expression before the wrapper has to be a literal - anything else
    // is a side effect that replacing the call would drop.
    const callee =
      ref.parentPath.isSequenceExpression() &&
      ref.key === ref.parentPath.node.expressions.length - 1 &&
      ref.parentPath.node.expressions.slice(0, -1).every((e) => t.isLiteral(e))
        ? ref.parentPath
        : ref
    if (callee.key !== 'callee' || !callee.parentPath.isCallExpression()) {
      allReplaced = false
      continue
    }
    const call = callee.parentPath
    const args = call.node.arguments
    if (
      args.length !== 2 ||
      !t.isNumericLiteral(args[0]) ||
      !t.isNumericLiteral(args[1])
    ) {
      allReplaced = false
      continue
    }
    let value
    try {
      value = vm.evalSync(`${wrapperName}(${args[0].value}, ${args[1].value})`)
    } catch (e) {
      console.warn(
        `[StringConcealing] Failed to eval call site for ${wrapperName}: ${e.message}`,
      )
      allReplaced = false
      continue
    }
    if (typeof value !== 'string') {
      allReplaced = false
      continue
    }
    safeReplace(call, value)
  }

  return { collected, allReplaced }
}

/**
 * Reference-count-gated deletion of every collected dependency, retried to a fixpoint:
 * deleting one now-unreferenced declaration can be exactly what makes another one (that it
 * was the last remaining reference to) deletable too.
 *
 * A candidate is skipped once its path has left the tree. `declPath.removed` only reports a
 * path Babel removed directly, so a declaration whose *container* went is still checked for
 * an ancestor Program - without that, `safeDeleteNode` re-resolves the name from a detached
 * scope and answers about whatever binding of that name is reachable there instead.
 */
function runDependencyCleanup(programPath, allCandidates) {
  programPath.scope.crawl()
  let changed = true
  while (changed) {
    changed = false
    for (const declPath of allCandidates.values()) {
      if (declPath.removed || !declPath.find((p) => p.isProgram())) continue
      const name = declPath.node.id?.name
      if (name && safeDeleteNode(name, declPath)) changed = true
    }
  }
}

/**
 * One pool per *pipeline*, not per visit, which is why this takes one rather than opening
 * its own. The plugin schedules this visitor twice (see plugin/jsconfuser.js), and a
 * per-call pool means the second visit can only clean up what the second visit matched -
 * so a dependency the first visit collected and could not yet delete had no sweep left that
 * would ever look at it again.
 *
 * Every matched wrapper's dependency set (which commonly overlaps - the shared array and
 * bufferToString chain get pulled in by every block) accumulates into that pool; cleanup is
 * deferred to Program exit, and unlike integrity.js's queue the pool is built with
 * everything known up front rather than discovered incrementally.
 */
function deStringConcealingInit(sharedCandidates) {
  const allCandidates = sharedCandidates || new Map()

  return {
    Program: {
      exit(path) {
        runDependencyCleanup(path, allCandidates)
      },
    },

    // Every function, not only declarations: after the control-flow decode most wrappers
    // are function *expressions* bound to a variable, and a declaration-only visitor
    // reaches none of them. What the rest of this pass needs from a wrapper is a binding
    // whose references are its call sites, which both spellings have.
    Function(fnPath) {
      const match = matchStringConcealingWrapper(fnPath)
      if (!match) return
      const wrapperBinding = resolveWrapperBinding(fnPath)
      if (!wrapperBinding) return

      const result = evalWrapperCallSites(
        fnPath,
        wrapperBinding,
        match.decodeFnName,
        match.arrayName,
      )
      if (!result || !result.allReplaced) return

      // Keyed by AST node, not name - result.collected already is (see
      // evalWrapperCallSites), and merging into this cross-wrapper pool by name would
      // reintroduce the same collision one level up: two different wrappers' otherwise-
      // unrelated dependencies can coincidentally share a renamed name.
      for (const [node, declPath] of result.collected) {
        allCandidates.set(node, declPath)
      }
    },
  }
}

/**
 * Beyond this length a string is only inlined when it has a single reference, where
 * substituting it cannot grow the output (the one copy replaces the assignment that
 * held it). Short strings are duplicated freely - the growth is negligible and the
 * result reads better than an indirection through a name.
 */
const MAX_INLINE_LENGTH = 64

/**
 * Is this reference a StringConcealing array being sliced - `array["slice"](a, a + b)`,
 * the inner shape `matchStringConcealingWrapper` keys on?
 *
 * That matcher resolves the array from its *binding* and cannot see an inlined literal,
 * so inlining one here destroys its input rather than merely growing the output. The
 * two passes are siblings in this file and run in this order, so the coupling is real:
 * MovedDeclarations splits `var array = "..."` into `var array;` + `array = "..."`,
 * which is exactly the AssignmentExpression shape the visitor below matches.
 */
function isSlicedArrayRef(ref) {
  const parent = ref.parentPath
  if (ref.key !== 'object' || !parent || !parent.isMemberExpression()) {
    return false
  }
  if (!parent.node.computed || !t.isStringLiteral(parent.node.property)) {
    return false
  }
  if (parent.node.property.value !== 'slice') {
    return false
  }
  const grand = parent.parentPath
  return (
    !!grand && grand.isCallExpression() && grand.node.callee === parent.node
  )
}

/**
 * The `<name> = "literal"` placement reversal, scheduled *after* the Flatten decode.
 *
 * It inlines the assigned literal into every forward reference and then deletes the
 * binding, which is destructive in a way its two siblings are not: Flatten's accessor
 * object records which outer variable it proxies as an identifier inside a getter
 * (`get "k"(){ return outer }`), and that identifier is the only record of the binding's
 * identity. Inlined to a literal before `deFlatten` runs, the getter no longer matches
 * `readFlatObjectProps` and the whole scope-object layer survives the decode - measured on
 * three corpus samples whose source declares the variable this deletes.
 *
 * Its siblings stay at their original slots because Dispatcher reads its flag/key strings
 * out of the matched body and needs them as StringLiterals by then (see the scheduling
 * comment in plugin/jsconfuser.js).
 */
const deStringConcealingPlaceAssign = {
  StringLiteral(path) {
    if (path.key !== 'right' || !path.parentPath.isAssignmentExpression()) {
      return
    }
    const name = safeGetName(path.parentPath.get('left'))
    if (!name) {
      return
    }
    const binding = path.scope.getBinding(name)
    if (!binding || binding.constantViolations.length !== 1) {
      return
    }
    // Checked against every reference, not just the forward ones replaced below:
    // declining is always safe, and a backward slice reference still means this
    // binding is an array the StringConcealing decode needs to resolve.
    if (binding.referencePaths.some(isSlicedArrayRef)) {
      return
    }
    // A reference *before* the assignment reads the variable while it is still
    // undefined, so only the ones after it may take the literal. Compared as document
    // order rather than as `node.start`, for the reason `collectProgramDeps` gives: by
    // the time this pass runs, earlier passes have rebuilt enough of the tree that
    // source offsets are missing on exactly the nodes this is asked about, and a missing
    // one silently dropped its reference from the set.
    const forwardRefs = binding.referencePaths.filter(
      (ref) => compareDocumentOrder(ref, path) >= 0,
    )
    if (forwardRefs.length > 1 && path.node.value.length > MAX_INLINE_LENGTH) {
      return
    }
    for (const ref of forwardRefs) {
      // One node per reference - `path.node` itself would be placed at several
      // positions in the tree at once, the node-sharing pitfall flatten.js and
      // integrity.js both needed cloning for.
      ref.replaceWith(t.cloneNode(path.node))
    }
    safeDeleteNode(name, path.parentPath)
  },
}

/**
 * A cleanup-only sweep over a pool an earlier `deStringConcealingInit` filled, scheduled late
 * in the pipeline. Exact analogue of control-flow-graph.js's `deCffHelperCleanupInit`, for the
 * same reason: this pass's own sweeps correctly *decline* while something still references a
 * dependency, and what holds the last reference is not always gone by the time the last of
 * them runs.
 *
 * Measured case, `dead-code-opaque-predicates.2`: the base91 decode function's
 * `return bufferToString(...)` is the sole surviving reference to the whole
 * getGlobal/TextDecoder/utf8 chain at `string-conceal#2`, and DeadCode's second visit is what
 * removes it - two stages later. The chain then stood at zero references with no sweep left,
 * 2098B of a 2238B decode. Reference-count-gated, so running it when nothing changed is free.
 */
function deStringConcealingCleanupInit(sharedCandidates) {
  return {
    Program: {
      exit(path) {
        runDependencyCleanup(path, sharedCandidates)
      },
    },
  }
}

export default {
  deStringConcealingInit,
  deStringConcealingCleanupInit,
  deStringConcealingPlaceAssign,
}
