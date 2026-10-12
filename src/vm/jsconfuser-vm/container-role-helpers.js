import traverse from '@babel/traverse'

export const EXPECTED_OPCODES = Object.freeze({
  LOAD_CONST: 0,
  LOAD_INT: 1,
  LOAD_GLOBAL: 2,
  LOAD_UPVALUE: 3,
  LOAD_THIS: 4,
  MOVE: 5,
  STORE_GLOBAL: 6,
  STORE_UPVALUE: 7,
  GET_PROP: 8,
  SET_PROP: 9,
  DELETE_PROP: 10,
  ADD: 11,
  SUB: 12,
  MUL: 13,
  DIV: 14,
  MOD: 15,
  EXP: 60,
  BAND: 16,
  BOR: 17,
  BXOR: 18,
  SHL: 19,
  SHR: 20,
  USHR: 21,
  LT: 22,
  GT: 23,
  LTE: 24,
  GTE: 25,
  EQ: 26,
  NEQ: 27,
  LOOSE_EQ: 28,
  LOOSE_NEQ: 29,
  IN: 30,
  INSTANCEOF: 31,
  UNARY_NEG: 32,
  UNARY_POS: 33,
  UNARY_NOT: 34,
  UNARY_BITNOT: 35,
  TYPEOF: 36,
  VOID: 37,
  TYPEOF_SAFE: 38,
  JUMP: 39,
  JUMP_IF_FALSE: 40,
  JUMP_IF_TRUE: 41,
  CALL: 42,
  CALL_METHOD: 43,
  NEW: 44,
  RETURN: 45,
  THROW: 46,
  MAKE_CLOSURE: 47,
  BUILD_ARRAY: 48,
  BUILD_OBJECT: 49,
  DEFINE_GETTER: 50,
  DEFINE_SETTER: 51,
  FOR_IN_SETUP: 52,
  FOR_IN_NEXT: 53,
  TRY_SETUP: 54,
  TRY_END: 55,
  PATCH: 56,
  DEBUGGER: 57,
  JUMP_REG: 58,
  FINALLY_SETUP: 59,
})

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

export function scalarValue(node) {
  if (node?.type === 'NumericLiteral' || node?.type === 'BooleanLiteral') {
    return node.value
  }
  return undefined
}

function isLiteralPoolValue(node, context) {
  if (
    node?.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.prefix &&
    node.argument?.type === 'NumericLiteral' &&
    Number.isInteger(node.argument.value) &&
    node.argument.value > 0 &&
    node.argument.value <= 0x80000000
  ) {
    return true
  }
  if (
    node?.type === 'StringLiteral' ||
    node?.type === 'NumericLiteral' ||
    node?.type === 'BooleanLiteral' ||
    node?.type === 'NullLiteral'
  ) {
    return true
  }
  return isIdentifier(node, 'undefined') && !context.bindingFor(node)
}

export function readPlainObject(node) {
  if (node?.type !== 'ObjectExpression') return null
  const entries = new Map()
  for (const property of node.properties) {
    if (
      property.type !== 'ObjectProperty' ||
      property.computed ||
      property.method
    ) {
      return null
    }
    const key = propertyName(property.key)
    if (key === null || entries.has(key)) return null
    entries.set(key, property.value)
  }
  return entries
}

export function exactNumericObject(node, expected) {
  const entries = readPlainObject(node)
  if (!entries || entries.size !== Object.keys(expected).length) return false
  return Object.entries(expected).every(
    ([key, value]) => numberValue(entries.get(key)) === value,
  )
}

export function isPoolArray(node, context) {
  if (node?.type !== 'ArrayExpression' || node.elements.length === 0) {
    return false
  }
  let hasString = false
  for (const element of node.elements) {
    if (!element || !isLiteralPoolValue(element, context)) return false
    if (element.type === 'StringLiteral') hasString = true
  }
  return hasString
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

export function precedes(left, right) {
  const ancestors = new Map()
  for (let path = left; path?.parentPath; path = path.parentPath)
    ancestors.set(path.parentPath, path)
  for (let path = right; path?.parentPath; path = path.parentPath) {
    const sibling = ancestors.get(path.parentPath)
    if (sibling)
      return (
        (sibling.listKey === path.listKey &&
          typeof sibling.key === 'number' &&
          typeof path.key === 'number' &&
          sibling.key < path.key) ||
        (path.parentPath.isForStatement() &&
          sibling.key === 'init' &&
          path.key === 'body')
      )
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
    sameRef(node, binding) {
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
  return declarations
}

export function isStableDeclaration(declaration) {
  return (
    !!declaration.binding &&
    (declaration.binding.path.node === declaration.node ||
      declaration.binding.identifier === declaration.id) &&
    declaration.binding.constantViolations.length === 0
  )
}

export function uniqueCandidate(candidates, role) {
  if (candidates.length === 1 && isStableDeclaration(candidates[0])) {
    return candidates[0]
  }
  if (candidates.length === 0) {
    decline('missing-role', `Missing mandatory ${role}`)
  }
  decline('ambiguous-role', `Ambiguous ${role}`)
}

export function topLevelVariables(declarations) {
  return declarations.filter((declaration) => declaration.kind === 'variable')
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

export function thisMember(node, property) {
  return member(node, (value) => value?.type === 'ThisExpression', property)
}

export function computedMember(node, objectPredicate, propertyPredicate) {
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    objectPredicate(node.object) &&
    propertyPredicate(node.property)
  )
}

export function slotMember(node, slotsBinding, role, context) {
  return member(node, (value) => context.sameRef(value, slotsBinding), role)
}

export function hasNode(context, rootNode, predicate) {
  return context.nodes(rootNode).some(({ node, path }) => predicate(node, path))
}

function variableDeclarators(context, rootNode) {
  return context
    .nodes(rootNode)
    .filter(({ node }) => node.type === 'VariableDeclarator')
    .map(({ node }) => node)
}

export function findVariable(context, rootNode, predicate) {
  return variableDeclarators(context, rootNode).find((declaration) =>
    predicate(declaration.init, declaration.id),
  )
}

export function binaryParts(node, operator = '+') {
  return node?.type === 'BinaryExpression' && node.operator === operator
    ? [node.left, node.right]
    : null
}

function directAssignments(fn) {
  if (fn.body?.type !== 'BlockStatement') return null
  const assignments = new Map()
  for (const statement of fn.body.body) {
    const expression =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    if (
      expression?.type !== 'AssignmentExpression' ||
      !thisMember(expression.left, propertyName(expression.left.property))
    ) {
      continue
    }
    const property = propertyName(expression.left.property)
    if (assignments.has(property)) return null
    assignments.set(property, expression.right)
  }
  return assignments
}

function constructorShape(fn, fields) {
  const assignments = directAssignments(fn)
  if (!assignments || assignments.size !== fields.length) return null
  if (!fields.every((field) => assignments.has(field))) return null
  return assignments
}

function emptyArray(node) {
  return node?.type === 'ArrayExpression' && node.elements.length === 0
}

function emptyObject(node) {
  return node?.type === 'ObjectExpression' && node.properties.length === 0
}

export function parameterBinding(context, fn, index) {
  const parameter = fn.params[index]
  return isIdentifier(parameter) ? context.bindingFor(parameter) : null
}

export function upvalueShape(fn, context) {
  const assignments = constructorShape(fn, [
    '_regs',
    '_absSlot',
    '_closed',
    '_value',
  ])
  const first = parameterBinding(context, fn, 0)
  const second = parameterBinding(context, fn, 1)
  return (
    !!assignments &&
    fn.params.length === 2 &&
    context.sameRef(assignments.get('_regs'), first) &&
    context.sameRef(assignments.get('_absSlot'), second) &&
    assignments.get('_closed')?.type === 'BooleanLiteral' &&
    assignments.get('_closed').value === false &&
    isIdentifier(assignments.get('_value'), 'undefined') &&
    !context.bindingFor(assignments.get('_value'))
  )
}

export function closureShape(fn, context) {
  const assignments = constructorShape(fn, ['fn', 'upvalues', 'prototype'])
  const first = parameterBinding(context, fn, 0)
  return (
    !!assignments &&
    fn.params.length === 1 &&
    context.sameRef(assignments.get('fn'), first) &&
    emptyArray(assignments.get('upvalues')) &&
    emptyObject(assignments.get('prototype'))
  )
}

export function vmShape(fn, context) {
  const assignments = constructorShape(fn, [
    'bytecode',
    'constants',
    'globals',
    '_openUpvalues',
    '_regs',
    '_regsTop',
    '_f',
  ])
  const bytecode = parameterBinding(context, fn, 0)
  const constants = parameterBinding(context, fn, 1)
  const globals = parameterBinding(context, fn, 2)
  if (
    !assignments ||
    fn.params.length !== 3 ||
    !context.sameRef(assignments.get('bytecode'), bytecode) ||
    !context.sameRef(assignments.get('constants'), constants) ||
    !context.sameRef(assignments.get('globals'), globals) ||
    assignments.get('_openUpvalues')?.type !== 'NullLiteral' ||
    !emptyArray(assignments.get('_regs')) ||
    !isIdentifier(assignments.get('_regsTop')) ||
    numberValue(assignments.get('_f')) !== 0
  ) {
    return null
  }
  return { assignments, frameStart: assignments.get('_regsTop') }
}

export function functionDeclarations(declarations) {
  return declarations
    .filter((declaration) => declaration.kind === 'function')
    .map((declaration) => declaration.init)
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

function isUpvalueRead(fn) {
  if (fn.params.length !== 0 || fn.body?.body.length !== 1) return false
  const statement = fn.body.body[0]
  const expression =
    statement.type === 'ReturnStatement' ? statement.argument : null
  return (
    !!expression &&
    expression.type === 'ConditionalExpression' &&
    thisMember(expression.test, '_closed') &&
    thisMember(expression.consequent, '_value') &&
    computedMember(
      expression.alternate,
      (value) => thisMember(value, '_regs'),
      (value) => thisMember(value, '_absSlot'),
    )
  )
}

function isUpvalueWrite(fn, context) {
  if (fn.params.length !== 1 || fn.body?.body.length !== 1) return false
  const parameter = parameterBinding(context, fn, 0)
  const statement = fn.body.body[0]
  if (
    statement.type !== 'IfStatement' ||
    !thisMember(statement.test, '_closed')
  ) {
    return false
  }
  const assigned = (branch, expectedLeft) => {
    const branchStatement =
      branch?.type === 'BlockStatement'
        ? branch.body.length === 1
          ? branch.body[0]
          : null
        : branch
    const expression =
      branchStatement?.type === 'ExpressionStatement'
        ? branchStatement.expression
        : null
    return (
      expression?.type === 'AssignmentExpression' &&
      expectedLeft(expression.left) &&
      context.sameRef(expression.right, parameter)
    )
  }
  return (
    assigned(statement.consequent, (left) => thisMember(left, '_value')) &&
    assigned(statement.alternate, (left) =>
      computedMember(
        left,
        (value) => thisMember(value, '_regs'),
        (value) => thisMember(value, '_absSlot'),
      ),
    )
  )
}

function isUpvalueClose(fn) {
  if (fn.params.length !== 0 || fn.body?.body.length !== 2) return false
  const first = fn.body.body[0]
  const second = fn.body.body[1]
  const firstExpression =
    first.type === 'ExpressionStatement' ? first.expression : null
  const secondExpression =
    second.type === 'ExpressionStatement' ? second.expression : null
  return (
    firstExpression?.type === 'AssignmentExpression' &&
    thisMember(firstExpression.left, '_value') &&
    computedMember(
      firstExpression.right,
      (value) => thisMember(value, '_regs'),
      (value) => thisMember(value, '_absSlot'),
    ) &&
    secondExpression?.type === 'AssignmentExpression' &&
    thisMember(secondExpression.left, '_closed') &&
    secondExpression.right?.type === 'BooleanLiteral' &&
    secondExpression.right.value === true
  )
}

export function upvalueMethodRoles(methods, context) {
  return {
    read: methods.filter(({ fn }) => isUpvalueRead(fn)),
    write: methods.filter(({ fn }) => isUpvalueWrite(fn, context)),
    close: methods.filter(({ fn }) => isUpvalueClose(fn)),
  }
}

export function methodCall(
  context,
  rootNode,
  objectPredicate,
  methodName,
  firstArgument = null,
) {
  return hasNode(context, rootNode, (node) => {
    if (
      node.type !== 'CallExpression' ||
      node.callee?.type !== 'MemberExpression' ||
      node.callee.computed ||
      propertyName(node.callee.property) !== methodName ||
      !objectPredicate(node.callee.object)
    ) {
      return false
    }
    return (
      firstArgument === null ||
      context.sameRef(node.arguments[0], firstArgument)
    )
  })
}

export function newCall(context, rootNode, constructorBinding) {
  return hasNode(
    context,
    rootNode,
    (node) =>
      node.type === 'NewExpression' &&
      context.sameRef(node.callee, constructorBinding),
  )
}
