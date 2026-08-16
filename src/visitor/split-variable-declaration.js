import * as t from '@babel/types'

/**
 * Whether this traversal split anything, so the exit handler knows if a crawl is owed. Module-level
 * because a visitor object carries no per-run state; `Program.enter` resets it per run.
 */
let splitSomething = false

function splitVariableDeclaration(path) {
  // The scope of a for statement is its body
  if (path.parentPath.isFor()) {
    return
  }
  // The container must be an array
  if (!path.listKey) {
    return
  }
  const kind = path.node.kind
  const list = path.node.declarations
  if (list.length == 1) {
    return
  }
  for (let item of list) {
    path.insertBefore(t.variableDeclaration(kind, [item]))
  }
  path.remove()
  splitSomething = true
}

/**
 * Split the VariableDeclaration if it has more than one VariableDeclarator
 *
 * This operation will only be performed when its container is an array
 *
 * **The crawl restores an invariant this rewrite breaks**: after a pass, the scope information
 * Babel has cached should equal what a fresh parse of that pass's own output would produce. Each
 * declarator is re-homed into a new declaration by `insertBefore`, and re-homing a subtree
 * registers its references a second time, with nothing detached - the same live node listed twice.
 *
 * **This replaces a `path.scope.crawl()` that used to run here and made things worse.** All three
 * options were measured on one real sample against a 1448-reference baseline: the old
 * `path.scope.crawl()` gave **37 duplicates** and 1485 references, because crawling a scope
 * narrower than the program appends to outer-scope bindings that already hold those references;
 * removing the crawl entirely **lost** references, reporting 1096; and one program-scoped crawl on
 * the way out gives exactly 1448 with none duplicated. Note that `path` has been removed by then,
 * so its own `.scope` is not the right thing to ask - `Program.exit` is.
 *
 * Gated because a crawl is only owed when something moved, and a crawl cannot change the tree - so
 * this is invisible to output and free on a traversal that split nothing.
 */
export default {
  Program: {
    enter() {
      splitSomething = false
    },
    exit(path) {
      if (splitSomething) path.scope.crawl()
    },
  },
  VariableDeclaration: splitVariableDeclaration,
}
