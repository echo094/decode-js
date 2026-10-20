import traverse from '@babel/traverse'
import { CANONICAL_OPCODES as EXPECTED_OPCODES } from './opcode-table.js'

export { EXPECTED_OPCODES }

export const EXPECTED_SENTINELS = Object.freeze({ CALL_SPREAD: 65535 })

export const EXPECTED_SLOTS = Object.freeze({
  PC: 0,
  CALLER: 1,
  RET_DST: 2,
  THIS: 3,
  CLOSURE: 4,
  HANDLERS: 5,
  FRAME_SIZE: 6,
  REG_BASE: 7,
})

export const PARSER_OPTIONS = Object.freeze({
  allowReturnOutsideFunction: true,
  errorRecovery: false,
  sourceType: 'script',
})

export class ContainerDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ContainerDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new ContainerDecline(code, message)
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export function isIdentifier(node, name = null) {
  return node?.type === 'Identifier' && (name === null || node.name === name)
}

export function propertyName(node) {
  if (isIdentifier(node)) return node.name
  if (node?.type === 'StringLiteral') return node.value
  return null
}

export function numberValue(node) {
  return node?.type === 'NumericLiteral' && Number.isFinite(node.value)
    ? node.value
    : null
}

export function isWordArray(node) {
  if (node?.type !== 'ArrayExpression' || node.elements.length === 0) {
    return false
  }
  return node.elements.every((element) => {
    const value = numberValue(element)
    return (
      value !== null &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 0xffffffff
    )
  })
}

function isWithin(path, rootNode) {
  for (let current = path; current; current = current.parentPath) {
    if (current.node === rootNode) return true
  }
  return false
}

export function makeContext(ast) {
  const paths = new Map()
  let programPath
  traverse(ast, {
    enter(path) {
      paths.set(path.node, path)
    },
    Program(path) {
      programPath = path
    },
  })
  if (!programPath) decline('malformed-input', 'Expected a Babel Program')

  const context = {
    ast,
    program: programPath.node,
    paths,
    programPath,
    bindingFor(node) {
      if (!isIdentifier(node)) return null
      const path = paths.get(node)
      return path?.scope.getBinding(node.name) ?? null
    },
    isReference(node, binding) {
      if (!isIdentifier(node) || !binding) return false
      const path = paths.get(node)
      return (
        !!path &&
        path.isReferencedIdentifier() &&
        path.scope.getBinding(node.name) === binding
      )
    },
    nodes(rootNode) {
      return [...paths.entries()]
        .filter(([node]) => isWithin(paths.get(node), rootNode))
        .map(([node, path]) => ({ node, path }))
    },
    // A lowered table handler's SSA version (`{ssa, index}`) refers to its binding.
    sameRef(node, binding) {
      if (node?.ssa) return !!binding && node.ssa === binding
      return context.isReference(node, binding)
    },
  }
  return context
}

export function topLevelDeclarations(context) {
  const declarations = []
  for (const statement of context.program.body) {
    if (statement.type === 'VariableDeclaration') {
      for (const declaration of statement.declarations) {
        if (!isIdentifier(declaration.id)) continue
        declarations.push({
          id: declaration.id,
          init: declaration.init,
          kind: 'variable',
          name: declaration.id.name,
          node: declaration,
          statement,
          binding: context.bindingFor(declaration.id),
        })
      }
    } else if (statement.type === 'FunctionDeclaration') {
      if (!isIdentifier(statement.id)) continue
      declarations.push({
        id: statement.id,
        init: statement,
        kind: 'function',
        name: statement.id.name,
        node: statement,
        statement,
        binding: context.bindingFor(statement.id),
      })
    }
  }
  for (const declaration of declarations) {
    if (declaration.kind !== 'variable' || declaration.init) continue
    const write = definingWrite(context, declaration.binding)
    if (!write) continue
    declaration.init = write.node.right
    declaration.definingWrite = write.node
  }
  // A function value bound once is the same role as a function declaration.
  for (const declaration of declarations) {
    if (
      declaration.kind === 'variable' &&
      declaration.init?.type === 'FunctionExpression' &&
      isStableDeclaration(declaration)
    )
      declaration.kind = 'function'
  }
  return declarations
}

// The value of a bare top-level var is its only write when that write is a
// top-level `name = value` statement and no earlier top-level statement reads
// the binding. Declarator placement is spelling; the single
// write executed before every read is what the program depends on.
function definingWrite(context, binding) {
  const writes = binding?.constantViolations ?? []
  if (writes.length !== 1) return null
  const write = writes[0]
  const statement = write.parentPath
  if (
    !write.isAssignmentExpression({ operator: '=' }) ||
    !isIdentifier(write.node.left) ||
    !statement?.isExpressionStatement() ||
    !statement.parentPath?.isProgram()
  )
    return null
  const body = context.program.body
  const at = body.indexOf(statement.node)
  const readFirst = binding.referencePaths.some((reference) => {
    if (reference.getFunctionParent()) return false
    const top = reference.find((path) => path.parentPath?.isProgram())
    return body.indexOf(top?.node) < at
  })
  return readFirst ? null : write
}

export function isStableDeclaration(declaration) {
  const writes = declaration.binding?.constantViolations ?? []
  return (
    !!declaration.binding &&
    (declaration.binding.path.node === declaration.node ||
      declaration.binding.identifier === declaration.id) &&
    (writes.length === 0 ||
      (writes.length === 1 && writes[0].node === declaration.definingWrite))
  )
}

export function referencePaths(context, binding, rootNode = context.program) {
  if (!binding) return []
  return context
    .nodes(rootNode)
    .filter(({ node }) => context.isReference(node, binding))
    .map(({ path }) => path)
}

export function referenceCount(context, binding, rootNode = context.program) {
  return referencePaths(context, binding, rootNode).length
}

export function member(node, objectPredicate, property, computed = false) {
  if (node?.type !== 'MemberExpression' || node.computed !== computed) {
    return false
  }
  if (
    typeof objectPredicate === 'function'
      ? !objectPredicate(node.object)
      : node.object !== objectPredicate
  ) {
    return false
  }
  return propertyName(node.property) === property
}

export function prototypeMethods(context, owner) {
  const methods = []
  for (const statement of context.program.body) {
    if (
      statement.type !== 'ExpressionStatement' ||
      statement.expression.type !== 'AssignmentExpression'
    ) {
      continue
    }
    const left = statement.expression.left
    if (
      left?.type !== 'MemberExpression' ||
      left.computed ||
      left.object?.type !== 'MemberExpression' ||
      !member(
        left.object,
        (value) => context.sameRef(value, owner.binding),
        'prototype',
      ) ||
      statement.expression.right?.type !== 'FunctionExpression'
    ) {
      continue
    }
    methods.push({
      fn: statement.expression.right,
      name: propertyName(left.property),
      node: statement,
    })
  }
  return methods
}
