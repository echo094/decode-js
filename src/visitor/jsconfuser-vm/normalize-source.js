import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { createUncomputeMember } from '../atomic/uncompute-member.js'
import { createUncomputePropertyKey } from '../atomic/uncompute-property-key.js'

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

export function createNormalizeControlBodies(onChange = () => {}) {
  let changed = false
  return {
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
        exit(path) {
          const keys = path.isIfStatement()
            ? ['consequent', 'alternate']
            : ['body']
          for (const key of keys) {
            const original = path.node[key]
            const body = simpleControlBody(original)
            if (body === original) continue
            path.get(key).replaceWith(t.cloneNode(body, true))
            changed = true
            onChange()
          }
        },
      },
  }
}

export function normalizeVmAst(ast) {
  let changed = false
  const note = () => {
    changed = true
  }
  traverse(ast, createUncomputeMember(note))
  traverse(ast, createUncomputePropertyKey(note))
  traverse(ast, createNormalizeControlBodies(note))
  return changed
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
