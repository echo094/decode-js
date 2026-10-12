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

export function createRestoreVarInitializers(onChange = () => {}) {
  const claimed = new Set()
  let changed = false
  return {
    Program: {
      enter() {
        claimed.clear()
        changed = false
      },
      exit(path) {
        if (changed) path.scope.crawl()
      },
    },
    ExpressionStatement(path) {
      const expression = path.get('expression')
      if (
        !path.inList ||
        !(path.parentPath.isProgram() || path.parentPath.isBlockStatement()) ||
        !expression.isAssignmentExpression({ operator: '=' }) ||
        !expression.get('left').isIdentifier()
      )
        return
      const binding = path.scope.getBinding(expression.node.left.name)
      if (
        !binding ||
        claimed.has(binding) ||
        !binding.path.isVariableDeclarator() ||
        binding.path.node.init ||
        binding.path.parentPath.node.kind !== 'var' ||
        !binding.path.parentPath.inList
      )
        return
      // Initialization stays at the assignment site, including inside a branch.
      // var still hoists to the same function/program; later writes stay writes.
      const declaration = t.variableDeclaration('var', [
        t.variableDeclarator(
          t.cloneNode(expression.node.left),
          t.cloneNode(expression.node.right, true),
        ),
      ])
      claimed.add(binding)
      binding.path.remove()
      path.replaceWith(declaration)
      changed = true
      onChange()
    },
  }
}

function functionUse(ref) {
  const parent = ref.parentPath
  if (
    ref.key === 'callee' &&
    (parent.isCallExpression() || parent.isNewExpression())
  )
    return true
  // The VM installs methods; a prototype read/escape is not an installation.
  if (
    !parent.isMemberExpression({ computed: false }) ||
    ref.key !== 'object' ||
    !t.isIdentifier(parent.node.property, { name: 'prototype' })
  )
    return false
  const member = parent.parentPath
  return (
    member.isMemberExpression() &&
    member.parentPath.isAssignmentExpression({ operator: '=' }) &&
    member.key === 'left' &&
    member.parentPath.get('right').isFunctionExpression()
  )
}

function inertFunctionPrefix(statement) {
  return (
    t.isFunctionDeclaration(statement) ||
    (t.isVariableDeclaration(statement, { kind: 'var' }) &&
      statement.declarations.every(
        (declaration) =>
          t.isIdentifier(declaration.id) &&
          (!declaration.init || t.isFunctionExpression(declaration.init)),
      ))
  )
}

export function createPromoteVmFunctions(onChange = () => {}) {
  let changed = false
  let reflective = false
  return {
    Program: {
      enter(path) {
        changed = false
        reflective = false
        // This bounded VM preparation does not rewrite observed function names,
        // constructor reflection or direct eval. It is not a public optimizer.
        path.traverse({
          'MemberExpression|OptionalMemberExpression'(member) {
            const key = member.node.property
            const name = member.node.computed
              ? t.isStringLiteral(key) && key.value
              : t.isIdentifier(key) && key.name
            if (['name', 'constructor', 'toString'].includes(name))
              reflective = true
          },
          CallExpression(call) {
            if (
              t.isIdentifier(call.node.callee, { name: 'eval' }) &&
              !call.scope.getBinding('eval')
            )
              reflective = true
          },
        })
      },
      exit(path) {
        if (changed) path.scope.crawl()
      },
    },
    VariableDeclaration(path) {
      if (
        reflective ||
        !path.parentPath.isProgram() ||
        path.node.kind !== 'var' ||
        path.node.declarations.length !== 1 ||
        !path.parentPath.node.body.slice(0, path.key).every(inertFunctionPrefix)
      )
        return
      const declaration = path.get('declarations.0')
      const fn = declaration.get('init')
      if (!declaration.get('id').isIdentifier() || !fn.isFunctionExpression())
        return
      const binding = path.scope.getBinding(declaration.node.id.name)
      if (
        !binding?.constant ||
        binding.path !== declaration ||
        !binding.referencePaths.length ||
        !binding.referencePaths.every(functionUse)
      )
        return
      if (fn.node.id) {
        const inner = fn.scope.getOwnBinding(fn.node.id.name)
        if (inner?.references || inner?.constantViolations.length) return
      }
      // Only the initial function-definition group may become hoisted. No
      // executable statement can observe an earlier initialization there.
      const promoted = t.cloneNode(fn.node, true)
      promoted.type = 'FunctionDeclaration'
      promoted.id = t.cloneNode(declaration.node.id)
      path.replaceWith(promoted)
      changed = true
      onChange()
    },
  }
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
  traverse(ast, createRestoreVarInitializers(note))
  traverse(ast, createPromoteVmFunctions(note))
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
