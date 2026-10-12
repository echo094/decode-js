import { decline, numberValue, propertyName } from './container-role-helpers.js'

function caseNodes(context, dispatch, opcode) {
  const entry = dispatch.cases.find(
    (candidate) => numberValue(candidate.test) === opcode,
  )
  return context.nodes(entry).map(({ node }) => node)
}

function unique(nodes, role) {
  if (nodes.length !== 1) {
    decline('class-runtime-opcodes', `${role} changed`)
  }
  return nodes[0]
}

function thisField(node, name) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'ThisExpression' &&
    propertyName(node.property) === name
  )
}

function thisCall(node, name) {
  return node?.type === 'CallExpression' && thisField(node.callee, name)
}

function record(context, dispatch, opcode, count, operandMethod) {
  const push = unique(
    caseNodes(context, dispatch, opcode).filter(
      (node) =>
        node.type === 'CallExpression' &&
        propertyName(node.callee?.property) === 'push' &&
        node.arguments.length === 1 &&
        node.arguments[0]?.type === 'ObjectExpression' &&
        node.arguments[0].properties.length === count,
    ),
    `Opcode ${opcode} handler record`,
  )
  if (
    !push.arguments[0].properties.every((property) =>
      thisCall(property.value, operandMethod),
    )
  ) {
    decline(
      'class-runtime-opcodes',
      `Opcode ${opcode} handler operands changed`,
    )
  }
  return push.arguments[0].properties.map((property) =>
    propertyName(property.key),
  )
}

export function verifyProtectionCases(
  context,
  dispatch,
  run,
  methods,
  wordField,
) {
  const catchFields = record(context, dispatch, 54, 2, methods.vm.operand)
  const finallyFields = record(context, dispatch, 59, 4, methods.vm.operand)
  unique(
    caseNodes(context, dispatch, 55).filter(
      (node) =>
        node.type === 'CallExpression' &&
        propertyName(node.callee?.property) === 'pop' &&
        node.arguments.length === 0,
    ),
    'Opcode 55 handler pop',
  )
  const catchClause = unique(
    context.nodes(run).filter(({ node }) => node.type === 'CatchClause'),
    'Dispatch exception handler',
  ).node
  const catchNodes = context.nodes(catchClause).map(({ node }) => node)
  unique(
    catchNodes.filter((node) => thisCall(node, methods.vm.closeUpvalues)),
    'Exception unwind upvalue close',
  )
  for (const field of [...catchFields, ...finallyFields]) {
    if (
      !catchNodes.some(
        (node) =>
          node.type === 'MemberExpression' &&
          propertyName(node.property) === field,
      )
    ) {
      decline('class-runtime-opcodes', `Exception record field ${field} unused`)
    }
  }
  unique(
    catchNodes.filter(
      (node) =>
        node.type === 'ThrowStatement' &&
        context.sameRef(node.argument, context.bindingFor(catchClause.param)),
    ),
    'Exception propagation',
  )

  const rewriteNodes = caseNodes(context, dispatch, 56)
  unique(
    rewriteNodes.filter(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.left?.type === 'MemberExpression' &&
        node.left.computed &&
        thisField(node.left.object, wordField) &&
        node.right?.type === 'BinaryExpression' &&
        node.right.operator === '>>>' &&
        numberValue(node.right.right) === 0,
    ),
    'Opcode 56 bytecode rewrite',
  )
  if (
    rewriteNodes.filter(
      (node) => node.type === 'BinaryExpression' && node.operator === '^',
    ).length < 2
  ) {
    decline('class-runtime-opcodes', 'Opcode 56 rewrite key changed')
  }
  unique(
    caseNodes(context, dispatch, 57).filter(
      (node) => node.type === 'DebuggerStatement',
    ),
    'Opcode 57 debugger',
  )
  return Object.freeze({ protectionCases: 5 })
}
