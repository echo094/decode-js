import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { expect, test } from 'vitest'
import controlFlow from '#visitor/jsconfuser/control-flow-graph.js'

// Scope-flattening doesn't need a dispatcher/vector at all (it's pure syntactic
// renaming), so these build minimal graph-node-shaped objects directly around parsed
// statements rather than going through parseDispatcher/resolveBlockGraph.
function programStatementPaths(code) {
  const ast = parse(code)
  let paths
  traverse(ast, {
    Program(path) {
      paths = path.get('body')
      path.stop()
    },
  })
  return paths
}

function returnArgumentPath(code) {
  const ast = parse(code)
  let argPath
  traverse(ast, {
    ReturnStatement(path) {
      argPath = path.get('argument')
      path.stop()
    },
  })
  return argPath
}

test('flattenScopeMembersInGraph: renames a scope[prop][var] chain to a plain identifier', () => {
  const statements = programStatementPaths(`
    scope["_0"]["aB1"] = 1;
  `)
  const node = { type: 'sequential', statements, next: { statements: [] } }
  const names = controlFlow.flattenScopeMembersInGraph(node, {
    scopeName: 'scope',
  })
  expect(names).toEqual(['aB1'])
  expect(generate(statements[0].node).code).toBe('aB1 = 1;')
})

test('flattenScopeMembersInGraph: the same pair resolves to the same identifier everywhere', () => {
  const statements = programStatementPaths(`
    scope["_0"]["aB1"] = 1;
    scope["_0"]["aB1"] = scope["_0"]["aB1"] + 2;
  `)
  const node = { type: 'sequential', statements, next: { statements: [] } }
  controlFlow.flattenScopeMembersInGraph(node, { scopeName: 'scope' })
  expect(statements.map((p) => generate(p.node).code)).toEqual([
    'aB1 = 1;',
    'aB1 = aB1 + 2;',
  ])
})

test('flattenScopeMembersInGraph: disambiguates two different pairs that would collide on the same generated name', () => {
  const statements = programStatementPaths(`
    scope["_0"]["x"] = 1;
    scope["_1"]["x"] = 2;
  `)
  const node = { type: 'sequential', statements, next: { statements: [] } }
  const names = controlFlow.flattenScopeMembersInGraph(node, {
    scopeName: 'scope',
  })
  expect(names).toEqual(['x', 'x_2'])
  expect(statements.map((p) => generate(p.node).code)).toEqual([
    'x = 1;',
    'x_2 = 2;',
  ])
})

test('flattenScopeMembersInGraph: renames a bare chain used as a whole return argument', () => {
  const argument = returnArgumentPath(`
    function f() { return scope["_0"]["z"]; }
  `)
  const node = { type: 'return', statements: [], argument }
  controlFlow.flattenScopeMembersInGraph(node, { scopeName: 'scope' })
  expect(generate(argument.node).code).toBe('z')
})

test('flattenScopeMembersInGraph: renames a dot-notation scope.prop.var chain (minify rewrite)', () => {
  // `minify.ts`'s `a["key"] -> a.key` rewrite turns a bracketed scope-member chain into dot
  // notation whenever both keys are valid identifier names - `flattenScopeMembersInGraph`
  // must recognize this form exactly like the bracketed one, not just leave it untouched.
  const statements = programStatementPaths(`
    scope.aB1v2.xYz = 1;
  `)
  const node = { type: 'sequential', statements, next: { statements: [] } }
  const names = controlFlow.flattenScopeMembersInGraph(node, {
    scopeName: 'scope',
  })
  expect(names).toEqual(['xYz'])
  expect(generate(statements[0].node).code).toBe('xYz = 1;')
})

test('flattenScopeMembersInGraph: a mixed bracket/dot chain (only the key that is a compile-time identifier is rewritten by minify) still resolves', () => {
  const statements = programStatementPaths(`
    scope["aB1v2"].xYz = 1;
  `)
  const node = { type: 'sequential', statements, next: { statements: [] } }
  const names = controlFlow.flattenScopeMembersInGraph(node, {
    scopeName: 'scope',
  })
  expect(names).toEqual(['xYz'])
  expect(generate(statements[0].node).code).toBe('xYz = 1;')
})

test('flattenScopeMembersInGraph: leaves a one-level scope[prop] access untouched', () => {
  const statements = programStatementPaths(`
    doSomething(scope["_0"]);
  `)
  const node = { type: 'sequential', statements, next: { statements: [] } }
  const names = controlFlow.flattenScopeMembersInGraph(node, {
    scopeName: 'scope',
  })
  expect(names).toEqual([])
  expect(generate(statements[0].node).code).toBe('doSomething(scope["_0"]);')
})

test('flattenScopeMembersInGraph: walks branch/sequential/return nodes and visits shared merge nodes once', () => {
  const end = { type: 'end', statements: [] }
  const consequentStatements = programStatementPaths(
    'scope["_0"]["z"] = scope["_0"]["z"] - 1;',
  )
  const alternateStatements = programStatementPaths(
    'scope["_0"]["z"] = scope["_0"]["z"] + 1;',
  )
  const testArgument = returnArgumentPath(
    'function f() { return scope["_0"]["z"] > 10; }',
  )
  const root = {
    type: 'branch',
    statements: [],
    test: testArgument,
    consequent: {
      type: 'sequential',
      statements: consequentStatements,
      next: end,
    },
    alternate: {
      type: 'sequential',
      statements: alternateStatements,
      next: end,
    },
  }
  controlFlow.flattenScopeMembersInGraph(root, { scopeName: 'scope' })
  expect(generate(root.test.node).code).toBe('z > 10')
  expect(generate(consequentStatements[0].node).code).toBe('z = z - 1;')
  expect(generate(alternateStatements[0].node).code).toBe('z = z + 1;')
})
