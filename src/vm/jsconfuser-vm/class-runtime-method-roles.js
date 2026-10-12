import {
  decline,
  numberValue,
  propertyName,
  prototypeMethods,
} from './container-role-helpers.js'

function thisField(node, name = null) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'ThisExpression' &&
    (name === null || propertyName(node.property) === name)
  )
}

function computedField(node, field) {
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    thisField(node.object, field)
  )
}

function hasNode(context, root, predicate) {
  return context.nodes(root).some(({ node }) => predicate(node))
}

function thisCall(node, name) {
  return node?.type === 'CallExpression' && thisField(node.callee, name)
}

function unique(items, role) {
  if (items.length !== 1) {
    decline('class-runtime-methods', `${role} is not unique`)
  }
  return items[0]
}

function operandShape(fn, wordField, randomized) {
  const returns = fn.body.body.filter(
    (statement) => statement.type === 'ReturnStatement',
  )
  if (returns.length !== 1) return false
  const read = returns[0].argument
  return (
    computedField(read, wordField) &&
    read.property?.type === 'UpdateExpression' &&
    read.property.operator === '++' &&
    !read.property.prefix &&
    read.property.argument?.type === 'MemberExpression' &&
    read.property.argument.computed &&
    thisField(read.property.argument.object) &&
    read.property.argument.property?.type === 'BinaryExpression' &&
    read.property.argument.property.operator === '+' &&
    thisField(read.property.argument.property.left) &&
    (randomized
      ? numberValue(read.property.argument.property.right) !== null
      : numberValue(read.property.argument.property.right) === 0)
  )
}

function directAssignments(fn) {
  return fn.body.body.flatMap((statement) => {
    const expression =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    return expression?.type === 'AssignmentExpression' &&
      expression.operator === '=' &&
      thisField(expression.left)
      ? [expression]
      : []
  })
}

function upvalueRead(fn) {
  const returns = fn.body.body.filter(
    (statement) => statement.type === 'ReturnStatement',
  )
  if (returns.length !== 1) return null
  const expression = returns[0].argument
  if (
    expression?.type !== 'ConditionalExpression' ||
    !thisField(expression.test) ||
    !thisField(expression.consequent) ||
    expression.alternate?.type !== 'MemberExpression' ||
    !expression.alternate.computed ||
    !thisField(expression.alternate.object) ||
    !thisField(expression.alternate.property)
  ) {
    return null
  }
  return {
    closed: propertyName(expression.test.property),
    value: propertyName(expression.consequent.property),
    regs: propertyName(expression.alternate.object.property),
    absSlot: propertyName(expression.alternate.property.property),
  }
}

function branchAssignment(branch) {
  const statement =
    branch?.type === 'BlockStatement' && branch.body.length === 1
      ? branch.body[0]
      : branch
  const expression =
    statement?.type === 'ExpressionStatement' ? statement.expression : null
  return expression?.type === 'AssignmentExpression' &&
    expression.operator === '='
    ? expression
    : null
}

function upvalueWrite(context, fn, fields) {
  const conditionals = fn.body.body.filter(
    (statement) =>
      statement.type === 'IfStatement' &&
      thisField(statement.test, fields.closed),
  )
  if (conditionals.length !== 1) return false
  const yes = branchAssignment(conditionals[0].consequent)
  const no = branchAssignment(conditionals[0].alternate)
  const parameter = context.bindingFor(yes?.right)
  return (
    thisField(yes?.left, fields.value) &&
    computedField(no?.left, fields.regs) &&
    thisField(no.left.property, fields.absSlot) &&
    parameter &&
    fn.params.some((node) => context.bindingFor(node) === parameter) &&
    context.sameRef(no.right, parameter)
  )
}

function upvalueClose(fn, fields) {
  const assignments = directAssignments(fn)
  const capture = assignments.filter(
    (node) =>
      thisField(node.left, fields.value) &&
      computedField(node.right, fields.regs) &&
      thisField(node.right.property, fields.absSlot),
  )
  const close = assignments.filter(
    (node) =>
      thisField(node.left, fields.closed) &&
      node.right?.type === 'BooleanLiteral' &&
      node.right.value === true,
  )
  return capture.length === 1 && close.length === 1
}

function upvalueConstructor(context, constructor, fields) {
  const assignments = directAssignments(constructor)
  const byField = (name) =>
    assignments.filter((node) => thisField(node.left, fields[name]))
  const closed = byField('closed')
  const value = byField('value')
  const regs = byField('regs')
  const absSlot = byField('absSlot')
  const parameter = (nodes) => {
    if (nodes.length !== 1) return false
    const binding = context.bindingFor(nodes[0].right)
    return (
      binding &&
      constructor.params.some((node) => context.bindingFor(node) === binding)
    )
  }
  return (
    closed.length === 1 &&
    closed[0].right?.type === 'BooleanLiteral' &&
    closed[0].right.value === false &&
    value.length === 1 &&
    value[0].right?.type === 'Identifier' &&
    value[0].right.name === 'undefined' &&
    !context.bindingFor(value[0].right) &&
    parameter(regs) &&
    parameter(absSlot)
  )
}

export function identifyClassRuntimeMethods(
  context,
  vmBinding,
  root,
  frame,
  vmFields,
  randomized = false,
) {
  const vmMethods = prototypeMethods(context, { binding: vmBinding })
  if (
    vmMethods.length !== 6 ||
    new Set(vmMethods.map(({ name }) => name)).size !== 6
  ) {
    decline('class-runtime-methods', 'VM prototype method set is incomplete')
  }
  const run = unique(
    vmMethods.filter(({ name }) => name === root.method.name),
    'VM run method',
  )
  const pushFrame = unique(
    vmMethods.filter(({ name }) => name === frame.pushMethod),
    'VM frame method',
  )
  const remaining = vmMethods.filter(
    (method) => method !== run && method !== pushFrame,
  )
  const operand = unique(
    remaining.filter(({ fn }) => operandShape(fn, vmFields.words, randomized)),
    'VM operand method',
  )
  const constant = unique(
    remaining.filter(
      ({ fn }) =>
        hasNode(context, fn, (node) => computedField(node, vmFields.pool)) &&
        context.nodes(fn).filter(({ node }) => thisCall(node, operand.name))
          .length === 2,
    ),
    'VM constant method',
  )
  const captureCandidates = remaining.flatMap((method) =>
    context
      .nodes(method.fn)
      .filter(
        ({ node }) =>
          node.type === 'NewExpression' &&
          context.bindingFor(node.callee)?.path.isFunctionDeclaration(),
      )
      .map(({ node }) => ({
        method,
        constructor: context.bindingFor(node.callee),
      })),
  )
  const capture = unique(captureCandidates, 'VM capture method')
  const upvalueBinding = capture.constructor
  const upvalueMethods = prototypeMethods(context, { binding: upvalueBinding })
  if (
    upvalueMethods.length !== 3 ||
    new Set(upvalueMethods.map(({ name }) => name)).size !== 3
  ) {
    decline('class-runtime-methods', 'Upvalue method set is incomplete')
  }
  const readers = upvalueMethods.flatMap((method) => {
    const fields = upvalueRead(method.fn)
    return fields ? [{ method, fields }] : []
  })
  const reader = unique(readers, 'Upvalue read method')
  const writer = unique(
    upvalueMethods.filter(({ fn }) => upvalueWrite(context, fn, reader.fields)),
    'Upvalue write method',
  )
  const closer = unique(
    upvalueMethods.filter(({ fn }) => upvalueClose(fn, reader.fields)),
    'Upvalue close method',
  )
  if (
    new Set([reader.method, writer, closer]).size !== 3 ||
    !upvalueConstructor(context, upvalueBinding.path.node, reader.fields)
  ) {
    decline('class-runtime-methods', 'Upvalue storage graph is incomplete')
  }
  const closeUpvalues = unique(
    remaining.filter(
      (method) =>
        method !== operand &&
        method !== constant &&
        method !== capture.method &&
        hasNode(
          context,
          method.fn,
          (node) =>
            node?.type === 'CallExpression' &&
            node.callee?.type === 'MemberExpression' &&
            propertyName(node.callee.property) === closer.name,
        ),
    ),
    'VM close-upvalues method',
  )
  if (
    new Set([run, pushFrame, operand, constant, capture.method, closeUpvalues])
      .size !== 6 ||
    ![operand, constant, capture.method, closeUpvalues].every((method) =>
      hasNode(context, run.fn, (node) => thisCall(node, method.name)),
    ) ||
    !hasNode(
      context,
      run.fn,
      (node) =>
        node.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        propertyName(node.callee.property) === reader.method.name,
    ) ||
    !hasNode(
      context,
      run.fn,
      (node) =>
        node.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        propertyName(node.callee.property) === writer.name,
    )
  ) {
    decline('class-runtime-methods', 'VM/upvalue call graph is incomplete')
  }
  return {
    vm: {
      run: run.name,
      pushFrame: pushFrame.name,
      operand: operand.name,
      constant: constant.name,
      captureUpvalue: capture.method.name,
      closeUpvalues: closeUpvalues.name,
    },
    upvalue: {
      constructor: upvalueBinding.identifier.name,
      fields: reader.fields,
      read: reader.method.name,
      write: writer.name,
      close: closer.name,
    },
  }
}
