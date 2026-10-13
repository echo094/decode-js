import { parse } from '@babel/parser'
import { propertyName } from './container-role-helpers.js'

// These clauses describe operations, not sample text. Only the closed statement
// spellings below are normalized; unknown AST operations remain unmatched.
// Value arrays preserve one slot per argument/element/parameter. Only statement
// lists discard a sequence's unused result and expose its ordered effects.
function statementList(nodes) {
  return nodes.flatMap((node) => statementShape(node))
}
function statementExpression(node) {
  if (node.type === 'SequenceExpression')
    return node.expressions.flatMap(statementExpression)
  const expression = valueShape(node)
  if (
    expression?.type === 'LogicalExpression' &&
    expression.left?.type === 'AssignmentExpression' &&
    expression.left.operator === '=' &&
    expression.left.left.type === 'Identifier'
  ) {
    return [expression.left, { ...expression, left: expression.left.left }]
  }
  if (
    expression?.type === 'AssignmentExpression' &&
    expression.operator === '=' &&
    (expression.left.type === 'Identifier' ||
      (expression.left.type === 'MemberExpression' &&
        !expression.left.computed &&
        expression.left.object.type === 'ThisExpression' &&
        expression.left.property.type === 'Identifier')) &&
    expression.right?.type === 'AssignmentExpression' &&
    expression.right.operator === '=' &&
    expression.right.left.type === 'Identifier'
  ) {
    // A lexical identifier or this.fixedName has a stable reference whose
    // evaluation has no getter, coercion or mutable local-receiver read.
    // Computed/member references otherwise keep their original evaluation order.
    return [expression.right, { ...expression, right: expression.right.left }]
  }
  return expression
}
function statementShape(node) {
  if (!node) return null
  if (Array.isArray(node)) return statementList(node)
  if (node.type === 'BlockStatement') return statementList(node.body)
  if (node.type === 'ExpressionStatement')
    return statementExpression(node.expression)
  if (node.type === 'VariableDeclaration') {
    if (node.kind !== 'var') return { type: 'UnsupportedDeclaration' }
    return node.declarations.flatMap((decl) =>
      decl.init
        ? [
            {
              type: 'AssignmentExpression',
              operator: '=',
              left: decl.id,
              right: valueShape(decl.init),
            },
          ]
        : [],
    )
  }
  if (node.type === 'ForStatement') {
    return [
      ...(node.init ? [statementShape(node.init)].flat() : []),
      {
        type: node.type,
        init: null,
        test: valueShape(node.test),
        update: valueShape(node.update),
        body: [statementShape(node.body)].flat(),
      },
    ]
  }
  if (node.type === 'IfStatement') {
    const result = {
      type: node.type,
      test: valueShape(node.test),
      consequent: [statementShape(node.consequent)].flat(),
      alternate: node.alternate
        ? [statementShape(node.alternate)].flat()
        : null,
    }
    if (
      result.test?.type === 'AssignmentExpression' &&
      result.test.operator === '=' &&
      result.test.left.type === 'Identifier'
    )
      return [result.test, { ...result, test: result.test.left }]
    if (
      result.test?.type === 'LogicalExpression' &&
      result.test.left?.type === 'AssignmentExpression' &&
      result.test.left.operator === '=' &&
      result.test.left.left.type === 'Identifier'
    )
      return [
        result.test.left,
        { ...result, test: { ...result.test, left: result.test.left.left } },
      ]
    return result
  }
  if (node.type === 'WhileStatement')
    return {
      type: node.type,
      test: valueShape(node.test),
      body: [statementShape(node.body)].flat(),
    }
  return statementExpression(node)
}
function valueShape(node) {
  if (!node) return null
  if (Array.isArray(node)) return node.map(valueShape)
  if (node.type === 'BlockStatement') return statementList(node.body)
  if (
    node.type === 'ExpressionStatement' ||
    node.type === 'VariableDeclaration' ||
    node.type === 'IfStatement' ||
    node.type === 'ForStatement' ||
    node.type === 'WhileStatement'
  )
    return statementShape(node)
  if (node.type === 'TemplateElement')
    return {
      type: node.type,
      value: { cooked: node.value.cooked },
      tail: node.tail,
    }
  if (node.type === 'Identifier' || node.type === 'ThisExpression') return node
  const keys = {
    SequenceExpression: ['expressions'],
    AssignmentExpression: ['operator', 'left', 'right'],
    BinaryExpression: ['operator', 'left', 'right'],
    LogicalExpression: ['operator', 'left', 'right'],
    UnaryExpression: ['operator', 'prefix', 'argument'],
    UpdateExpression: ['operator', 'prefix', 'argument'],
    MemberExpression: ['computed', 'object', 'property'],
    CallExpression: ['callee', 'arguments'],
    NewExpression: ['callee', 'arguments'],
    ReturnStatement: ['argument'],
    ThrowStatement: ['argument'],
    BreakStatement: ['label'],
    ContinueStatement: ['label'],
    IfStatement: ['test', 'consequent', 'alternate'],
    ConditionalExpression: ['test', 'consequent', 'alternate'],
    ForStatement: ['init', 'test', 'update', 'body'],
    WhileStatement: ['test', 'body'],
    FunctionExpression: ['params', 'body', 'async', 'generator'],
    ObjectExpression: ['properties'],
    ObjectProperty: ['computed', 'key', 'value', 'method'],
    ArrayExpression: ['elements'],
    TemplateLiteral: ['quasis', 'expressions'],
    TemplateElement: ['value', 'tail'],
    NumericLiteral: ['value'],
    StringLiteral: ['value'],
    BooleanLiteral: ['value'],
    NullLiteral: [],
    DebuggerStatement: [],
    TryStatement: ['block', 'handler', 'finalizer'],
    CatchClause: ['param', 'body'],
    SwitchStatement: ['discriminant'],
  }[node.type]
  if (!keys) return { type: `Unsupported:${node.type}` }
  return Object.fromEntries([
    ['type', node.type],
    ...keys.map((key) => [
      key,
      typeof node[key] === 'object'
        ? (['FunctionExpression', 'CatchClause'].includes(node.type) &&
            key === 'body') ||
          (node.type === 'TryStatement' && ['block', 'finalizer'].includes(key))
          ? statementShape(node[key])
          : valueShape(node[key])
        : key === 'method'
          ? (node[key] ?? false)
          : node[key],
    ]),
  ])
}
export function semanticShape(node) {
  return Array.isArray(node) ? statementList(node) : statementShape(node)
}

export function semanticClause(source) {
  return semanticShape(
    parse(`function clause(){while(true){${source}}}`).program.body[0].body
      .body[0].body,
  )
}

export function matchClause(
  pattern,
  actual,
  context,
  roles,
  calls,
  property = false,
) {
  if (pattern?.type === 'ThisExpression')
    return actual?.type === 'ThisExpression'
  if (pattern?.type === 'Identifier') {
    if (pattern.name.startsWith('$')) {
      const name = pattern.name.slice(1)
      if (property) {
        const value = propertyName(actual)
        if (!value) return false
        if (!roles.has(name)) roles.set(name, value)
        return roles.get(name) === value
      }
      if (roles.get(name) === 'this') return actual?.type === 'ThisExpression'
      const binding = context.bindingFor(actual)
      if (!binding) return false
      if (!roles.has(name)) roles.set(name, binding)
      return roles.get(name) === binding
    }
    return (
      actual?.type === 'Identifier' &&
      actual.name === pattern.name &&
      (property || !context.bindingFor(actual))
    )
  }
  if (Array.isArray(pattern))
    return (
      Array.isArray(actual) &&
      pattern.length === actual.length &&
      pattern.every((value, index) =>
        matchClause(value, actual[index], context, roles, calls),
      )
    )
  if (pattern === null || typeof pattern !== 'object') return pattern === actual
  if (
    (pattern.type === 'CallExpression' || pattern.type === 'NewExpression') &&
    pattern.callee.type === 'Identifier' &&
    calls.has(pattern.callee.name.slice(1))
  ) {
    const invocation = calls
      .get(pattern.callee.name.slice(1))
      .argumentsFor(actual)
    return (
      invocation !== null &&
      matchClause(pattern.arguments, invocation, context, roles, calls)
    )
  }
  return (
    actual?.type === pattern.type &&
    Object.entries(pattern).every(([key, value]) =>
      matchClause(
        value,
        actual[key],
        context,
        roles,
        calls,
        (pattern.type === 'MemberExpression' &&
          key === 'property' &&
          !pattern.computed) ||
          (pattern.type === 'ObjectProperty' &&
            key === 'key' &&
            !pattern.computed),
      ),
    )
  )
}

export function tryClause(pattern, body, context, roles, calls) {
  const candidate = new Map(roles)
  if (!matchClause(pattern, semanticShape(body), context, candidate, calls))
    return null
  return candidate
}
