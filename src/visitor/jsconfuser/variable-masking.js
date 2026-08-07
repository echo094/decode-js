import { parse } from '@babel/parser'
import generator from '@babel/generator'
import * as t from '@babel/types'

import ivm from 'isolated-vm'
const isolate = new ivm.Isolate()

import calculateConstantExp from '../calculate-constant-exp.js'

import logger from '../../utility/logger.js'
const debugLog = logger.debugLog
import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode
const safeGetName = safeFunc.safeGetName
const safeReplace = safeFunc.safeReplace

/**
 * A nested function can declare its own rest-masked stack param that -
 * especially under `renameVariables`, which reuses a name across an
 * outer/inner pair whenever the inner shadows the outer - ends up with the
 * exact same text as an enclosing function's own `stk_name`. Matching a
 * `MemberExpression`'s object purely by name text (as every traversal below
 * used to) then treats the *inner* function's own stack accesses as if they
 * belonged to the outer one, corrupting the outer's `invalid`/`cache`
 * bookkeeping with an unrelated function's keys. Resolving the actual
 * binding at the point of match and comparing it against the one captured
 * for this function's own rest param (shadowing-safe, unlike a name
 * comparison) rules that out.
 */
function isOwnStackMember(path, stk_name, stkBinding) {
  if (path.node.object.name !== stk_name) {
    return false
  }
  // Compare by the bound identifier node, not the Binding wrapper itself -
  // this file's own localvar/array-pattern promotion re-crawls the scope
  // mid-traversal (`getProgramParent().crawl()`), which rebuilds Binding
  // objects for the same declaration; an object-identity comparison against
  // a Binding captured before that crawl would then always miss even for
  // this function's own, legitimate stack param.
  return path.scope.getBinding(stk_name)?.identifier === stkBinding.identifier
}

/**
 * type: param, value, ref, invalid
 */
function initStackCache(len) {
  const cache = {}
  for (let i = 0; i < len; ++i) {
    cache[i] = {
      type: 'param',
    }
  }
  return cache
}

/**
 * Every key that's ever the target of a `stk_name[key] = ...` assignment
 * anywhere in the body, regardless of scope. Used to veto collapsing an alias
 * onto a param's slot when that param gets reassigned somewhere else in the
 * function - a live reference to the slot would then observe the param's
 * value *after* the reassignment, not the value at the point the alias was
 * made (`var b = a; a = a + 1; return b;` must still return the original a).
 */
function collectMutatedKeys(body_path, stk_name) {
  const mutated = new Set()
  const stkBinding = body_path.scope.getBinding(stk_name)
  body_path.traverse({
    MemberExpression: {
      exit(path) {
        if (!isOwnStackMember(path, stk_name, stkBinding)) {
          return
        }
        const father = path.parentPath
        if (!father.isAssignmentExpression() || path.key !== 'left') {
          return
        }
        const prop_name = safeGetName(path.get('property'))
        if (prop_name !== null) {
          mutated.add(prop_name)
        }
      },
    },
  })
  return mutated
}

function processAssignLeft(
  vm,
  cache,
  path,
  prop_name,
  stk_name,
  mutated,
  body_path,
) {
  const father = path.parentPath
  const right = father.get('right')
  if (right.isLiteral()) {
    vm.evalSync(generator(father.node).code)
    cache[prop_name] = {
      type: 'value',
      value: right.node,
    }
    return
  }
  if (right.isArrayExpression()) {
    const elements = right.node.elements
    if (elements.length === 1 && elements[0]?.value === 'charCodeAt') {
      cache[prop_name] = {
        type: 'value',
        value: right.node,
      }
      return
    }
  }
  if (right.isUnaryExpression() && right.node.operator === '-') {
    vm.evalSync(generator(father.node).code)
    cache[prop_name] = {
      type: 'value',
      value: right.node,
    }
    return
  }
  if (
    right.isMemberExpression() &&
    isOwnStackMember(right, stk_name, body_path.scope.getBinding(stk_name))
  ) {
    const right_prop = right.get('property')
    if (right_prop.isBinaryExpression()) {
      return
    }
    let ref = safeGetName(right_prop)
    if (!Object.prototype.hasOwnProperty.call(cache, ref)) {
      cache[prop_name] = {
        type: 'invalid',
      }
      return
    }
    while (cache[ref].type === 'ref') {
      ref = cache[ref].value
    }
    if (cache[ref].type === 'value') {
      right.replaceWith(cache[ref].value)
      vm.evalSync(generator(father.node).code)
      cache[prop_name] = {
        type: 'value',
        value: cache[ref].value,
      }
    } else if (cache[ref].type === 'param' && !mutated.has(ref)) {
      cache[prop_name] = {
        type: 'ref',
        value: ref,
      }
    } else {
      // Either ref's target is reassigned elsewhere (a live pointer would
      // read the wrong, post-reassignment value) or it's already invalid -
      // leave this slot unresolved rather than alias onto something unsafe.
      cache[prop_name] = {
        type: 'invalid',
      }
    }
    return
  }
  // Fallback: a genuinely dynamic value (a call, a property read on some
  // other object, ...) that can't be constant-folded or aliased to a param.
  // As long as this assignment is a plain `=` on a top-level statement that
  // always runs exactly once before any read - the same "unconditional,
  // in-place" guarantee `checkStackInvalid` already relies on above for safe
  // param aliasing - it's safe to promote the slot to a real local variable
  // declaration (evaluated exactly once, right where the original write
  // was) rather than leaving it permanently unresolved. Re-embedding
  // `right.node` verbatim is correct even if it still contains its own
  // unresolved `stk_name[...]` reads: those refer to the same live runtime
  // array either way, and get cleaned up on a later pass same as anywhere
  // else in the body.
  if (
    body_path.scope === father.scope &&
    father.node.operator === '=' &&
    father.parentPath.isExpressionStatement()
  ) {
    const existing = cache[prop_name]
    if (existing && existing.type === 'localvar') {
      path.replaceWith(t.identifier(existing.value))
      return
    }
    const uid = body_path.scope.generateUidIdentifier('local')
    father.parentPath.replaceWith(
      t.variableDeclaration('var', [t.variableDeclarator(uid, right.node)]),
    )
    // right.node may reference an outer-scope binding (e.g. a param of an
    // enclosing function) - recrawl from Program, not just this function's
    // own scope, so that binding's reference count reflects its new home.
    body_path.scope.getProgramParent().crawl()
    cache[prop_name] = {
      type: 'localvar',
      value: uid.name,
    }
    return
  }
  cache[prop_name] = {
    type: 'invalid',
  }
}

function processAssignInvalid(cache, path, prop_name) {
  cache[prop_name] = {
    type: 'invalid',
  }
}

/**
 * A multi-variable `var [p1, p2, ...] = someArray;` declaration - dispatcher.js's
 * own payload-unpacking template is one source of these, but any array-destructuring
 * declaration is masked the same way - loses its `var` and has every destructured
 * identifier replaced by a `stk_name[key]` write, becoming a single
 * `[stk_name[k1], stk_name[k2], ...] = someArray;` assignment (an ArrayPattern of
 * MemberExpressions, optionally ending in a RestElement for an original rest param).
 * Same "unconditional, in-place" safety requirement and same `localvar` promotion
 * as the single-variable case in `processAssignLeft` above, just applied to every
 * element of the pattern at once via a real destructuring declaration rather than
 * one declaration per element - all-or-nothing: if any element isn't a plain
 * `stk_name[key]` (a hole, a nested pattern, a default, a foreign object), the whole
 * assignment is left untouched rather than partially resolved.
 */
function processArrayPatternAssign(cache, path, stk_name, invalid, body_path) {
  const node = path.node
  if (node.operator !== '=' || !t.isArrayPattern(node.left)) {
    return false
  }
  if (
    body_path.scope !== path.scope ||
    !path.parentPath.isExpressionStatement()
  ) {
    return false
  }
  const elements = path.get('left').get('elements')
  if (elements.length === 0) {
    return
  }
  // Rebuild the pattern, replacing each `stk_name[key]` slot with a fresh local and
  // recursing through nested patterns. The original parameter list is what decides the
  // nesting: a source function declared `(a, [b, c])` unpacks as `var [a, [b, c]] =
  // payload`, so masking it yields an ArrayPattern whose second element is itself an
  // ArrayPattern of slots. Handling only the flat case left every such function masked -
  // and for a Dispatcher `fns` entry that is terminal, since nothing else can supply the
  // arity needed to unmask it later.
  //
  // Still all-or-nothing: `null` anywhere aborts the whole assignment rather than
  // resolving the readable half, which would split one slot into two spellings (W5).
  const propNames = []
  const rebuild = (patternPath) => {
    const els = patternPath.get('elements')
    if (els.length === 0) {
      return null
    }
    const out = []
    for (const el of els) {
      // A hole (`[, x] = …`) carries no slot and no name; keep the position.
      if (!el.node) {
        out.push(null)
        continue
      }
      const inner = el.isRestElement() ? el.get('argument') : el
      if (inner.isArrayPattern()) {
        const nested = rebuild(inner)
        if (nested === null) {
          return null
        }
        out.push(el.isRestElement() ? t.restElement(nested) : nested)
        continue
      }
      if (!inner.isMemberExpression() || inner.node.object.name !== stk_name) {
        return null
      }
      const prop_name = safeGetName(inner.get('property'))
      if (
        prop_name === null ||
        Object.prototype.hasOwnProperty.call(invalid, prop_name)
      ) {
        return null
      }
      // A slot in the leading `0..len-1` range is an original *parameter*, not a local,
      // and promoting it to a fresh variable silently changes the function's signature.
      // `tryStackReplace`'s own member visitor already refuses these; this path never
      // had to, because a flat unpack line never covers a parameter slot - a nested one
      // can, and did: four samples decoded to `Cannot read properties of undefined`.
      if (
        Object.prototype.hasOwnProperty.call(cache, prop_name) &&
        cache[prop_name].type === 'param'
      ) {
        return null
      }
      const uid = body_path.scope.generateUidIdentifier('local')
      propNames.push({ prop_name, name: uid.name })
      out.push(el.isRestElement() ? t.restElement(uid) : uid)
    }
    return t.arrayPattern(out)
  }

  const newLeft = rebuild(path.get('left'))
  if (newLeft === null) {
    return false
  }

  path.parentPath.replaceWith(
    t.variableDeclaration('var', [t.variableDeclarator(newLeft, node.right)]),
  )
  // node.right may reference an outer-scope binding - see the matching note
  // in processAssignLeft's own localvar fallback above.
  body_path.scope.getProgramParent().crawl()
  propNames.forEach(({ prop_name, name }) => {
    cache[prop_name] = {
      type: 'localvar',
      value: name,
    }
  })

  // Rewrite the slots' *other* references here rather than leaving them to the cache.
  // `cache` is rebuilt by `initStackCache` on every `tryStackReplace` call, so a
  // registration made here does not survive to the next iteration of the enclosing
  // fixpoint loop - and by then the assignment that would re-register it is gone. Within
  // this pass the member visitor only reaches references it has not already walked past,
  // which excludes any inside a nested function declared *above* the unpack line. Those
  // are exactly the ones that then read a stack nothing populates any more.
  const promoted = new Map(
    propNames.map(({ prop_name, name }) => [prop_name, name]),
  )
  body_path.traverse({
    MemberExpression(memberPath) {
      const obj = memberPath.node.object
      if (!t.isIdentifier(obj) || obj.name !== stk_name) {
        return
      }
      const key = safeGetName(memberPath.get('property'))
      if (key === null || !promoted.has(key)) {
        return
      }
      memberPath.replaceWith(t.identifier(promoted.get(key)))
    },
  })
  return true
}

function processReplace(cache, path, prop_name) {
  const value = cache[prop_name].value
  const type = cache[prop_name].type
  if (type === 'ref') {
    path.node.computed = true
    safeReplace(path.get('property'), value)
    return true
  }
  if (type === 'value') {
    path.replaceWith(value)
    return true
  }
  if (type === 'localvar') {
    path.replaceWith(t.identifier(value))
    return true
  }
  return false
}

function checkStackInvalid(path, invalid) {
  const stk_name = path.node.params[0].argument.name
  const body_path = path.get('body')
  const stkBinding = body_path.scope.getBinding(stk_name)
  body_path.traverse({
    MemberExpression: {
      exit(path) {
        if (!isOwnStackMember(path, stk_name, stkBinding)) {
          return
        }
        const father = path.parentPath
        const prop = path.get('property')
        const prop_name = safeGetName(prop)
        if (father.isUpdateExpression()) {
          invalid[prop_name] = 1
          return
        }
        if (body_path.scope == father.scope) {
          return
        }
        if (!father.isAssignmentExpression() || path.key !== 'left') {
          return
        }
        invalid[prop_name] = 1
      },
    },
  })
  return invalid
}

function checkChangeValid(invalid, used) {
  let valid = true
  Object.keys(used).forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(invalid, key)) {
      valid = false
    }
  })
  return valid
}

function tryStackReplace(path, len, invalid, used) {
  const stk_name = path.node.params[0].argument.name
  const body_path = path.get('body')
  const stkBinding = body_path.scope.getBinding(stk_name)
  const cache = initStackCache(len)
  const mutated = collectMutatedKeys(body_path, stk_name)
  const vm = isolate.createContextSync()
  vm.evalSync(`var ${stk_name} = []`)
  let changed = false
  body_path.traverse({
    MemberExpression: {
      exit(path) {
        if (!isOwnStackMember(path, stk_name, stkBinding)) {
          return
        }
        const prop = path.get('property')
        if (prop.isBinaryExpression()) {
          return
        }
        const prop_name = safeGetName(prop)
        if (!prop_name) {
          return
        }
        if (Object.prototype.hasOwnProperty.call(invalid, prop_name)) {
          processAssignInvalid(cache, path, prop_name)
          return
        }
        const exist = Object.prototype.hasOwnProperty.call(cache, prop_name)
        if (exist && cache[prop_name].type === 'param') {
          return
        }
        const father = path.parentPath
        if (father.isAssignmentExpression() && path.key === 'left') {
          processAssignLeft(
            vm,
            cache,
            path,
            prop_name,
            stk_name,
            mutated,
            body_path,
          )
        } else if (exist) {
          used[prop_name] = 1
          changed |= processReplace(cache, path, prop_name)
        }
      },
    },
    AssignmentExpression: {
      exit(path) {
        // The result feeds `changed` deliberately. This rewrite registers new
        // `localvar` cache entries, but any `stk[key]` read that the same traversal
        // already walked past - notably one inside a nested function declared *above*
        // the unpack line - has not been rewritten yet. Only another pass of the
        // enclosing fixpoint loop can reach those, and discarding the result meant an
        // iteration whose sole change was this one ended the loop, leaving the reads
        // pointing at a stack nothing populates any more.
        changed |= processArrayPatternAssign(
          cache,
          path,
          stk_name,
          invalid,
          body_path,
        )
      },
    },
  })
  const binding = body_path.scope.getBinding(stk_name)
  binding.scope.crawl()
  return changed
}

/**
 * The `stk_name["length"] = N` truncation statement's `N`, or null when the function
 * carries no such statement.
 *
 * This is the encoder's own record of the original parameter count, so it is *exact* -
 * unlike `inferParamCountFromCallSites` below, which can only under-count. Anything that
 * has to tell an original param apart from a masked local (rather than merely leaving
 * both unresolved) needs the exact value: an under-count reclassifies a real param as a
 * local, and a local is not handed the caller's argument.
 */
function readTruncationLength(path) {
  const restName = path.node.params?.[0]?.argument?.name
  if (!restName) {
    return null
  }
  const body_path = path.get('body')
  // The truncation write sits on whichever binding holds the slots, which is not the
  // rest param when ControlFlowFlattening's decode copied the stack into a local first
  // (see `resolveStackAlias`). Reading it off the param there returns null, and a null
  // here is what keeps `unmaskStack` from ever being called on those functions.
  const alias = resolveStackAlias(path, restName)
  const stk_name = alias ? alias.name : restName
  const stkBinding = body_path.scope.getBinding(stk_name)
  let len = null
  body_path.traverse({
    MemberExpression: {
      exit(path) {
        if (!isOwnStackMember(path, stk_name, stkBinding)) {
          return
        }
        const prop = path.get('property')
        if (prop.isBinaryExpression()) {
          return
        }
        const prop_name = safeGetName(prop)
        if (!prop_name || prop_name !== 'length') {
          return
        }
        const father = path.parentPath
        if (!father.isAssignmentExpression() || path.key !== 'left') {
          return
        }
        const right = father.get('right')
        if (right.isBinaryExpression()) {
          return
        }
        if (!right.isLiteral()) {
          return
        }
        len = right.node.value
        path.stop()
      },
    },
  })
  return len
}

/**
 * The encoder only inserts the `stk_name["length"] = N` truncation statement
 * `getStackParamLen` looks for when a function is *not* "predictable"
 * (`preparation.ts`'s own check: every reference is a direct, non-spread call,
 * and the declared param count covers every call site's argument count). For
 * an ordinary directly-called function - the common case - no truncation
 * statement exists at all, so fall back to inferring the count from the
 * function's own direct call sites: the maximum argument count seen there can
 * never exceed the true declared count (predictability requires
 * `definedArgLength >= maxArgLength`), so this can only under-count, never
 * over-count. An under-count is safe here - original-param keys always
 * occupy the leading `0..len-1` range and the encoder's own key-uniqueness
 * check guarantees a local variable's key can never collide with one, so at
 * worst this just leaves some high-index, never-reassigned param read
 * unresolved rather than misclassifying a real local variable as a param.
 * Scoped to named FunctionDeclarations only (the common VariableMasking
 * target); anything else, any non-call reference, or any spread argument
 * bails to 'unknown' rather than guess.
 */
function inferParamCountFromCallSites(path) {
  if (!path.isFunctionDeclaration() || !path.node.id) {
    return 'unknown'
  }
  const binding = path.parentPath.scope.getBinding(path.node.id.name)
  if (!binding) {
    return 'unknown'
  }
  let maxArgs = 0
  let sawCall = false
  for (const ref of binding.referencePaths) {
    if (ref.key !== 'callee' || !ref.parentPath.isCallExpression()) {
      return 'unknown'
    }
    const args = ref.parentPath.node.arguments
    if (args.some((arg) => t.isSpreadElement(arg))) {
      return 'unknown'
    }
    sawCall = true
    if (args.length > maxArgs) {
      maxArgs = args.length
    }
  }
  return sawCall ? maxArgs : 'unknown'
}

/**
 * Resolves every stack-slot access in `path`'s body (a rest-masked function
 * with `len` original params) back to a plain param/value/ref read. Called
 * both from this file's own RestElement entry point and from
 * function-length.js once it has unwrapped a {ph}_fnLength wrapper and
 * learned the function's real param count that way instead.
 */
export function processStackParam(path, len) {
  if (path.isArrowFunctionExpression()) {
    debugLog(`[VariableMasking] Process arrowFunctionExpression, len: ${len}`)
  } else if (path.isFunctionExpression()) {
    debugLog(`[VariableMasking] Process functionExpression, len: ${len}`)
  } else {
    debugLog(
      `[VariableMasking] Process Function ${
        path.node.id?.name ?? '(anonymous)'
      }, len: ${len}`,
    )
  }
  const orig_code = generator(path.node).code
  let changed = true
  const invalid = {}
  let used = {}
  while (changed) {
    checkStackInvalid(path, invalid)
    if (!checkChangeValid(invalid, used)) {
      path.replaceWith(parse(orig_code).program.body[0])
      used = {}
    }
    changed = tryStackReplace(path, len, invalid, used)
    path.traverse(calculateConstantExp)
  }
}

/**
 * The slot key of a `stk[key]` / `stk.key` access, as a canonical string, or null when
 * the key isn't statically known.
 *
 * Deliberately not `safeGetName`: that reads a *computed* `stk[i]` as the key `"i"`,
 * which is the identifier's name rather than the slot it selects at runtime. Folding one
 * slot's value into a site like that would be wrong output, so this reports it as
 * unknown instead.
 */
function readSlotKey(member) {
  const prop = member.node.property
  if (!member.node.computed) {
    return t.isIdentifier(prop) ? prop.name : null
  }
  if (t.isStringLiteral(prop) || t.isNumericLiteral(prop)) {
    return String(prop.value)
  }
  if (
    t.isUnaryExpression(prop, { operator: '-' }) &&
    t.isNumericLiteral(prop.argument)
  ) {
    return String(-prop.argument.value)
  }
  return null
}

/**
 * Every use of the stack, or null if any one of them makes the array itself observable.
 *
 * The un-masking below turns each slot into an ordinary variable, which is only
 * equivalent when the array is never seen as a value: a bare `stk` reference (passed,
 * returned, spread, iterated), a dynamic index, or any use of `length` beyond the single
 * truncation write all mean the program can tell the difference, so the whole function is
 * left masked rather than partly rewritten.
 */
function collectStackSites(stkBinding, aliasPath) {
  const violations = stkBinding.constantViolations
  if (aliasPath) {
    // The copy that created this binding is its one legitimate write - see
    // `resolveStackAlias`. Anything beyond it still means the array is reassigned.
    if (violations.length !== 1) {
      return null
    }
    const write = violations[0]
    if (write !== aliasPath && write.getStatementParent() !== aliasPath) {
      return null
    }
  } else if (violations.length !== 0) {
    return null
  }
  const sites = []
  let trunc = null
  for (const ref of stkBinding.referencePaths) {
    const member = ref.parentPath
    if (ref.key !== 'object' || !member.isMemberExpression()) {
      return null
    }
    const key = readSlotKey(member)
    if (key === null) {
      return null
    }
    if (key === 'length') {
      const father = member.parentPath
      if (
        trunc ||
        !father.isAssignmentExpression() ||
        member.key !== 'left' ||
        father.node.operator !== '=' ||
        !father.parentPath.isExpressionStatement()
      ) {
        return null
      }
      trunc = father.parentPath
      continue
    }
    sites.push({ member, key })
  }
  return { sites, trunc }
}

/**
 * Undoes the masking itself: the rest param becomes `len` real parameters again, every
 * remaining slot becomes a real local variable, and the truncation statement goes away.
 *
 * `processStackParam` above resolves what a slot *holds* - folding literals, collapsing
 * aliases, promoting an unconditional dynamic write to a local. It deliberately stops
 * short of the masking itself: an original param stays a bare `stk[i]` read, and so does
 * any slot its safety rules could not classify (anything written inside an `if`, a loop
 * or a `try`, or updated with `++`). Those rules exist to protect *folding a value*, and
 * none of them applies to renaming a slot, which is what this does - so a function that
 * survives the checks above is fully unmasked here regardless of how its slots were
 * classified.
 *
 * All-or-nothing per function, and `len` must be the exact count from the truncation
 * statement (see `readTruncationLength`). Original params occupy keys `0..len-1` and
 * everything else is a local; with an under-counted `len` a real param would be declared
 * as a local and never receive its argument.
 */
/**
 * The binding the slots actually live on, and the statement that put them there.
 *
 * The encoder emits the rest param *as* the stack (`variableMasking.ts`:
 * `params = [restElement(stackName)]`), but ControlFlowFlattening's decode reconstructs a
 * masked function with the stack copied into a separate local first -
 * `function (...rest) { var stk; [...stk] = rest; … }` - and every slot site then sits on
 * that local rather than on the param. Following the copy is what lets those functions
 * un-mask at all: without it `collectStackSites` is handed the param, whose only
 * reference is the copy's right-hand side rather than a member access, and declines.
 */
function resolveStackAlias(func, restName) {
  for (const stmt of func.get('body').get('body')) {
    let target
    let source
    if (
      stmt.isExpressionStatement() &&
      t.isAssignmentExpression(stmt.node.expression, { operator: '=' })
    ) {
      target = stmt.node.expression.left
      source = stmt.node.expression.right
    } else if (
      stmt.isVariableDeclaration() &&
      stmt.node.declarations.length === 1
    ) {
      target = stmt.node.declarations[0].id
      source = stmt.node.declarations[0].init
    } else {
      continue
    }
    if (
      t.isArrayPattern(target) &&
      target.elements.length === 1 &&
      t.isRestElement(target.elements[0]) &&
      t.isIdentifier(target.elements[0].argument) &&
      t.isIdentifier(source) &&
      source.name === restName
    ) {
      return { name: target.elements[0].argument.name, path: stmt }
    }
  }
  return null
}

/**
 * One element of a folded `[a, b = {}] = rest` pattern, as the parameter it would become,
 * or null when it is not one this rewrite can spell.
 *
 * The default's *expression* is the part that does not simply move: a function with a
 * non-simple parameter list gets a parameter scope of its own, and that scope cannot see
 * the body's `var` declarations - so `[a, b = c] = rest` with a body-local `c` would go
 * from reading that local to reading whatever `c` means outside the function, or to
 * nothing. Refuse any default reaching a binding declared inside `func`; one reaching only
 * outer bindings (or none at all, which is the `= {}` the encoder's own dispatcher template
 * carries) means the same thing in either position, since nothing runs before the
 * destructuring for it to observe.
 */
function readFoldedElement(elementPath, func) {
  if (elementPath.isIdentifier()) {
    return { name: elementPath.node.name, defaultValue: null, pattern: null }
  }
  // A nested `[a, [b, c]] = rest` element. The original parameter list was
  // `(a, [b, c])`, so the element moves into the parameter list unchanged - it is the same
  // destructuring, performed one step earlier. `control-flow-graph.js` emits this whenever
  // the function it reconstructed had a pattern parameter, so declining it here leaves every
  // such function rest-masked for its own consumers to trip over.
  if (elementPath.isArrayPattern() || elementPath.isObjectPattern()) {
    const names = Object.keys(t.getBindingIdentifiers(elementPath.node))
    if (!names.length) return null
    return { name: null, defaultValue: null, pattern: elementPath.node, names }
  }
  if (!elementPath.isAssignmentPattern()) {
    return null
  }
  const left = elementPath.get('left')
  if (!left.isIdentifier()) {
    return null
  }
  const defaultPath = elementPath.get('right')
  let capturesOwnScope = false
  const visit = (idPath) => {
    if (capturesOwnScope || !idPath.isReferencedIdentifier()) {
      return
    }
    const binding = idPath.scope.getBinding(idPath.node.name)
    if (!binding) {
      return
    }
    if (binding.scope === func.scope || binding.scope.path.isDescendant(func)) {
      capturesOwnScope = true
    }
  }
  visit(defaultPath)
  defaultPath.traverse({ Identifier: visit })
  if (capturesOwnScope) {
    return null
  }
  return { name: left.node.name, defaultValue: defaultPath.node, pattern: null }
}

/**
 * Un-masks the *fully-folded* rest shape, where no slot read survives to un-mask:
 *
 *     function (...rest) { var a, b; [a, b] = rest; ... }  ->  function (a, b) { ... }
 *
 * This one is produced by our own pipeline rather than by the encoder.
 * control-flow-graph.js gives every function it reconstructs a rest param
 * unconditionally, and the slots are then resolved to plain locals fed by a single
 * destructuring of that param - so by the time this file sees it there is no
 * `rest[i]` left, `readTruncationLength` has no truncation statement to read, and
 * `resolveStackAlias` does not recognise the copy because it accepts only the
 * single-`RestElement` form `[...stk] = rest`.
 *
 * The pattern is its own exact param count: `len` elements with no `RestElement` tail bind
 * exactly the leading `len` slots, and the rest param having no other reference is what
 * rules out an unseen higher slot. An original param that was declared but never read is
 * still dropped, which changes `fn.length` - but a function carrying a rest param already
 * reports `0`, so restoring `len` can only move it back toward the original.
 *
 * An element may carry a default (`[a, b = {}] = rest`), which is why the elements are read
 * by `readFoldedElement` rather than required to be plain identifiers. A destructuring
 * default and a parameter default fire on exactly the same condition - the value being
 * `undefined` - so the two spellings mean the same thing; what differs is where the default
 * *expression* is evaluated and what a defaulted parameter does to the rest of the
 * signature, which is what the two extra guards below cover.
 *
 * All-or-nothing, like `unmaskStack`: anything unexpected leaves the function alone.
 */
function unmaskDestructuredRest(func) {
  const restName = func.node.params?.[0]?.argument?.name
  if (!restName) {
    return false
  }
  const body = func.get('body')
  if (!body.isBlockStatement()) {
    return false
  }
  // Same reasoning as `unmaskStack`: a named param list re-links `arguments` in sloppy
  // mode, so a body reading it can observe the rewrite.
  let usesArguments = false
  body.traverse({
    Identifier(path) {
      if (path.node.name === 'arguments') {
        usesArguments = true
        path.stop()
      }
    },
  })
  if (usesArguments) {
    return false
  }

  body.scope.crawl()
  const restBinding = body.scope.getBinding(restName)
  // Exactly one reference and no writes: feeding the destructuring is the param's only
  // job, so no higher slot can be read and the array is not observable as a value.
  if (
    !restBinding ||
    restBinding.constantViolations.length !== 0 ||
    restBinding.referencePaths.length !== 1
  ) {
    return false
  }
  const ref = restBinding.referencePaths[0]
  const assign = ref.parentPath
  if (
    ref.key !== 'right' ||
    !assign.isAssignmentExpression({ operator: '=' }) ||
    !assign.parentPath.isExpressionStatement() ||
    assign.parentPath.parentPath !== body
  ) {
    return false
  }
  const left = assign.get('left')
  if (!left.isArrayPattern() || left.node.elements.length === 0) {
    return false
  }
  const parts = []
  for (const elementPath of left.get('elements')) {
    const part = readFoldedElement(elementPath, func)
    if (!part) {
      return false
    }
    parts.push(part)
  }
  // A default makes the parameter list non-simple, and a non-simple list is a SyntaxError
  // in a function whose body opens with a directive - `"use strict"` being the one that
  // occurs. Nothing here can be spelled around, so decline the whole rewrite.
  if (
    parts.some((part) => part.defaultValue || part.pattern) &&
    body.node.directives?.length
  ) {
    return false
  }
  const names = parts.flatMap((part) => part.names || [part.name])
  if (new Set(names).size !== names.length) {
    return false
  }

  // Every destructured name must be a bare `var` local of this function. An initializer
  // would be dropped by the rewrite, and a name bound anywhere else is not ours to turn
  // into a parameter.
  const declarators = []
  for (const name of names) {
    const binding = body.scope.getBinding(name)
    if (
      !binding ||
      binding.scope !== body.scope ||
      !binding.path.isVariableDeclarator()
    ) {
      return false
    }
    if (binding.path.node.init) {
      return false
    }
    declarators.push(binding.path)
  }

  // Nothing may run before the destructuring: a read reaching one of these names ahead of
  // it sees `undefined` today and would see the argument afterwards.
  const stmt = assign.parentPath
  for (const before of body.get('body')) {
    if (before === stmt) {
      break
    }
    if (
      !before.isVariableDeclaration() ||
      before.node.declarations.some((d) => d.init)
    ) {
      return false
    }
  }

  func.node.params = parts.map((part) => {
    if (part.pattern) {
      return part.pattern
    }
    return part.defaultValue
      ? t.assignmentPattern(t.identifier(part.name), part.defaultValue)
      : t.identifier(part.name)
  })
  stmt.remove()
  for (const declarator of declarators) {
    if (!declarator.removed) {
      declarator.remove()
    }
  }
  // The params are new bindings and a name can be read from a nested function, so the
  // crawl has to start above this function - as in `unmaskStack`.
  body.scope.getProgramParent().crawl()
  return true
}

export function unmaskStack(func, len) {
  const restName = func.node.params?.[0]?.argument?.name
  if (!restName || !Number.isInteger(len) || len < 0) {
    return
  }
  const body = func.get('body')
  if (!body.isBlockStatement()) {
    return
  }
  // `arguments` reports the real call either way, but a named param list re-links it to
  // the params in sloppy mode, so a function reading it can observe the rewrite.
  let usesArguments = false
  body.traverse({
    Identifier(path) {
      if (path.node.name === 'arguments') {
        usesArguments = true
        path.stop()
      }
    },
  })
  if (usesArguments) {
    return
  }

  body.scope.crawl()
  const alias = resolveStackAlias(func, restName)
  const stk_name = alias ? alias.name : restName
  const stkBinding = body.scope.getBinding(stk_name)
  if (!stkBinding) {
    return
  }
  // With an alias in play the rest param must do nothing else - its only job is to feed
  // the copy, so any other use means the array is still observable as a value.
  if (alias) {
    const restBinding = body.scope.getBinding(restName)
    if (!restBinding || restBinding.referencePaths.length !== 1) {
      return
    }
  }
  const collected = collectStackSites(stkBinding, alias ? alias.path : null)
  if (!collected) {
    return
  }

  const isParamKey = (key) => {
    const index = Number(key)
    return (
      Number.isInteger(index) &&
      String(index) === key &&
      index >= 0 &&
      index < len
    )
  }

  const localKeys = []
  for (const { key } of collected.sites) {
    if (!isParamKey(key) && !localKeys.includes(key)) {
      localKeys.push(key)
    }
  }

  const params = []
  for (let i = 0; i < len; ++i) {
    params.push(body.scope.generateUidIdentifier('p'))
  }
  const locals = new Map(
    localKeys.map((key) => [key, body.scope.generateUidIdentifier('local')]),
  )

  for (const { member, key } of collected.sites) {
    if (member.removed) {
      continue
    }
    const id = isParamKey(key) ? params[Number(key)] : locals.get(key)
    member.replaceWith(t.identifier(id.name))
  }
  if (collected.trunc) {
    collected.trunc.remove()
  }
  // The copy fed the slots off the rest param; with real params back it is dead. Remove
  // it before the params are rewritten, while its own binding still resolves.
  if (alias && !alias.path.removed) {
    alias.path.remove()
  }
  func.node.params = params.map((id) => t.identifier(id.name))
  if (localKeys.length) {
    body.node.body.unshift(
      t.variableDeclaration(
        'var',
        localKeys.map((key) =>
          t.variableDeclarator(t.identifier(locals.get(key).name)),
        ),
      ),
    )
  }
  // The rewritten sites and the new params are whole new bindings, and a slot can be read
  // from a nested function, so the crawl has to start above this function.
  body.scope.getProgramParent().crawl()
  // The copy's own declaration outlives the copy when the two arrived as a separate
  // `var stk;` + `[...stk] = rest;` pair rather than as one initialized declarator - the
  // shape control-flow-graph.js reconstructs (see `resolveStackAlias`). Removing the copy
  // above is what makes it dead, so removing it is this pass's job and not a later
  // cleanup's; `unmaskDestructuredRest` already does the same for the declarators it
  // consumes. Reference-gated, so a slot site this rewrite somehow left behind keeps it.
  if (alias) {
    safeDeleteNode(stk_name, body)
  }
}

const deVariableMasking = {
  RestElement(path) {
    if (path.listKey !== 'params') {
      return
    }
    const func = path.getFunctionParent()
    // The fully-folded shape carries its own exact count and has no slots left to fold,
    // so it is settled here or not at all - nothing below can reach it.
    if (unmaskDestructuredRest(func)) {
      return
    }
    // Read the truncation statement before processStackParam runs, and keep it apart from
    // the inferred fallback: only the exact count is safe to un-mask on.
    const exactLen = readTruncationLength(func)
    const len =
      exactLen !== null ? exactLen : inferParamCountFromCallSites(func)
    if (len === 'unknown') {
      return
    }
    processStackParam(func, len)
    if (exactLen !== null) {
      unmaskStack(func, exactLen)
    }
  },
}

export default deVariableMasking
