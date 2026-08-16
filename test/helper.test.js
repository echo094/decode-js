import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { detachedReferences } from './helper.js'

/**
 * The detector guards every visitor test, so it has to be shown capable of failing. A check that
 * only ever reports zero is indistinguishable from one whose population is empty by construction,
 * and that is the exact failure it exists to catch elsewhere.
 */

test('detachedReferences is empty on a freshly parsed tree', () => {
  const ast = parse('var a = 1;\nfunction f() {\n  return a;\n}\nf();')
  expect(detachedReferences(ast)).toEqual([])
})

test('detachedReferences reports a reference detached by a node removal', () => {
  const ast = parse('var a = 1;\nfunction f() {\n  return a;\n}\nf();')

  // Cache the bindings first: this is the state a pass inherits from the one before it.
  traverse(ast, {
    Program(path) {
      path.scope.crawl()
    },
  })

  // Detach the subtree holding the only reference to `a`, without telling Babel.
  traverse(ast, {
    FunctionDeclaration(path) {
      path.node.body.body = []
    },
  })

  expect(detachedReferences(ast)).toEqual(['a: Identifier'])
})
