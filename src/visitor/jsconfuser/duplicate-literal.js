import * as t from '@babel/types'

import safeFunc from '../../utility/safe-func.js'
const safeDeleteNode = safeFunc.safeDeleteNode

/**
 * Normalizes a literal-array element to the node that should be substituted at
 * each reference site, or returns null if it isn't a literal element at all.
 *
 * DuplicateLiteralsRemoval emits StringLiteral/NumericLiteral/BooleanLiteral/
 * NullLiteral, or a bare `undefined` identifier
 * (transforms/extraction/duplicateLiteralsRemoval.ts's own `createLiteral`) -
 * but Minify runs after it and re-spells two of those forms, `undefined` as
 * `void 0` and the booleans as `!0`/`!1`. Those minified spellings have to be
 * recognized here rather than left to the generic constant folding later in the
 * pipeline: matchDuplicateLiteralArray needs *every* element to be a literal,
 * so a single `void 0` fails the whole array closed and leaves every reference
 * to it in place.
 *
 * Negative numbers never appear here - Babel parses `-7` as
 * `UnaryExpression{-, NumericLiteral(7)}`, and the encoder's literal scan only
 * ever visits the inner (always non-negative) NumericLiteral, so the wrapping
 * unary minus is left untouched at every reference site instead of being folded
 * into the array.
 */
function normalizeLiteralArrayElement(node) {
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    (t.isIdentifier(node) && node.name === 'undefined')
  ) {
    return node
  }
  if (t.isUnaryExpression(node) && t.isNumericLiteral(node.argument)) {
    // `void <number>` is Minify's `undefined`; `!0`/`!1` are its booleans.
    if (node.operator === 'void') return t.identifier('undefined')
    if (node.operator === '!') return t.booleanLiteral(!node.argument.value)
  }
  return null
}

/**
 * Matches `<id> = [lit, lit, ...]` - every element a plain literal, no holes.
 * Doesn't require a specific position (the encoder always prepends the array to
 * Program, but nothing downstream of this decoder needs that checked).
 */
function matchLiteralArray(id, array) {
  if (!t.isIdentifier(id) || !t.isArrayExpression(array)) return null

  const { elements } = array
  if (elements.length === 0) return null
  const normalized = []
  for (const el of elements) {
    if (!el) return null
    const norm = normalizeLiteralArrayElement(el)
    if (!norm) return null
    normalized.push(norm)
  }

  return { arrayName: id.name, elements: normalized }
}

/**
 * The array as the encoder itself emits it: `const arrayName = [...]`.
 *
 * Reassignment disqualifies it for the same reason it does in the moved-declaration
 * match below: an array whose contents can change has no fixed element for a read to
 * resolve to, and substituting the initializer's element anyway is wrong rather than
 * merely unreadable (`var a = [9]; a = [1]; a[0]` is 1, not 9).
 */
function matchDuplicateLiteralArray(path) {
  const match = matchLiteralArray(path.node.id, path.node.init)
  if (!match) return null
  const binding = path.scope.getBinding(match.arrayName)
  if (!binding || binding.path.node !== path.node) return null
  if (binding.constantViolations.length !== 0) return null
  return { ...match, binding }
}

/**
 * The same array after MovedDeclarations got at it. MovedDeclarations is encoder
 * Order 25 and DuplicateLiteralsRemoval Order 22, so it runs afterwards and can
 * rewrite the array's own single-declarator `var arrayName = [...]` into a hoisted
 * bare `var arrayName;` plus a separate `arrayName = [...]` assignment elsewhere
 * (`movedDeclarations.ts:189-196`, the same mechanism that produced the CFF harness
 * cliff). That half of MovedDeclarations is deliberately not reversed - it is valid,
 * readable code - so this decoder has to accept the spelling instead.
 *
 * Requires the declarator to be a bare `var` and this to be the binding's only
 * assignment: DuplicateLiteralsRemoval's array is written exactly once and read
 * everywhere, so anything reassigned later is some other array whose contents can
 * change, and no read of it is safely substitutable.
 */
function matchMovedDuplicateLiteralArray(path) {
  if (path.node.operator !== '=') return null
  const match = matchLiteralArray(path.node.left, path.node.right)
  if (!match) return null

  const binding = path.scope.getBinding(match.arrayName)
  if (
    !binding ||
    !binding.path.isVariableDeclarator() ||
    binding.path.node.init
  ) {
    return null
  }
  if (
    binding.constantViolations.length !== 1 ||
    binding.constantViolations[0].node !== path.node
  ) {
    return null
  }
  return { ...match, binding }
}

/**
 * Whether `member` is read, rather than written or deleted.
 *
 * DuplicateLiteralsRemoval only ever reads its array, so a write means this is some other
 * literal-shaped array that merely matched - and substituting the element there produces
 * `"length" = 1`, which is broken rather than merely unreadable. The check is cheap and
 * unconditional because a false negative only leaves a reference undecoded.
 */
function isReadPosition(member) {
  const parent = member.parentPath
  if (!parent) return false
  const { node, key } = { node: parent.node, key: member.key }
  if (t.isAssignmentExpression(node) && key === 'left') return false
  if (t.isUpdateExpression(node)) return false
  if (t.isUnaryExpression(node) && node.operator === 'delete') return false
  if ((t.isForOfStatement(node) || t.isForInStatement(node)) && key === 'left')
    return false
  // Destructuring targets: `[literals[0]] = x` / `({ a: literals[0] } = x)`.
  if (
    t.isArrayPattern(node) ||
    t.isObjectPattern(node) ||
    t.isRestElement(node)
  )
    return false
  if (
    t.isObjectProperty(node) &&
    key === 'value' &&
    parent.parentPath?.isObjectPattern()
  ) {
    return false
  }
  return true
}

/**
 * Whether `path` still sits at the position it recorded, i.e. it is safe to replace.
 *
 * References to the array can nest - `literals[literals[3]]` puts one reference inside
 * another's member expression - so replacing the outer one leaves the inner path stale
 * while `binding.referencePaths` still lists it. A stale path keeps a usable `.node` and
 * still reports `removed === false`, and its `.key` only becomes null inside
 * `replaceWith`'s own `resync()`, too late to test. Babel's Identifier validator then
 * dereferences that null key, so replacing a stale path throws instead of no-opping.
 * Checking the containment invariant directly is the only test that holds beforehand.
 */
function isAttached(path) {
  return (
    !path.removed &&
    path.node &&
    path.container &&
    path.key !== null &&
    path.container[path.key] === path.node
  )
}

/**
 * Fresh closure state per call (RGF recursively re-invokes the whole
 * pipeline on each eval-wrapped sub-program, so module-level state would
 * leak between runs). The array is always Program-scoped, so a plain name
 * set is enough for cleanup - no per-candidate scope tracking needed, unlike
 * dead-code.js's guard function which can live in any nested block.
 */
export default function deDuplicateLiteralInit() {
  const cleanupCandidates = new Set()

  return {
    Program: {
      exit(path) {
        path.scope.crawl()
        for (const name of cleanupCandidates) {
          safeDeleteNode(name, path)
        }
      },
    },

    VariableDeclarator(path) {
      substituteArrayReads(matchDuplicateLiteralArray(path), cleanupCandidates)
    },

    AssignmentExpression(path) {
      substituteArrayReads(
        matchMovedDuplicateLiteralArray(path),
        cleanupCandidates,
      )
    },
  }
}

function substituteArrayReads(match, cleanupCandidates) {
  if (!match) return
  const { binding } = match

  // Collect first, substitute only if *every* indexed read resolves.
  //
  // ControlFlowFlattening is encoder Order 24 and DuplicateLiteralsRemoval Order 22,
  // so CFF runs afterwards and rewrites some of this array's reference sites to index
  // through its own state array - `literals[state[0x45] + 0x377]`. Those are opaque
  // until the CFF decode has run, which is much later in this pipeline.
  //
  // Substituting only the readable ones leaves the array half-decoded, and that is
  // worse than leaving it alone: passes further down key on how a slot is *spelled*,
  // so VariableMasking sees `slot[-1]` in one place and `slot[-literals[1]]` in
  // another, treats them as two different slots, and splits one object into two. So
  // this bails as a unit, and the second pass scheduled after the CFF decode picks the
  // array up once every index has become a plain numeric literal.
  const pending = []
  for (const ref of binding.referencePaths) {
    if (!isAttached(ref)) continue
    if (ref.key !== 'object' || !ref.parentPath.isMemberExpression()) {
      // A reference to the array as a whole can't be substituted, but it also can't
      // produce two spellings of one slot, so it doesn't block the others.
      continue
    }
    const member = ref.parentPath
    if (!isAttached(member) || !member.node.computed) continue
    // A write means this isn't DuplicateLiteralsRemoval's array at all - that one is
    // only ever read - so its contents can change and no read of it is safely
    // substitutable. Bail on the whole array rather than skipping the one site.
    if (!isReadPosition(member)) return

    const prop = member.node.property
    if (!t.isNumericLiteral(prop) || !Number.isInteger(prop.value)) {
      // An index that isn't a resolved number yet is the CFF-wrapped case above: the
      // same slot will be spelled differently here than at the sites that do
      // substitute, so bail on the array as a whole.
      return
    }
    if (prop.value < 0 || prop.value >= match.elements.length) {
      // Out of range indexes no slot at all. It is already a plain number, so it has
      // no second spelling to disagree with and no later pass will resolve it
      // differently - skipping just this site is safe.
      continue
    }

    pending.push({ member, index: prop.value })
  }

  if (pending.length === 0) return
  for (const { member, index } of pending) {
    if (!isAttached(member)) continue
    member.replaceWith(t.cloneNode(match.elements[index], true))
  }
  cleanupCandidates.add(match.arrayName)
}
