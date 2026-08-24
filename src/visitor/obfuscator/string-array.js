import ivm from 'isolated-vm'
import generator from '@babel/generator'
import traverse from '@babel/traverse'
import * as t from '@babel/types'

import logger from '../../utility/logger.js'
import detectStringArray, { foldNumber, resolveWrapperNode } from './detect.js'

const debugLog = logger.debugLog

/**
 * Reverse javascript-obfuscator's string array: replace every wrapper call with the string it
 * returns, then delete the machinery that produced it.
 *
 * **The strings are recovered by running the encoder's own code, not by modelling it.** The
 * subsystem is located structurally (see detect.js), its source text is captured, evaluated in a
 * fresh isolate, and each call site is decoded by evaluating that call. Rotation, the index
 * shift, and the `none` / `base64` / `rc4` encodings are therefore handled by the encoder's
 * prelude rather than reimplemented here.
 *
 * The reason is generality over three axes that are shape-only, all of which a static model would
 * have to absorb one at a time:
 *
 *   - **encodings** - a swapped-alphabet base64 with a padding-ignoring decoder, and an rc4 keyed
 *     per item out of a key pool. Evaluating covers both at no cost; reimplementing them exactly
 *     is where "nearly right" becomes silently wrong output.
 *   - **eras** - the holder, wrapper and rotator shapes each move on their own axis, but their
 *     *semantics* never change. So extraction is era-dependent and decoding is era-invariant,
 *     which is why there are no per-era strategy files here.
 *   - **variants** - real samples come from *modified* obfuscators. A fork that alters the index
 *     arithmetic or the rotator's checksum still runs; a model keyed on the stock algorithm does
 *     not survive it.
 *
 * **One run decodes exactly one layer.** There is deliberately no internal loop over a
 * re-obfuscated sample. A second encode wraps the first's whole output, so peeling is
 * outermost-first and each layer is an ordinary single-encode once it is outermost - but the
 * dangerous failure in that situation is a pass mutating the layer *beneath* it, and stopping at
 * the boundary is what makes that boundary observable. Layers also need not come from the same
 * encoder, so the loop belongs to whoever is driving the decoders, not inside one of them. What
 * this pass owes that driver is the distinction its status carries.
 *
 * **What it does when it cannot finish, and why there are four answers rather than two:**
 *
 *   - `decoded`    - every call site resolved, the machinery is gone.
 *   - `absent`     - no string array here. A verdict, not a failure: it is what the terminating
 *                    round of a peel loop reports.
 *   - `unowned`    - the subsystem is ours and readable, but a construct a *later unit* owns is
 *                    still calling it. Folding this into a refusal would make a sample merely
 *                    awaiting another pass indistinguishable from a matcher failure.
 *   - `unreadable` - ours, and we could not read it. The refusal, kept narrow.
 *
 * Every outcome other than `decoded` leaves the tree **completely untouched**. A half-resolved
 * string array is worse than an untouched one: downstream matchers key on how a construct is
 * spelled, so a partial decode manufactures two entities out of one.
 */

/**
 * Mandatory rather than defensive: a compare-loop rotator cannot terminate on an array it was not
 * written for, so the timeout is how an incomplete extraction is observed at all.
 */
const EVAL_TIMEOUT_MS = 10000

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const gen = (node) => generator(node, { compact: true }).code

/**
 * An argument this pass can evaluate: a string, or an arithmetic tree over numeric literals.
 *
 * Folding rather than demanding a `NumericLiteral` is required, not tidy: `numbersToExpressions`
 * re-spells every numeric constant as an arithmetic tree, so a literal test reads the argument as
 * unevaluable on exactly the high-strength samples that matter most.
 */
const isEvaluableArg = (node) =>
  t.isStringLiteral(node) || foldNumber(node) !== null

/* ------------------------------------------------------------------------- *
 * Extraction
 * ------------------------------------------------------------------------- */

/**
 * The holder's source, re-declared standalone.
 *
 * The plain-declaration form is matched as a *declarator*, so the `var` keyword has to be put
 * back. That is the cheap direction of the trade: `var a = 1, ARRAY = ['…'];` is a legal spelling
 * and handing back the whole declaration would delete the sibling.
 */
function holderSource(holder) {
  return holder.kind === 'var-declaration'
    ? gen(t.variableDeclaration('var', [holder.node]))
    : gen(holder.node)
}

function wrapperSource(wrapper) {
  return wrapper.decl === 'var-function-expression'
    ? gen(t.variableDeclaration('var', [wrapper.path.node]))
    : gen(wrapper.path.node)
}

/**
 * Build the prelude in **dependency order** - holder, then every wrapper, then the rotator.
 *
 * Source order is not the constraint and following it would be wrong: renamed output routinely
 * emits the rotator above both, relying on function hoisting that no longer applies once the
 * pieces are lifted out of their file. What the order has to respect is what each piece needs
 * from the others - the wrappers read the holder, and the rotator drives the array through the
 * wrappers, so it must run last.
 *
 * The rotator is wrapped in a statement rather than emitted bare, so that a callee in function
 * position is parenthesised.
 */
function buildPrelude(holder, wrappers, rotators, scopeWrappers = []) {
  const parts = [holderSource(holder)]
  for (const wrapper of wrappers) {
    parts.push(wrapperSource(wrapper))
  }
  // Scope wrappers sit before the rotator's invocation, which stays **last** so that termination
  // still proves the extraction was complete. They are declarations, so placing them ahead of it
  // runs nothing.
  //
  // Their order among themselves is deliberately *not* load-bearing: each is emitted as a hoisted
  // function declaration, so a chain resolves whichever way round they are written. Measured by
  // reversing this loop, which changes no result. They are emitted in the detector's root-ward
  // order anyway, because a prelude that reads in dependency order is easier to debug when one
  // does fail - but nothing depends on it, and a future change that reorders them is not a bug.
  for (const scope of scopeWrappers) {
    parts.push(scopeWrapperSource(scope))
  }
  for (const rotator of rotators) {
    parts.push(gen(t.expressionStatement(rotator.call)))
  }
  return parts.join(';\n')
}

/**
 * Re-declare one scope wrapper under a synthetic name, with its upper reference rewritten to the
 * upper's own lifted name.
 *
 * **Renaming on lift is required, not hygiene.** Every wrapper is lifted out of its own lexical
 * scope into one flat isolate global scope, and `identifierNamesGenerator: 'mangled'` reuses short
 * names across non-overlapping scopes - so two wrappers from sibling scopes can arrive named `a`,
 * and the second definition would silently win. The same collision is why the root wrapper's call
 * sites are evaluated through `wrapper.selfName` rather than by evaluating alias declarations.
 *
 * The node is cloned before the callee is rewritten: the real tree must not be touched until the
 * whole decode has committed, or a later failure leaves a half-rewritten program behind.
 */
function scopeWrapperSource(scope) {
  const fn = t.cloneNode(scope.node, true)
  const call = fn.body.body[0].argument
  call.callee = t.identifier(scope.upperLiftedName)
  return gen(
    t.functionDeclaration(t.identifier(scope.liftedName), fn.params, fn.body),
  )
}

/* ------------------------------------------------------------------------- *
 * Call sites
 * ------------------------------------------------------------------------- */

/**
 * Every reference to a root wrapper, classified.
 *
 * **A reference inside the machinery is not a use site.** The encoder injects scope aliases into
 * every lexical scope, the rotator's own body and the wrapper's inner closure included, and the
 * decode bodies hang a memo cache off the wrapper object. All of those look like ordinary uses
 * and all of them vanish with the machinery around them; decoding them would be work thrown away,
 * and counting them as blockers would refuse on samples that are entirely decodable.
 */
function collectSites(ast, wrapperNodes, aliasNodes, insideMachinery) {
  const sites = []
  const opaque = []
  const strayRefs = []

  traverse(ast, {
    Identifier(path) {
      // A declaration id is not a reference. Counting one is the trap that makes a fail-closed
      // matcher kill every application in scope.
      if (!path.isReferencedIdentifier()) {
        return
      }
      const wrapper = resolveWrapperNode(path, path.node.name, wrapperNodes)
      if (!wrapper || insideMachinery(path)) {
        return
      }
      const parent = path.parent
      if (t.isCallExpression(parent) && parent.callee === path.node) {
        if (parent.arguments.every(isEvaluableArg)) {
          sites.push({ path: path.parentPath, wrapper })
        } else {
          // **This has no producer below javascript-obfuscator 3.2.0, and a known one from there
          // on.** A 2.x use site is constant by construction: every argument - the real index, the
          // fake padding, the rc4 key - is built by the encoder from a literal factory, and the
          // only non-constant argument it can emit is a scope wrapper forwarding `param - N`,
          // which is machinery and never reaches here. From 3.2.0 `stringArrayCallsTransform`
          // (StringArrayControlFlowTransformer) moves those literals into a control-flow storage
          // and rewrites the site to `storage.key` - a member expression, which is exactly what
          // `isEvaluableArg` refuses.
          //
          // So this is a gate waiting for its input, not vestigial: do not delete it as
          // unreachable. `unowned` is the right answer for it too, since a storage argument is
          // precisely "readable, and a construct another unit owns is calling in".
          opaque.push(gen(parent))
        }
        return
      }
      // The alias declarations this pass already knows about: `var a = W`. The reference is the
      // alias being defined, not a use of it.
      if (
        t.isVariableDeclarator(parent) &&
        parent.init === path.node &&
        aliasNodes.has(parent)
      ) {
        return
      }
      strayRefs.push(gen(parent))
    },
  })

  return { sites, opaque, strayRefs }
}

/**
 * Is this call site in computed-member-key position?
 *
 * The check it feeds is one of only two that can catch a *missed rotator* with no expected output
 * to compare against - see `decodeStringArray`.
 */
function isComputedKey(path) {
  const parent = path.parent
  return (
    (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
    parent.computed &&
    parent.property === path.node
  )
}

/* ------------------------------------------------------------------------- *
 * Removal
 * ------------------------------------------------------------------------- */

/**
 * Remove one declarator, keeping whatever shares its declaration.
 *
 * This exists for the MULTI-declarator case and nothing else. The encoder emits wrapper aliases as
 * extra declarators inside one `var`, alongside the program's own variables — `var a = W, b = W,
 * foo = a(0x109);` — so removing the declaration would take `foo` with it.
 *
 * Babel already owns the other direction: its removal hook deletes the parent VariableDeclaration
 * when the declarator being removed is the only one, so after `path.remove()` the declaration is
 * either gone or still has at least one declarator left. Never write a `declarations.length === 0`
 * branch here — it cannot be reached, and it reads as though this function handles the empty case
 * when Babel does.
 */
function removeDeclarator(path) {
  path.remove()
}

/**
 * Remove an expression that was evaluated for its effect.
 *
 * Written for the rotator, and the care is for one spelling: adjacent-statement merging fuses the
 * rotator's IIFE with whatever statement follows it, so on a sample that also enables a timer it
 * arrives as `(function (a, b) { … })(A, 0xb89ba), setInterval(…)`. Removing the statement would
 * take the timer with it.
 */
function removeEffectExpression(path) {
  let target = path
  while (target.parentPath && target.parentPath.isUnaryExpression()) {
    target = target.parentPath
  }
  const parent = target.parentPath
  if (parent && parent.isExpressionStatement()) {
    parent.remove()
    return
  }
  target.remove()
  if (parent && !parent.removed && parent.isSequenceExpression()) {
    const remaining = parent.node.expressions
    if (remaining.length === 1) {
      parent.replaceWith(remaining[0])
    } else if (remaining.length === 0) {
      parent.remove()
    }
  }
}

/** Find the live path for each of a set of nodes, in one pass. */
function pathsFor(ast, nodes) {
  const found = new Map()
  if (!nodes.size) {
    return found
  }
  traverse(ast, {
    enter(path) {
      if (nodes.has(path.node)) {
        found.set(path.node, path)
      }
    },
  })
  return found
}

/* ------------------------------------------------------------------------- *
 * The pass
 * ------------------------------------------------------------------------- */

function result(status, detected, extra = {}) {
  return {
    status,
    replaced: 0,
    removed: { holder: 0, wrappers: 0, rotators: 0, aliases: 0 },
    notes: detected.notes,
    ...extra,
  }
}

/**
 * @param {import('@babel/types').File} ast  mutated in place, and only on `decoded`
 * @param {{ timeout?: number }} [options]
 * @returns {{
 *   status: 'decoded' | 'absent' | 'unowned' | 'unreadable',
 *   replaced: number,
 *   removed: { holder: number, wrappers: number, rotators: number, aliases: number },
 *   notes: string[],
 * }}
 */
function decodeStringArray(ast, options = {}) {
  const timeout = options.timeout ?? EVAL_TIMEOUT_MS
  const detected = detectStringArray(ast)
  const notes = detected.notes

  if (detected.status !== 'resolved') {
    return result(detected.status, detected)
  }

  // **A gate, not a note.** An alias assigned without a declaration is a global, so it has no
  // binding and its call sites cannot be enumerated. Deleting the machinery with one of them
  // still live is fail-open corruption - the program breaks - where declining leaves residue
  // that can be seen and counted. A real sample needed exactly this edited by hand before any
  // tool could touch it.
  if (detected.undeclared.length) {
    notes.push(
      `refusing: ${detected.undeclared.length} wrapper alias(es) have no binding, so their ` +
        `call sites cannot be found and the machinery cannot be safely removed`,
    )
    return result('unreadable', detected)
  }

  // Readable, but a construct a later unit owns is still calling in. Reported as its own outcome
  // so that "awaiting another pass" and "my matcher failed" stay different answers.
  if (detected.foreignWrappers.length) {
    notes.push(
      `leaving the subsystem in place: ${detected.foreignWrappers.length} function(s) reach the ` +
        `string-array machinery with non-constant arguments and are not resolvable scope wrappers`,
    )
    return result('unowned', detected)
  }

  const holder = detected.holder
  const wrappers = detected.wrappers
  // Lifted names are assigned here rather than in the detector: they exist only for the isolate,
  // and the detector's job is to hand back handles, not to pick identifiers for an evaluation
  // strategy it knows nothing about. Position in the array is the topological order the detector
  // established, so an upper's name is always already assigned when its dependant is reached.
  const scopeWrappers = detected.scopeWrappers ?? []
  const liftedByNode = new Map()
  scopeWrappers.forEach((scope, index) => {
    scope.liftedName = `__sw${index}`
    liftedByNode.set(scope.node, scope)
  })
  for (const scope of scopeWrappers) {
    const upper = liftedByNode.get(scope.upper)
    scope.upperLiftedName = upper
      ? upper.liftedName
      : wrappers.find((wrapper) => wrapper.node === scope.upper)?.selfName
    if (!scope.upperLiftedName) {
      notes.push(
        `refusing: scope wrapper '${scope.name}' forwards to a wrapper that did not resolve to a ` +
          `lifted name, so the prelude cannot be built`,
      )
      return result('unreadable', detected)
    }
  }
  // Only rotators that rotate *this* holder. One that does not is not ours - a second layer's,
  // most likely - and running it would rotate an array it was never written for.
  const rotators = detected.rotators.filter(
    (rotator) =>
      rotator.argName === holder.name || rotator.argName === holder.arrayName,
  )
  if (rotators.length !== detected.rotators.length) {
    notes.push(
      'refusing: a rotator is present that does not rotate this string array',
    )
    return result('unreadable', detected)
  }

  // Scope wrappers join both sets. In `wrapperNodes` they become resolvable call targets, so a
  // site naming one is collected like any other; in `machinery` they become part of what is
  // deleted, so their own forwarding calls stop reading as use sites.
  const wrapperNodes = new Set([
    ...wrappers.map((wrapper) => wrapper.node),
    ...scopeWrappers.map((scope) => scope.node),
  ])
  const wrapperByNode = new Map([
    ...wrappers.map((wrapper) => [
      wrapper.node,
      { callName: wrapper.selfName },
    ]),
    ...scopeWrappers.map((scope) => [
      scope.node,
      { callName: scope.liftedName },
    ]),
  ])
  const machinery = new Set([
    holder.node,
    ...wrappers.map((wrapper) => wrapper.node),
    ...scopeWrappers.map((scope) => scope.node),
    ...rotators.map((rotator) => rotator.call),
  ])
  const insideMachinery = (path) => {
    for (let cursor = path.parentPath; cursor; cursor = cursor.parentPath) {
      if (machinery.has(cursor.node)) {
        return true
      }
    }
    return false
  }

  // **Nothing outside the machinery may read the array itself.** The wrapper's call sites are
  // enumerated exhaustively below, but the *holder* is a separate binding and its references were
  // never counted - so a program that indexes the array directly would have had it deleted out
  // from under it. That is the fail-open direction: the sample breaks rather than leaving residue.
  // Checked here because it is only answerable before anything is replaced.
  const holderBinding = holder.path.isFunctionDeclaration()
    ? holder.path.parentPath.scope.getBinding(holder.name)
    : holder.path.scope.getBinding(holder.name)
  const outsideHolderRefs = (holderBinding?.referencePaths ?? []).filter(
    (ref) => !insideMachinery(ref),
  )
  if (!holderBinding || outsideHolderRefs.length) {
    notes.push(
      holderBinding
        ? `refusing: the string array is read from ${outsideHolderRefs.length} place(s) outside ` +
            `the machinery, e.g. ${gen(outsideHolderRefs[0].parent)}`
        : 'refusing: the string array holder has no binding to check its readers through',
    )
    return result('unreadable', detected)
  }

  const aliasNodes = new Set(detected.aliases.map((alias) => alias.path.node))
  const { sites, opaque, strayRefs } = collectSites(
    ast,
    wrapperNodes,
    aliasNodes,
    insideMachinery,
  )
  if (opaque.length) {
    notes.push(
      `leaving the subsystem in place: ${opaque.length} call site(s) take arguments that ` +
        `cannot be evaluated, e.g. ${opaque[0]}`,
    )
    return result('unowned', detected)
  }
  if (strayRefs.length) {
    notes.push(
      `refusing: ${strayRefs.length} reference(s) to the root wrapper are neither calls nor ` +
        `known aliases, e.g. ${strayRefs[0]}`,
    )
    return result('unreadable', detected)
  }

  // ---- evaluate ----------------------------------------------------------
  //
  // **A fresh isolate per decode.** A module-scope one is shared by every decode in the process,
  // so the second sample evaluates its machinery into a context still holding the first's
  // bindings: a name that should be missing resolves, and the cell passes for the wrong reason.
  const isolate = new ivm.Isolate({ memoryLimit: 128 })
  let failure = null
  try {
    const context = isolate.createContextSync()
    const prelude = buildPrelude(holder, wrappers, rotators, scopeWrappers)
    try {
      // **The timeout is a correctness instrument, not a safety net.** The compare-loop rotator
      // searches until a checksum over the array's own contents matches, so it *cannot* terminate
      // on an array it was not written for. Termination is therefore proof that the extraction
      // was complete, and a timeout means it was not - which is the one signal that catches a
      // missed component on a sample with no expected output to compare against.
      context.evalSync(prelude, { timeout })
    } catch (e) {
      failure =
        `the extracted machinery did not evaluate (${e.message}); on a compare-loop ` +
        `rotator this means the extraction was incomplete rather than that the sample is hostile`
    }

    if (!failure) {
      // Cached because the same index recurs across a program, and the wrappers are pure with
      // respect to the array once the rotation has run.
      const cache = new Map()
      for (const site of sites) {
        const wrapper = wrapperByNode.get(site.wrapper)
        // **The callee is rewritten to the wrapper's own name before evaluating**, rather than
        // the alias declarations being evaluated into the isolate the way one could. Renamed
        // output reuses short names across non-overlapping scopes, so evaluating alias
        // declarations can collide two distinct bindings onto one name. Resolution already knows
        // which wrapper this site reached, so nothing is guessed.
        const args = site.path.node.arguments.map(gen).join(',')
        const call = `${wrapper.callName}(${args})`
        let value = cache.get(call)
        if (value === undefined) {
          try {
            value = context.evalSync(call, { timeout })
          } catch (e) {
            failure = `call site ${gen(site.path.node)} did not evaluate (${e.message})`
            break
          }
          if (typeof value !== 'string') {
            failure = `call site ${gen(site.path.node)} returned ${typeof value}, not a string`
            break
          }
          cache.set(call, value)
        }
        site.value = value
      }
    }
  } finally {
    isolate.dispose()
  }

  if (failure) {
    notes.push(`refusing: ${failure}`)
    return result('unreadable', detected)
  }

  // **The second rotator-miss guard, and the general one.** A missed rotator does not throw: it
  // returns real strings from an unrotated array, so the output parses, runs, and reads clean on
  // every residue axis while being wrong. What it cannot do is keep a property name in a computed
  // member key valid, because the encoder put a real one there. Under a per-item-keyed encoding
  // the same miss also produces non-ASCII bytes, but that tell is encoding-specific and this one
  // is not.
  //
  // Deliberately strict: it is a guard, and loosening one before it has ever failed is how a
  // guard stops guarding.
  const keyViolations = sites.filter(
    (site) => isComputedKey(site.path) && !IDENTIFIER_RE.test(site.value),
  )
  if (keyViolations.length) {
    notes.push(
      `refusing: ${keyViolations.length} decoded string(s) in computed-member-key position are ` +
        `not valid identifiers, e.g. ${JSON.stringify(keyViolations[0].value)} - the usual ` +
        `cause is a component of the machinery that was not extracted`,
    )
    return result('unreadable', detected)
  }

  // ---- mutate ------------------------------------------------------------
  //
  // Nothing above this line has touched the tree. Every `(call site, value)` pair is resolved
  // first because the alternative cannot satisfy all-or-nothing: editing while sites are still
  // being resolved leaves a half-decoded array behind on any later failure.
  const rotatorPaths = pathsFor(
    ast,
    new Set(rotators.map((rotator) => rotator.call)),
  )
  // Taken while the holder's path is still attached; the Scope object outlives the removals.
  const programScope = holder.path.scope.getProgramParent()

  for (const site of sites) {
    site.path.replaceWith(t.stringLiteral(site.value))
  }

  let removedAliases = 0
  for (const alias of detected.aliases) {
    // Aliases the encoder injected *into* the machinery go with it; removing them separately
    // would only detach paths the machinery removal still has to walk.
    if (alias.path.removed || insideMachinery(alias.path)) {
      continue
    }
    removeDeclarator(alias.path)
    removedAliases += 1
  }

  let removedRotators = 0
  for (const rotator of rotators) {
    const path = rotatorPaths.get(rotator.call)
    if (path && !path.removed) {
      removeEffectExpression(path)
      removedRotators += 1
    }
  }

  // Ahead of the root wrappers only for readability - what actually keeps this safe is that every
  // call site was replaced above, so nothing references any of them by the time they go, and the
  // `removed` guard covers a wrapper that a containing one already took with it.
  let removedScopeWrappers = 0
  for (const scope of [...scopeWrappers].reverse()) {
    if (scope.path.removed) {
      continue
    }
    if (scope.decl === 'var-function-expression') {
      removeDeclarator(scope.path)
    } else {
      scope.path.remove()
    }
    removedScopeWrappers += 1
  }

  let removedWrappers = 0
  for (const wrapper of wrappers) {
    if (wrapper.path.removed) {
      continue
    }
    if (wrapper.decl === 'var-function-expression') {
      removeDeclarator(wrapper.path)
    } else {
      wrapper.path.remove()
    }
    removedWrappers += 1
  }

  let removedHolder = 0
  if (!holder.path.removed) {
    if (holder.kind === 'var-declaration') {
      removeDeclarator(holder.path)
    } else {
      holder.path.remove()
    }
    removedHolder = 1
  }

  // Crawl from the **program** scope, not from any one removal site. This pass deletes bindings in
  // several scopes at once and replaces references in others, so crawling locally would leave the
  // enclosing scopes' reference counts stale for whatever runs next - a cleanup sweep, typically,
  // which is exactly the kind of pass that decides what to delete from a count.
  programScope.crawl()

  debugLog(
    `[obfuscatorx] string-array: ${sites.length} call site(s) decoded, removed ` +
      `${removedHolder} holder, ${removedWrappers} wrapper(s), ` +
      `${removedScopeWrappers} scope wrapper(s), ${removedRotators} rotator(s), ` +
      `${removedAliases} alias(es)`,
  )

  return {
    status: 'decoded',
    replaced: sites.length,
    removed: {
      holder: removedHolder,
      wrappers: removedWrappers,
      scopeWrappers: removedScopeWrappers,
      rotators: removedRotators,
      aliases: removedAliases,
    },
    notes,
  }
}

export default decodeStringArray
