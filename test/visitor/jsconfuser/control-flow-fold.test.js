import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { expect, test } from 'vitest'
import controlFlow from '#visitor/jsconfuser/control-flow-graph.js'

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

function codeOf(statements) {
  return statements.map((node) => generate(node).code)
}

test('foldBranchesInGraph: a plain sequential chain flattens to a statement list', () => {
  const [s1] = programStatementPaths('a();')
  const [s2] = programStatementPaths('b();')
  const root = {
    type: 'sequential',
    statements: [s1],
    next: {
      type: 'sequential',
      statements: [s2],
      next: { type: 'end', statements: [] },
    },
  }
  expect(codeOf(controlFlow.foldBranchesInGraph(root))).toEqual([
    'a();',
    'b();',
  ])
})

test('foldBranchesInGraph: a return terminates the chain with a real ReturnStatement', () => {
  const [s1] = programStatementPaths('a();')
  const argument = returnArgumentPath('function f() { return 5; }')
  const root = {
    type: 'sequential',
    statements: [s1],
    next: { type: 'return', statements: [], argument },
  }
  expect(codeOf(controlFlow.foldBranchesInGraph(root))).toEqual([
    'a();',
    'return 5;',
  ])
})

test('foldBranchesInGraph: two arms that both return fold to if/else with no trailing code', () => {
  const testPath = returnArgumentPath('function f() { return cond; }')
  const [consStmt] = programStatementPaths('x = 1;')
  const [altStmt] = programStatementPaths('x = 2;')
  const consArg = returnArgumentPath('function f() { return x; }')
  const altArg = returnArgumentPath('function f() { return x; }')
  const root = {
    type: 'branch',
    statements: [],
    test: testPath,
    consequent: {
      type: 'return',
      statements: [consStmt],
      argument: consArg,
    },
    alternate: {
      type: 'return',
      statements: [altStmt],
      argument: altArg,
    },
  }
  const statements = controlFlow.foldBranchesInGraph(root)
  expect(codeOf(statements)).toEqual([
    'if (cond) {\n  x = 1;\n  return x;\n} else {\n  x = 2;\n  return x;\n}',
  ])
})

test('foldBranchesInGraph: two arms that reconverge emit the shared tail once, after the if', () => {
  const testPath = returnArgumentPath('function f() { return cond; }')
  const [consStmt] = programStatementPaths('z = z - 1;')
  const [altStmt] = programStatementPaths('z = z + 1;')
  const [mergeStmt] = programStatementPaths('log(z);')
  const mergeArg = returnArgumentPath('function f() { return z; }')
  const merge = {
    type: 'return',
    statements: [mergeStmt],
    argument: mergeArg,
  }
  const root = {
    type: 'branch',
    statements: [],
    test: testPath,
    consequent: { type: 'sequential', statements: [consStmt], next: merge },
    alternate: { type: 'sequential', statements: [altStmt], next: merge },
  }
  const statements = controlFlow.foldBranchesInGraph(root)
  expect(codeOf(statements)).toEqual([
    'if (cond) {\n  z = z - 1;\n} else {\n  z = z + 1;\n}',
    'log(z);',
    'return z;',
  ])
})

test('foldBranchesInGraph: an empty alternate arm folds without an else block', () => {
  const testPath = returnArgumentPath('function f() { return cond; }')
  const [consStmt] = programStatementPaths('doThing();')
  const [mergeStmt] = programStatementPaths('after();')
  const merge = {
    type: 'sequential',
    statements: [mergeStmt],
    next: { type: 'end', statements: [] },
  }
  const root = {
    type: 'branch',
    statements: [],
    test: testPath,
    consequent: { type: 'sequential', statements: [consStmt], next: merge },
    alternate: merge,
  }
  const statements = controlFlow.foldBranchesInGraph(root)
  expect(codeOf(statements)).toEqual([
    'if (cond) {\n  doThing();\n}',
    'after();',
  ])
})

test('foldBranchesInGraph: two branches whose arms disagree on where they reconverge fails closed', () => {
  const t0 = returnArgumentPath('function f() { return t0; }')
  const tc = returnArgumentPath('function f() { return tc; }')
  const ta = returnArgumentPath('function f() { return ta; }')
  const nodeXArg = returnArgumentPath('function f() { return x; }')
  const nodeYArg = returnArgumentPath('function f() { return y; }')
  const nodeX = { type: 'return', statements: [], argument: nodeXArg }
  const nodeY = { type: 'return', statements: [], argument: nodeYArg }

  // Two independent inner diamonds that each reference *both* nodeX and nodeY, so each
  // of nodeX/nodeY ends up with refCount 2 - reached as a direct branch-arm from two
  // different places, not through any shared private prefix.
  const consequentInner = {
    type: 'branch',
    statements: [],
    test: tc,
    consequent: nodeX,
    alternate: nodeY,
  }
  const alternateInner = {
    type: 'branch',
    statements: [],
    test: ta,
    consequent: nodeY,
    alternate: nodeX,
  }
  const root = {
    type: 'branch',
    statements: [],
    test: t0,
    consequent: consequentInner,
    alternate: alternateInner,
  }
  expect(controlFlow.foldBranchesInGraph(root)).toBeNull()
})

test('declareIntroducedVariables: builds a var declaration for a non-empty name list', () => {
  const decl = controlFlow.declareIntroducedVariables(['a', 'b', 'c'])
  expect(generate(decl).code).toBe('var a, b, c;')
})

test('declareIntroducedVariables: returns null for an empty list rather than an empty declaration', () => {
  expect(controlFlow.declareIntroducedVariables([])).toBeNull()
})
