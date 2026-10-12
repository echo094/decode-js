import { decline, numberValue, propertyName } from './container-role-helpers.js'
import { simpleControlBody } from '../../visitor/jsconfuser-vm/normalize-source.js'

function caseNodes(context, dispatch, opcode) {
  const entry = dispatch.cases.find(
    (candidate) => numberValue(candidate.test) === opcode,
  )
  return context.nodes(entry).map(({ node }) => node)
}

function unique(nodes, opcode, role) {
  if (nodes.length !== 1) {
    decline('class-runtime-opcodes', `Opcode ${opcode} ${role} changed`)
  }
  return nodes[0]
}

function resultWrite(node) {
  return (
    node.type === 'AssignmentExpression' &&
    node.operator === '=' &&
    node.left?.type === 'MemberExpression' &&
    node.left.computed &&
    node.left.property?.type === 'BinaryExpression' &&
    node.left.property.operator === '+'
  )
}

function localInit(context, node) {
  const binding = context.bindingFor(node)
  return binding?.path.isVariableDeclarator() ? binding.path.node.init : null
}

function builtinCall(node, owner, method) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.object?.name === owner &&
    propertyName(node.callee.property) === method
  )
}

export function verifyCollectionCases(context, dispatch) {
  const arrayNodes = caseNodes(context, dispatch, 48)
  const arrayResult = unique(
    arrayNodes.filter(
      (node) =>
        resultWrite(node) &&
        localInit(context, node.right)?.type === 'NewExpression' &&
        localInit(context, node.right).callee?.name === 'Array',
    ),
    48,
    'array result',
  )
  unique(
    arrayNodes.filter(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.left?.type === 'MemberExpression' &&
        context.sameRef(
          node.left.object,
          context.bindingFor(arrayResult.right),
        ) &&
        node.right?.type === 'MemberExpression' &&
        node.right.computed,
    ),
    48,
    'array element fill',
  )

  const objectNodes = caseNodes(context, dispatch, 49)
  const objectResult = unique(
    objectNodes.filter(
      (node) =>
        resultWrite(node) &&
        localInit(context, node.right)?.type === 'ObjectExpression' &&
        localInit(context, node.right).properties.length === 0,
    ),
    49,
    'object result',
  )
  unique(
    objectNodes.filter(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.left?.type === 'MemberExpression' &&
        node.left.computed &&
        context.sameRef(
          node.left.object,
          context.bindingFor(objectResult.right),
        ),
    ),
    49,
    'object pair fill',
  )

  for (const [opcode, accessor] of [
    [50, 'get'],
    [51, 'set'],
  ]) {
    const nodes = caseNodes(context, dispatch, opcode)
    const call = unique(
      nodes.filter(
        (node) =>
          builtinCall(node, 'Object', 'defineProperty') &&
          node.arguments.length === 3,
      ),
      opcode,
      'property descriptor call',
    )
    const descriptor = localInit(context, call.arguments[2])
    if (
      descriptor?.type !== 'ObjectExpression' ||
      !descriptor.properties.some(
        (property) => propertyName(property.key) === accessor,
      ) ||
      !['configurable', 'enumerable'].every((name) =>
        descriptor.properties.some(
          (property) =>
            propertyName(property.key) === name &&
            property.value?.type === 'BooleanLiteral' &&
            property.value.value === true,
        ),
      )
    ) {
      decline(
        'class-runtime-opcodes',
        `Opcode ${opcode} ${accessor} descriptor changed`,
      )
    }
  }

  const iteratorNodes = caseNodes(context, dispatch, 52)
  for (const method of [
    'getOwnPropertyNames',
    'getOwnPropertyDescriptor',
    'getPrototypeOf',
  ]) {
    unique(
      iteratorNodes.filter((node) => builtinCall(node, 'Object', method)),
      52,
      `iterator ${method}`,
    )
  }
  const iteratorResult = unique(
    iteratorNodes.filter(
      (node) =>
        resultWrite(node) &&
        node.right?.type === 'ObjectExpression' &&
        node.right.properties.length === 2 &&
        node.right.properties.some(
          (property) => numberValue(property.value) === 0,
        ),
    ),
    52,
    'iterator result',
  )
  const index = iteratorResult.right.properties.find(
    (property) => numberValue(property.value) === 0,
  )
  const keys = iteratorResult.right.properties.find(
    (property) => property !== index,
  )
  const advanceNodes = caseNodes(context, dispatch, 53)
  unique(
    advanceNodes.filter(
      (node) =>
        node.type === 'UpdateExpression' &&
        node.operator === '++' &&
        propertyName(node.argument?.property) === propertyName(index.key),
    ),
    53,
    'iterator advance',
  )
  unique(
    advanceNodes.filter(
      (node) =>
        resultWrite(node) &&
        node.right?.type === 'MemberExpression' &&
        propertyName(node.right.object?.property) === propertyName(keys.key),
    ),
    53,
    'iterator key result',
  )
  unique(
    advanceNodes.filter((node) => {
      if (node.type !== 'IfStatement' || node.test?.operator !== '>=')
        return false
      const body = simpleControlBody(node.consequent)
      const statements = body?.type === 'BlockStatement' ? body.body : [body]
      return statements.some(
        (statement) =>
          statement?.type === 'ExpressionStatement' &&
          statement.expression?.type === 'AssignmentExpression',
      )
    }),
    53,
    'iterator exit jump',
  )
  return Object.freeze({ collectionCases: 6 })
}
