import * as t from '@babel/types'

/**
 * Whether this traversal rewrote anything, so the exit handler knows if a crawl is owed.
 *
 * Module-level because a visitor object carries no per-run state. Safe because every consumer
 * invokes this as a standalone, synchronous `traverse(ast, lintIfStatement)` and `Program.enter`
 * resets it at the start of each run.
 */
let rewroteSomething = false

function LintIfStatement(path) {
  let { test, consequent, alternate } = path.node
  let changed = false
  if (!t.isBlockStatement(consequent)) {
    consequent = t.blockStatement([consequent])
    changed = true
  }
  if (alternate && !t.isBlockStatement(alternate)) {
    alternate = t.blockStatement([alternate])
    changed = true
  }
  if (!changed) {
    return
  }
  path.replaceWith(t.ifStatement(test, consequent, alternate))
  rewroteSomething = true
}

/**
 * The crawl restores an invariant this rewrite breaks: after a pass, the scope information Babel
 * has cached should equal what a fresh parse of that pass's own output would produce.
 *
 * `replaceWith` is handed a new `IfStatement` built from the old node's own `test`, `consequent`
 * and `alternate`, and it registers those reused subtrees' references a *second* time. Nothing is
 * detached and nothing sits at two positions - `binding.referencePaths` simply lists the same live
 * node twice, and `binding.references` counts it twice. Measured on one real sample: 139 duplicate
 * entries, 1587 recorded references against 1448 that exist.
 *
 * That is invisible to output, which is what makes it dangerous rather than untidy. A later
 * consumer asking "have I resolved every reference to this binding, may I delete its declaration?"
 * compares its own tally against the inflated one, and the extra entries let that check pass while
 * a live reference goes unhandled - deleting a declaration the program still needs, with no
 * diagnostic and well-formed output text.
 *
 * The crawl must be **program-scoped and once per traversal**. Crawling a narrower scope makes it
 * worse: it appends to outer-scope bindings that already hold those references. Gated because a
 * crawl is only owed when something moved, and a crawl cannot change the tree - so this is
 * invisible to output and costs nothing on a traversal that rewrote nothing.
 */
export default {
  Program: {
    enter() {
      rewroteSomething = false
    },
    exit(path) {
      if (rewroteSomething) path.scope.crawl()
    },
  },
  IfStatement: {
    exit: LintIfStatement,
  },
}
