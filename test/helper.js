import fs from 'fs'
import { expect } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import * as t from '@babel/types'

// Every node reachable from the Program right now.
function liveNodes(ast) {
  const live = new Set()
  const walk = (node) => {
    if (!node || typeof node.type !== 'string' || live.has(node)) return
    live.add(node)
    for (const key of t.VISITOR_KEYS[node.type] || []) {
      const value = node[key]
      if (Array.isArray(value)) value.forEach(walk)
      else walk(value)
    }
  }
  walk(ast.program || ast)
  return live
}

// Node objects reachable from the Program at more than one position.
//
// An AST is a tree, not a DAG, and a pass breaks that by re-homing a node and then handing one of
// its own subtrees back to another path API - `insertBefore(path.node)` followed by
// `replaceWith(path.node.left)` puts that `left` in two places at once. The text still generates
// correctly, so nothing about the output betrays it.
//
// **No crawl repairs this**, which is what separates it from `detachedReferences` above: a crawl
// records the node twice because it genuinely is reachable twice. The damage is deferred to
// whichever later pass resolves both occurrences - replacing the second finds its parent slot
// already holding what the first replacement put there, the path resyncs to a null key, and
// Babel's validator throws. Clone the subtree rather than re-using it.
export function aliasedNodes(ast) {
  const seen = new Set()
  const aliased = []
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (seen.has(node)) {
      aliased.push(node.type)
      return
    }
    seen.add(node)
    for (const key of t.VISITOR_KEYS[node.type] || []) {
      const value = node[key]
      if (Array.isArray(value)) value.forEach(walk)
      else walk(value)
    }
  }
  walk(ast.program || ast)
  return aliased.sort()
}

// Bindings still pointing at nodes that are no longer in the tree.
//
// A pass that removes nodes leaves the bindings of *other* names holding references into the
// subtree it detached, and every later pass reading `binding.referencePaths` then decides against a
// program that no longer exists. Measured on a real pipeline, the first removing pass detached 90
// of 320 references at a stroke and no later pass cleared them by itself.
//
// Reachability is the only check that sees it, which is why this walks the tree rather than asking
// the path. A stale reference reports `removed === false`, and `ref.find((p) => p.isProgram())` is
// truthy, because the cached parent chain still links it to a Program path object.
export function detachedReferences(ast) {
  const live = liveNodes(ast)
  const stale = []
  traverse(ast, {
    Scopable(path) {
      const { bindings } = path.scope
      for (const name of Object.keys(bindings).sort()) {
        for (const ref of bindings[name].referencePaths) {
          if (!live.has(ref.node)) stale.push(`${name}: ${ref.node.type}`)
        }
      }
    },
  })
  return stale.sort()
}

// Snapshot every binding's reference bookkeeping, reading scope as Babel has
// it cached — i.e. the state the visitor left behind. Babel does not re-crawl
// on inspection, so a missing or mis-scoped crawl() surfaces here as a stale
// reference count even when the generated text is unchanged. Bindings are
// sorted per scope for a stable, order-independent comparison.
function referenceState(ast) {
  const state = []
  traverse(ast, {
    Scopable(path) {
      const { bindings } = path.scope
      for (const name of Object.keys(bindings).sort()) {
        const binding = bindings[name]
        state.push({
          name,
          references: binding.references,
          constant: binding.constant,
          violations: binding.constantViolations.length,
        })
      }
    },
  })
  return state
}

/**
 * Assert the half of a pass's contract that its output text cannot show.
 *
 * A pass rewrites the tree *and* the derived state Babel keeps beside it. Leave that inconsistent
 * and the emitted text is perfect byte for byte, while every later pass consulting it decides
 * against a program that no longer exists. Three independent checks, because they fail differently
 * and no one of them sees the others:
 *
 * - `detachedReferences` - a binding still points at a node the tree no longer holds;
 * - `aliasedNodes` - one node object sits at two positions, which no crawl repairs;
 * - `referenceState` - the cached reference bookkeeping disagrees with a fresh parse of this
 *   pass's own output, which is what an inflated or lost reference count looks like.
 *
 * **Exported so a runner that cannot use the helpers below still inherits the audit.** Passes here
 * come in two shapes - a Babel visitor object, and a function taking the AST - and `getVisitorResult`
 * only accepts the first. A test for a function-shaped pass therefore had to roll its own runner,
 * and every such runner silently opted out of all three checks. That is how four visitors shipped
 * inflated reference counts: not because the oracle was missing, but because it was only reachable
 * from a helper their pass could not be passed to.
 *
 * `cmpCode` is the expected output. **Omit it and the comparison is made against a fresh parse of
 * the tree's own generated output instead**, which is the invariant stated literally and needs no
 * golden: after a pass, its derived state should equal what a fresh parse of its own output would
 * produce. That matters where a golden cannot honestly be reviewed - a fixture harvested from real
 * obfuscated output is thousands of bytes of generated identifiers, and committing a `.fix.js`
 * nobody can read only makes exact string equality look authoritative. Self-comparison pins the
 * claim that is actually being made about such a case, and no more.
 */
export function expectConsistentState(ast, cmpCode, parseOptions = {}) {
  expect(detachedReferences(ast)).toEqual([])
  expect(aliasedNodes(ast)).toEqual([])
  const expectedSource = cmpCode === undefined ? generate(ast).code : cmpCode
  expect(referenceState(ast)).toEqual(
    referenceState(parse(expectedSource, parseOptions)),
  )
}

export function getVisitorResult(visitor, fix, input) {
  const sourceCode = fs.readFileSync(input + '.js', { encoding: 'utf-8' })
  const ast = parse(sourceCode)
  traverse(ast, visitor)
  // The state audit applies to no-op cases too, and deliberately: "output unchanged" is not
  // "nothing happened", so a visitor that removes and rebuilds can leave stale references while
  // the text round-trips. Only the reference-state comparison is fix-only - a case that does not
  // mutate has nothing to compare against.
  //
  // This catches what the visitor inflicts on ITSELF. Staleness inherited from an earlier pass
  // cannot arise here — one visitor, one fresh parse — so it is getPipelineResult that covers the
  // class a real pipeline has.
  if (fix) {
    const cmpCode = fs.readFileSync(input + '.fix.js', { encoding: 'utf-8' })
    expect(generate(ast).code).toBe(cmpCode)
    expectConsistentState(ast, cmpCode)
  } else {
    expect(generate(ast).code).toBe(sourceCode)
    expectConsistentState(ast)
  }
}

/**
 * Run several passes on ONE AST, the way the pipeline does, and check the result.
 *
 * `getVisitorResult` parses fresh and runs a single visitor, so no earlier pass has detached
 * anything and inherited staleness is unreachable by construction. That is the class that actually
 * bites: a pass certified alone, and against fixtures that were built by running the earlier passes
 * and then *writing the result to disk*, is certified across a re-parse — and re-parsing rebuilds
 * every path from text, silently repairing the one state a real pipeline carries forward. One pass
 * here read clean on every residue axis and on runtime equivalence over a whole corpus that way,
 * while being wrong on 108 cells the moment the same pipeline ran on a single AST.
 *
 * So the fixture input must be what the EARLIER passes leave in memory, never a pre-baked file.
 *
 * `passes` are applied in order; each is either a Babel visitor object or a function taking the
 * AST, since the passes in this project come in both shapes.
 */
export function getPipelineResult(passes, fix, input) {
  const sourceCode = fs.readFileSync(input + '.js', { encoding: 'utf-8' })
  const ast = parse(sourceCode, {
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  })
  for (const pass of passes) {
    if (typeof pass === 'function') pass(ast)
    else traverse(ast, pass)
  }
  const cmpCode = fix
    ? fs.readFileSync(input + '.fix.js', { encoding: 'utf-8' })
    : sourceCode
  expect(generate(ast).code).toBe(cmpCode)
  // The same audit `getVisitorResult` runs, and it matters more here, not less: this helper exists
  // to model a real pipeline, and staleness inherited from an earlier pass is the class it was
  // built to expose. Checking only the output text left that class unmeasured - four visitors
  // shipped inflated reference counts past this helper, and the defect surfaced instead as a
  // deleted declaration in a corpus sweep.
  expectConsistentState(ast, fix ? cmpCode : undefined, {
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  })
  return ast
}

export function getPluginResult(plugin, fix, input) {
  const sourceCode = fs.readFileSync(input + '.js', { encoding: 'utf-8' })
  const out = plugin(sourceCode)
  if (fix) {
    const cmpCode = fs.readFileSync(input + '.fix.js', { encoding: 'utf-8' })
    expect(out).toBe(cmpCode)
  } else {
    expect(out).toBe(sourceCode)
  }
}
