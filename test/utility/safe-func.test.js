import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import * as t from '@babel/types'
import { expect, test } from 'vitest'
import safeFunc from '../../src/utility/safe-func.js'

const traverse = _traverse.default || _traverse
const { safeDeleteNode } = safeFunc

const SRC = `
function outer() {
  function wrapper(...rest) {
    var carried = 1;
    return legacy(rest, carried);
  }
  return wrapper;
}
`

/**
 * Sets up what a caller holds when it resolved a deletion target *before* a pass rewrote the
 * enclosing function body - the shape `decodeFlattenedFunction` produces when it installs a
 * decoded body over an outlined wrapper. `keepsTarget` decides whether the name being deleted
 * survives that rewrite.
 */
function rewriteWrapperBody(keepsTarget) {
  const ast = parse(SRC)
  let fnPath = null
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id && p.node.id.name === 'wrapper') fnPath = p
    },
  })

  // Resolved against the pre-rewrite body, and deliberately kept across the rewrite.
  const staleBinding = fnPath.scope.getBinding('carried')

  const stmts = []
  if (keepsTarget) {
    stmts.push(
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier('carried'), t.numericLiteral(1)),
      ]),
    )
  }
  stmts.push(t.returnStatement(t.numericLiteral(0)))
  fnPath.node.body = t.blockStatement(stmts)

  return { fnPath, staleBinding }
}

test('deletes an unreferenced binding that survived a wrapper-body rewrite', () => {
  const { fnPath, staleBinding } = rewriteWrapperBody(true)
  expect(safeDeleteNode('carried', staleBinding.path)).toBe(true)
  expect(fnPath.node.body.body).toHaveLength(1)
})

test('declines instead of throwing when the rewrite dropped the target', () => {
  // The internal re-crawl rebuilds the scope from the new body, where `carried` no longer
  // exists, so the refreshed lookup finds nothing. Before the guard this dereferenced
  // undefined and took the whole pass down.
  const { fnPath, staleBinding } = rewriteWrapperBody(false)
  expect(() => safeDeleteNode('carried', staleBinding.path)).not.toThrow()
  expect(safeDeleteNode('carried', staleBinding.path)).toBe(false)
  expect(fnPath.node.body.body).toHaveLength(1)
})

test('declines a binding that is still referenced', () => {
  const ast = parse(SRC)
  let fnPath = null
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id && p.node.id.name === 'wrapper') fnPath = p
    },
  })
  const binding = fnPath.scope.getBinding('carried')
  expect(safeDeleteNode('carried', binding.path)).toBe(false)
  expect(fnPath.node.body.body).toHaveLength(2)
})

test('reports no such binding rather than deleting by name', () => {
  const ast = parse(SRC)
  let programPath = null
  traverse(ast, {
    Program(p) {
      programPath = p
    },
  })
  expect(safeDeleteNode('neverDeclared', programPath)).toBe(false)
})

/**
 * `safeReplace` drops the brackets from a `["text"]` key once the expression inside it
 * resolves to a string. A concealed key has to be written computed - a call cannot sit in a
 * plain key slot - so without this every restored key stays `["k"]` and matchers written
 * against the encoder's own `{ k() {} }` form decline.
 */
function replaceKeyExpression(src, value) {
  const ast = parse(src)
  traverse(ast, {
    CallExpression(p) {
      safeFunc.safeReplace(p, value)
      p.stop()
    },
  })
  return ast
}

function onlyMember(ast) {
  let found = null
  traverse(ast, {
    'ObjectProperty|ObjectMethod|ClassMethod'(p) {
      if (!found) found = p.node
    },
  })
  return found
}

test('un-computes a resolved string key on an object method', () => {
  const member = onlyMember(replaceKeyExpression('var o = { [d(1, 2)]() {} };', 'run'))
  expect(member.computed).toBe(false)
  expect(member.key.value).toBe('run')
})

test('un-computes a resolved string key on an object property', () => {
  const member = onlyMember(replaceKeyExpression('var o = { [d(1, 2)]: 1 };', 'a'))
  expect(member.computed).toBe(false)
})

test('keeps a key that is not a valid identifier, which is still sound', () => {
  const member = onlyMember(replaceKeyExpression('var o = { [d(1, 2)]: 1 };', 'a-b'))
  expect(member.computed).toBe(false)
  expect(member.key.value).toBe('a-b')
})

test('leaves __proto__ computed on an object property - un-computing sets the prototype', () => {
  const member = onlyMember(replaceKeyExpression('var o = { [d(1, 2)]: x };', '__proto__'))
  expect(member.computed).toBe(true)
})

test('un-computes __proto__ on a method, where the special case does not apply', () => {
  const member = onlyMember(replaceKeyExpression('var o = { [d(1, 2)]() {} };', '__proto__'))
  expect(member.computed).toBe(false)
})

test('leaves constructor computed on a class - un-computing makes it the constructor', () => {
  const member = onlyMember(
    replaceKeyExpression('class C { [d(1, 2)]() {} }', 'constructor'),
  )
  expect(member.computed).toBe(true)
})

test('leaves a static prototype key computed', () => {
  const member = onlyMember(
    replaceKeyExpression('class C { static [d(1, 2)]() {} }', 'prototype'),
  )
  expect(member.computed).toBe(true)
})

test('leaves a computed member expression alone - only key positions are rewritten', () => {
  const ast = replaceKeyExpression('o[d(1, 2)] = 1;', 'k')
  let member = null
  traverse(ast, {
    MemberExpression(p) {
      member = p.node
    },
  })
  expect(member.computed).toBe(true)
})
