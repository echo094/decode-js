import traverse from '@babel/traverse'
import * as t from '@babel/types'
import {
  isControlBodyKey,
  simpleControlBody,
} from '../source/normalize-source.js'

// The initializers a loop head runs before its last one, as assignments: a `var` list's earlier
// declarators that have one, or a sequence's earlier expressions.
function leadingInitializers(init) {
  if (init?.type === 'VariableDeclaration' && init.kind === 'var')
    return init.declarations
      .slice(0, -1)
      .filter((item) => item.init)
      .map((item) => t.assignmentExpression('=', item.id, item.init))
  if (init?.type === 'SequenceExpression') return init.expressions.slice(0, -1)
  return []
}

// Each statement-level write stands alone: `var x = v, y = w` (not a loop head) and `x = v, y = w`
// read as `x = v; y = w;`. In place on `nodes`; also used for matcher templates.
export function normalizeStatements(nodes) {
  traverse(t.file(t.program([t.blockStatement(nodes)])), {
    noScope: true,
    // Brace spelling: a control body holding one simple statement is that statement
    // (normalize-source.js applies the same view).
    exit(path) {
      for (const key of ['consequent', 'alternate', 'body']) {
        const body = path.node[key]
        if (
          body &&
          !Array.isArray(body) &&
          isControlBodyKey(path.node.type, key) &&
          simpleControlBody(body) !== body
        )
          path.node[key] = simpleControlBody(body)
      }
    },
    VariableDeclaration(path) {
      if (path.node.kind !== 'var' || t.isFor(path.parent)) return
      path.replaceWithMultiple(
        path.node.declarations
          .filter((item) => item.init)
          .map((item) =>
            t.expressionStatement(
              t.assignmentExpression('=', item.id, item.init),
            ),
          ),
      )
    },
    // A loop head's leading initializers run once before the loop: `for (var a = x, i = 0; ...)`
    // reads as `a = x; for (var i = 0; ...)`, and likewise for a sequence.
    ForStatement(path) {
      const init = path.node.init
      const leading = leadingInitializers(init)
      if (init?.type === 'VariableDeclaration' && leading.length > 0)
        init.declarations = init.declarations.slice(-1)
      else if (init?.type === 'SequenceExpression')
        path.node.init = init.expressions.at(-1)
      // `for (var x = v; ...)` reads as `for (x = v; ...)`: the var belongs to the function.
      const rest = path.node.init
      if (
        rest?.type === 'VariableDeclaration' &&
        rest.kind === 'var' &&
        rest.declarations.length === 1 &&
        rest.declarations[0].init
      ) {
        const [only] = rest.declarations
        path.node.init = t.assignmentExpression('=', only.id, only.init)
      }
      if (leading.length > 0)
        path.insertBefore(leading.map((item) => t.expressionStatement(item)))
    },
    ExpressionStatement(path) {
      if (path.node.expression.type !== 'SequenceExpression') return
      path.replaceWithMultiple(
        path.node.expression.expressions.map((item) =>
          t.expressionStatement(item),
        ),
      )
    },
  })
  return nodes
}
