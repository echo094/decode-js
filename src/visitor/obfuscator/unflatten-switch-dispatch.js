import * as t from '@babel/types'

/**
 * Undo javascript-obfuscator's block-statement control-flow flattening: a block whose statements
 * have been shuffled into a `switch`, driven in the original order by a `"|"`-joined string of
 * case indexes.
 *
 *   {
 *     const C = '2|0|3|1|4'['split']('|');
 *     let I = 0;
 *     while (true) {
 *       switch (C[I++]) {
 *         case '0': <statement>; continue;
 *         ...
 *         case '4': return <expr>;
 *       }
 *       break;
 *     }
 *   }
 *
 * **The reversal is a permutation read, and this pass is written as one.** The controller string
 * holds, for each *original* statement position, the index of the case that now carries it. So
 * reading it left to right and indexing the case list recovers the original order directly, in one
 * step, with no scanning.
 *
 * A copy of the shared `remove-control-flow-ob.js` was rejected rather than adapted. That visitor
 * reaches the same output on this encoder - it decodes every live flattened block in the frozen
 * corpus - but it gets there by *walking forward from each index until it meets a `continue`*, a
 * generality this encoder never needs, and three of its behaviours off that path are worse than
 * declining. Its own doc records them. This file exists because a shared visitor cannot be
 * narrowed without changing what two other plugins get, not because its output here was wrong.
 *
 * **Every check happens before any mutation.** The pass either rewrites a block completely or
 * leaves it exactly as it found it; there is no point at which it has removed a declaration and
 * then discovers it cannot continue. That is the difference that makes a decline safe, and it is
 * why the invariants are gathered into `match()` rather than tested as it goes.
 */

/** `while (true)`, and nothing else. */
function isAlwaysTrueTest(node) {
  return t.isBooleanLiteral(node, { value: true })
}

/**
 * `C[I++]` - a computed read of one identifier indexed by the suffix increment of another.
 *
 * Checked in full before anything is read off it. The shared visitor checks only that the
 * discriminant is a `MemberExpression` and then reads `property.argument.name`, which throws on a
 * discriminant like `C[I]` and takes the whole decode down with it.
 */
function readDispatch(node) {
  if (!t.isMemberExpression(node) || !node.computed) return null
  if (!t.isIdentifier(node.object)) return null
  const p = node.property
  if (!t.isUpdateExpression(p) || p.operator !== '++' || p.prefix) return null
  if (!t.isIdentifier(p.argument)) return null
  return { controller: node.object.name, index: p.argument.name }
}

/**
 * A case that contributes no statement at all. Distinct from `null`, which is this function's
 * reject signal - the two must not collapse, because one means "skip this slot" and the other
 * means "do not touch this block".
 */
const EMPTY_CASE = Symbol('empty-case')

/** The three consequent shapes this encoder emits, and no others. */
function readConsequent(cs) {
  if (cs.length === 2 && t.isContinueStatement(cs[1]) && !cs[1].label)
    return cs[0]
  if (cs.length === 1 && t.isReturnStatement(cs[0])) return cs[0]
  // A bare `continue` is an EMPTY case, and the encoder does emit one: control-flow flattening
  // runs at stage 4 and puts a function's leading directive into a case like any other statement,
  // then `DirectivePlacementTransformer` re-emits that directive at the top of the scope during
  // `Finalizing` - leaving the case it came from with nothing in it. Any function whose body opens
  // with `'use strict'` and gets flattened produces this, which is a large slice of real-world
  // input. Omitting the slot is the whole reversal: the order string is a permutation, so the case
  // is visited exactly once, and executing it does nothing but return to the loop.
  if (cs.length === 1 && t.isContinueStatement(cs[0]) && !cs[0].label)
    return EMPTY_CASE
  return null
}

/** Directive values already emitted at the top of the lexical scope containing this loop. */
function readScopeDirectives(path) {
  const directives = path.parentPath.node.directives
  if (!Array.isArray(directives)) return []
  return directives.map((directive) => directive.value.value)
}

/**
 * Restore the permutation while omitting the original copy of a directive that Finalizing has
 * already re-emitted at the top of this scope.
 *
 * From 5.2.0 the encoder removes a recorded directive only from the scope's direct `body`. If
 * control-flow flattening moved it into a switch case first, that identity node survives there as
 * an ordinary string expression even though a cloned directive is also present at scope level.
 * It can only occupy the leading source slot: a directive recorded by the encoder came from the
 * directive prologue. Matching only that prefix is important — an identical string expression
 * later in the function is ordinary executable content and must survive.
 */
function rebuildStatements(statements, parts, scopeDirectives) {
  const rebuilt = []
  let directiveIndex = 0
  let inDirectivePrefix = scopeDirectives.length > 0

  for (const part of parts) {
    const statement = statements[Number(part)]
    if (statement === EMPTY_CASE) {
      // Before 5.2.0 the recursive removal leaves the directive's case empty. It still occupies
      // the leading source slot, so consume the corresponding already-emitted scope directive.
      if (inDirectivePrefix && directiveIndex < scopeDirectives.length)
        directiveIndex++
      continue
    }
    if (
      inDirectivePrefix &&
      directiveIndex < scopeDirectives.length &&
      t.isExpressionStatement(statement) &&
      t.isStringLiteral(statement.expression, {
        value: scopeDirectives[directiveIndex],
      })
    ) {
      directiveIndex++
      continue
    }
    inDirectivePrefix = false
    rebuilt.push(statement)
  }

  return rebuilt
}

/**
 * Resolve a name to the declarator that binds it: a declarator in a **preceding sibling
 * declaration** of the loop, in the same block.
 *
 * Scanning previous siblings handles `simplify`'s fused `var C = …, I = 0;` for free, since it
 * walks each declaration's declarator list. Resolving by *binding* instead is unsound, and a
 * hand-built case caught it:
 *
 *   function f() { if (x) { var C = '1|0'.split('|'); var I = 0; }
 *                  while (true) { switch (C[I++]) { … } break; } }
 *
 * `var` hoists, so the binding resolves - but the *initialisation* is conditional. When `x` is
 * falsy `C` is `undefined`, the switch matches nothing, and the block does nothing. Rewriting it
 * to the linear body would run statements the original never runs. Requiring the declaration to
 * precede the loop as a sibling is a cheap sufficient condition for the initialisation dominating
 * the dispatch, and it is exactly what the shared visitor's previous-sibling scan enforced by
 * accident.
 *
 * **It reads the current tree, not the scope's cached bindings, and that is not a style choice.**
 * `scope.getBinding()` hands back a path recorded at the last crawl, and the passes that must run
 * before this one - constant folding, branch pruning, the storage inlining - replace nodes
 * wholesale. The binding then points at a detached node that still *prints* identically to the one
 * in the tree, so an identity comparison against it silently fails and every real block declines.
 * Measured: resolving by binding rejected all 108 live corpus blocks while accepting hand-built
 * ones, because only the hand-built trees had never been rewritten.
 */
function resolveDeclarator(path, name) {
  for (const sibling of path.getAllPrevSiblings()) {
    if (!sibling.isVariableDeclaration()) continue
    for (let i = 0; i < sibling.node.declarations.length; i++) {
      const declarator = sibling.get(`declarations.${i}`)
      if (t.isIdentifier(declarator.node.id, { name })) return declarator
    }
  }
  return null
}

/**
 * Is every mention of `name` inside `path`?
 *
 * Asked by walking the enclosing statement list rather than by reading `binding.referencePaths`,
 * for the same staleness reason as above. Cheap, since the search is bounded by the block the loop
 * sits in.
 */
function usedOnlyInside(path, name) {
  let outside = 0
  const parent = path.parentPath
  parent.traverse({
    Identifier(id) {
      if (id.node.name !== name) return
      if (id.findParent((q) => q === path)) return
      // the declarator's own id is a binding site, not a use
      if (
        id.parentPath.isVariableDeclarator() &&
        id.parentPath.node.id === id.node
      )
        return
      outside++
    },
  })
  return outside === 0
}

/** `'2|0|3'['split']('|')` or `'2|0|3'.split('|')`, after constant folding has run. */
function readOrderString(init) {
  if (!t.isCallExpression(init) || init.arguments.length !== 1) return null
  if (!t.isStringLiteral(init.arguments[0], { value: '|' })) return null
  const callee = init.callee
  if (!t.isMemberExpression(callee)) return null
  const prop = callee.property
  const name = t.isStringLiteral(prop)
    ? prop.value
    : t.isIdentifier(prop)
      ? prop.name
      : null
  if (name !== 'split') return null
  if (!t.isStringLiteral(callee.object)) return null
  return callee.object.value
}

/**
 * Decide whether this `while` is a flattened block, and gather everything the rewrite needs.
 *
 * Returns `null` for anything that is not exactly the emitted shape. The strictness is the point:
 * an ordinary `while (!done) { switch (state) { ... } break; }` is a perfectly common thing to
 * write, and a looser gate rewrites it into straight-line code that runs once.
 */
function match(path) {
  const node = path.node
  if (!isAlwaysTrueTest(node.test)) return null
  if (!t.isBlockStatement(node.body) || node.body.body.length !== 2) return null
  const [head, tail] = node.body.body
  if (!t.isSwitchStatement(head)) return null
  if (!t.isBreakStatement(tail) || tail.label) return null

  const dispatch = readDispatch(head.discriminant)
  if (!dispatch) return null

  const cases = head.cases
  if (!cases.length) return null

  // Case tests are `String(i)` in ascending order, and there is no `default`. A `default` would
  // mean an execution path the order string does not describe.
  for (let i = 0; i < cases.length; i++) {
    if (!t.isStringLiteral(cases[i].test, { value: String(i) })) return null
  }

  // Every consequent is one of the two emitted shapes. Anything else - a bare fallthrough, an
  // extra statement, a labelled `continue` - means the tree is not what this pass assumes, and
  // walking forward through it is what duplicates statements.
  const statements = cases.map((c) => readConsequent(c.consequent))
  if (statements.some((s) => s === null)) return null

  const controllerDecl = resolveDeclarator(path, dispatch.controller)
  const indexDecl = resolveDeclarator(path, dispatch.index)
  if (!controllerDecl || !indexDecl) return null

  const order = readOrderString(controllerDecl.node.init)
  if (order === null) return null

  const indexInit = indexDecl.node.init
  if (!t.isNumericLiteral(indexInit, { value: 0 })) return null

  // The order is a permutation of the case indexes: same length, every index once. A shorter or
  // longer order string, or a repeated index, means the two halves disagree about the block.
  const parts = order.split('|')
  if (parts.length !== cases.length) return null
  const seen = new Set()
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const idx = Number(part)
    if (idx >= cases.length || seen.has(idx)) return null
    seen.add(idx)
  }

  // Neither control variable may be touched anywhere but inside this loop, or removing its
  // declaration changes what the surrounding code can see.
  //
  // Stated as containment rather than as a count, because the index is *necessarily* mutated -
  // `I++` is the dispatch - so a "no writes" gate can never pass, and a "one reference" gate
  // depends on whether Babel books that increment as a read, a write, or both. Asking whether
  // every use sits under the node being replaced is the property actually needed, and it does not
  // depend on that bookkeeping.
  if (!usedOnlyInside(path, dispatch.controller)) return null
  if (!usedOnlyInside(path, dispatch.index)) return null

  return {
    statements,
    parts,
    controllerDecl,
    indexDecl,
    scopeDirectives: readScopeDirectives(path),
  }
}

/**
 * @param {(info: object) => void} [onChange] notified once per rewritten block, so a caller can
 *   run a pipeline to a fixpoint without re-serializing the tree.
 */
export function createUnflattenSwitchDispatch(onChange) {
  return {
    WhileStatement: {
      exit(path) {
        const found = match(path)
        if (!found) return
        const {
          statements,
          parts,
          controllerDecl,
          indexDecl,
          scopeDirectives,
        } = found

        // Read the controller left to right: position k names the case holding original
        // statement k. Empty cases drop out here rather than at the gate, so the permutation
        // check above still sees every index.
        const rebuilt = rebuildStatements(statements, parts, scopeDirectives)

        controllerDecl.remove()
        indexDecl.remove()
        // Every case empty is a block that does nothing. `replaceWithMultiple([])` is not a
        // removal, so ask for one explicitly.
        if (rebuilt.length === 0) path.remove()
        else path.replaceWithMultiple(rebuilt)
        if (onChange) onChange({ count: rebuilt.length })
      },
    },
  }
}

export default createUnflattenSwitchDispatch()
