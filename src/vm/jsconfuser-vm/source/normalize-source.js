import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import uncomputeMember from '../../../visitor/atomic/uncompute-member.js'
import uncomputePropertyKey from '../../../visitor/atomic/uncompute-property-key.js'

const SIMPLE_STATEMENTS = new Set([
  'ExpressionStatement',
  'ReturnStatement',
  'ThrowStatement',
  'BreakStatement',
  'ContinueStatement',
])
const LOOP_TYPES = new Set([
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
])

// A read-only view also used on reference templates. Never erase a lexical
// declaration, directive, nested conditional (dangling else), or function body.
export function simpleControlBody(node) {
  return t.isBlockStatement(node) &&
    node.body.length === 1 &&
    !node.directives?.length &&
    SIMPLE_STATEMENTS.has(node.body[0].type)
    ? node.body[0]
    : node
}

export function isControlBodyKey(type, key) {
  return type === 'IfStatement'
    ? key === 'consequent' || key === 'alternate'
    : LOOP_TYPES.has(type) && key === 'body'
}

// Whether this traversal replaced a body, so `Program.exit` knows a crawl is owed; `Program.enter`
// resets it for each traversal. A caller's traversal state counts each replacement in `changes`.
let changed = false

export const normalizeControlBodies = {
  Program: {
    enter() {
      changed = false
    },
    exit(path) {
      if (changed) path.scope.crawl()
    },
  },
  'IfStatement|ForStatement|ForInStatement|ForOfStatement|WhileStatement|DoWhileStatement':
    {
      exit(path, state) {
        const keys = path.isIfStatement()
          ? ['consequent', 'alternate']
          : ['body']
        for (const key of keys) {
          const original = path.node[key]
          const body = simpleControlBody(original)
          if (body === original) continue
          path.get(key).replaceWith(t.cloneNode(body, true))
          changed = true
          if (state) state.changes += 1
        }
      },
    },
}

export function normalizeVmAst(ast) {
  const state = { changes: 0 }
  traverse(ast, uncomputeMember, undefined, state)
  traverse(ast, uncomputePropertyKey, undefined, state)
  traverse(ast, normalizeControlBodies, undefined, state)
  return state.changes > 0
}

export default function normalizeVmInput(source) {
  if (typeof source !== 'string') return source
  let ast
  try {
    ast = parse(source, { errorRecovery: false, sourceType: 'script' })
  } catch (error) {
    if (error instanceof SyntaxError) return source
    throw error
  }
  return normalizeVmAst(ast) ? generate(ast).code : source
}
