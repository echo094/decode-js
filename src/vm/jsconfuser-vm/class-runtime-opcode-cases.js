import { decline, numberValue, propertyName } from './container-role-helpers.js'

const ORDER = Object.freeze([
  ...Array.from({ length: 16 }, (_, value) => value),
  60,
  ...Array.from({ length: 40 }, (_, index) => index + 16),
  59,
  56,
  58,
  57,
])

const BINARY_OPERATORS = Object.freeze({
  11: '+',
  12: '-',
  13: '*',
  14: '/',
  15: '%',
  16: '&',
  17: '|',
  18: '^',
  19: '<<',
  20: '>>',
  21: '>>>',
  22: '<',
  23: '>',
  24: '<=',
  25: '>=',
  26: '===',
  27: '!==',
  28: '==',
  29: '!=',
  30: 'in',
  31: 'instanceof',
})

function registerWrite(node) {
  return (
    node?.type === 'AssignmentExpression' &&
    node.operator === '=' &&
    node.left?.type === 'MemberExpression' &&
    node.left.computed &&
    node.left.object?.type === 'Identifier' &&
    node.left.property?.type === 'BinaryExpression' &&
    node.left.property.operator === '+'
  )
}

function caseByOpcode(dispatch, opcode) {
  const cases = dispatch.cases.filter(
    (entry) => numberValue(entry.test) === opcode,
  )
  if (cases.length !== 1) {
    decline('class-runtime-opcodes', `Opcode ${opcode} case is not unique`)
  }
  return cases[0]
}

function thisCall(node, method) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.object?.type === 'ThisExpression' &&
    propertyName(node.callee.property) === method
  )
}

function thisField(node, field) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'ThisExpression' &&
    propertyName(node.property) === field
  )
}

function frameRead(node, offset) {
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    node.property?.type === 'BinaryExpression' &&
    node.property.operator === '+' &&
    numberValue(node.property.right) === offset
  )
}

function registerRead(node, operandMethod) {
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    node.property?.type === 'BinaryExpression' &&
    node.property.operator === '+' &&
    thisCall(node.property.right, operandMethod)
  )
}

function localRegisterValue(branch, node, operandMethod) {
  if (node?.type !== 'Identifier') return false
  const statements =
    branch.consequent[0]?.type === 'BlockStatement'
      ? branch.consequent[0].body
      : branch.consequent
  const declarations = statements
    .flatMap((statement) =>
      statement.type === 'VariableDeclaration' ? statement.declarations : [],
    )
    .filter(
      (declaration) =>
        declaration.id?.type === 'Identifier' &&
        declaration.id.name === node.name,
    )
  return (
    declarations.length === 1 &&
    registerRead(declarations[0].init, operandMethod)
  )
}

function uniqueCaseNode(context, dispatch, opcode, predicate, role) {
  const matches = context
    .nodes(caseByOpcode(dispatch, opcode))
    .filter(({ node }) => predicate(node))
  if (matches.length !== 1) {
    decline('class-runtime-opcodes', `Opcode ${opcode} ${role} changed`)
  }
}

function verifyLoadsStoresAndJumps(context, dispatch, methods, vmFields) {
  const result = (opcode, predicate, role) =>
    uniqueCaseNode(
      context,
      dispatch,
      opcode,
      (node) => registerWrite(node) && predicate(node.right),
      role,
    )
  result(0, (node) => thisCall(node, methods.vm.constant), 'constant load')
  result(1, (node) => thisCall(node, methods.vm.operand), 'integer load')
  result(
    2,
    (node) =>
      node?.type === 'MemberExpression' &&
      node.computed &&
      thisField(node.object, vmFields.globals),
    'global load',
  )
  result(
    3,
    (node) =>
      node?.type === 'CallExpression' &&
      propertyName(node.callee?.property) === methods.upvalue.read &&
      frameRead(node.callee?.object?.object?.object, 4),
    'upvalue load',
  )
  result(4, (node) => frameRead(node, 3), 'this load')
  result(5, (node) => registerRead(node, methods.vm.operand), 'register copy')
  uniqueCaseNode(
    context,
    dispatch,
    6,
    (node) =>
      node.type === 'AssignmentExpression' &&
      node.operator === '=' &&
      node.left?.type === 'MemberExpression' &&
      node.left.computed &&
      thisField(node.left.object, vmFields.globals) &&
      thisCall(node.left.property, methods.vm.constant),
    'global store',
  )
  uniqueCaseNode(
    context,
    dispatch,
    7,
    (node) =>
      node.type === 'CallExpression' &&
      propertyName(node.callee?.property) === methods.upvalue.write &&
      frameRead(node.callee?.object?.object?.object, 4),
    'upvalue store',
  )
  result(
    8,
    (node) =>
      node?.type === 'MemberExpression' &&
      node.computed &&
      localRegisterValue(
        caseByOpcode(dispatch, 8),
        node.object,
        methods.vm.operand,
      ) &&
      localRegisterValue(
        caseByOpcode(dispatch, 8),
        node.property,
        methods.vm.operand,
      ),
    'property load',
  )
  uniqueCaseNode(
    context,
    dispatch,
    9,
    (node) =>
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.object?.name === 'Reflect' &&
      propertyName(node.callee.property) === 'set' &&
      node.arguments.length === 3,
    'property store',
  )
  result(
    10,
    (node) =>
      node?.type === 'UnaryExpression' &&
      node.operator === 'delete' &&
      node.argument?.type === 'MemberExpression' &&
      node.argument.computed &&
      localRegisterValue(
        caseByOpcode(dispatch, 10),
        node.argument.object,
        methods.vm.operand,
      ) &&
      localRegisterValue(
        caseByOpcode(dispatch, 10),
        node.argument.property,
        methods.vm.operand,
      ),
    'property deletion',
  )

  const unary = { 32: '-', 33: '+', 34: '!', 35: '~', 36: 'typeof' }
  for (const [opcodeText, operator] of Object.entries(unary)) {
    result(
      Number(opcodeText),
      (node) => node?.type === 'UnaryExpression' && node.operator === operator,
      `${operator} result`,
    )
  }
  result(
    37,
    (node) => node?.type === 'Identifier' && node.name === 'undefined',
    'void result',
  )
  result(
    38,
    (node) => node?.type === 'UnaryExpression' && node.operator === 'typeof',
    'global typeof',
  )
  uniqueCaseNode(
    context,
    dispatch,
    39,
    (node) =>
      node.type === 'AssignmentExpression' &&
      node.operator === '=' &&
      frameRead(node.left, 0) &&
      thisCall(node.right, methods.vm.operand),
    'direct jump',
  )
  for (const [opcodeText, negated] of [
    [40, true],
    [41, false],
  ]) {
    const opcode = Number(opcodeText)
    const matches = context
      .nodes(caseByOpcode(dispatch, opcode))
      .filter(
        ({ node }) =>
          node.type === 'IfStatement' &&
          node.test?.type ===
            (negated ? 'UnaryExpression' : 'MemberExpression') &&
          (!negated || node.test.operator === '!') &&
          node.consequent?.type === 'ExpressionStatement' &&
          node.consequent.expression?.type === 'AssignmentExpression' &&
          frameRead(node.consequent.expression.left, 0),
      )
    if (matches.length !== 1) {
      decline(
        'class-runtime-opcodes',
        `Opcode ${opcode} conditional jump changed`,
      )
    }
  }
  uniqueCaseNode(
    context,
    dispatch,
    58,
    (node) =>
      node.type === 'AssignmentExpression' &&
      frameRead(node.left, 0) &&
      registerRead(node.right, methods.vm.operand),
    'indirect jump',
  )
}

function verifyCallAndReturnCases(context, dispatch, methods) {
  for (const opcode of [42, 43, 44]) {
    uniqueCaseNode(
      context,
      dispatch,
      opcode,
      (node) =>
        thisCall(node, methods.vm.pushFrame) &&
        node.arguments.some(
          (argument) =>
            argument.type === 'BinaryExpression' &&
            argument.operator === (opcode === 44 ? '|' : '<<') &&
            (opcode !== 44 || numberValue(argument.right) === 1),
        ),
      'VM closure call',
    )
    uniqueCaseNode(
      context,
      dispatch,
      opcode,
      (node) =>
        registerWrite(node) &&
        node.right?.type === 'CallExpression' &&
        (opcode === 44
          ? node.right.callee?.type === 'MemberExpression' &&
            node.right.callee.object?.name === 'Reflect' &&
            propertyName(node.right.callee.property) === 'construct' &&
            node.right.arguments.length === 2
          : node.right.callee?.type === 'MemberExpression' &&
            propertyName(node.right.callee.property) === 'apply' &&
            node.right.arguments.length === 2 &&
            (opcode === 42
              ? node.right.arguments[0]?.type === 'NullLiteral'
              : node.right.arguments[0]?.type === 'Identifier')),
      'host call',
    )
  }
  uniqueCaseNode(
    context,
    dispatch,
    45,
    (node) =>
      thisCall(node, methods.vm.closeUpvalues) && node.arguments.length >= 1,
    'upvalue close on return',
  )
  uniqueCaseNode(
    context,
    dispatch,
    45,
    (node) =>
      node.type === 'AssignmentExpression' &&
      node.operator === '=' &&
      node.left?.type === 'MemberExpression' &&
      node.left.property?.type === 'ConditionalExpression' &&
      numberValue(node.left.property.alternate) === 0 &&
      node.right?.type === 'Identifier',
    'return value write',
  )
  uniqueCaseNode(
    context,
    dispatch,
    46,
    (node) =>
      node.type === 'ThrowStatement' &&
      registerRead(node.argument, methods.vm.operand),
    'register throw',
  )
}

function verifyClosureCase(context, dispatch, methods, vmBinding, root) {
  const opcode = 47
  const closureConstructor = context.bindingFor(root.closure.callee)
  uniqueCaseNode(
    context,
    dispatch,
    opcode,
    (node) =>
      node.type === 'NewExpression' &&
      context.sameRef(node.callee, closureConstructor),
    'closure construction',
  )
  uniqueCaseNode(
    context,
    dispatch,
    opcode,
    (node) =>
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.object?.type === 'NewExpression' &&
      context.sameRef(node.callee.object.callee, vmBinding) &&
      propertyName(node.callee.property) === methods.vm.run,
    'sub-VM execution',
  )
  uniqueCaseNode(
    context,
    dispatch,
    opcode,
    (node) =>
      node.type === 'CallExpression' &&
      propertyName(node.callee?.property) === 'push' &&
      node.arguments.some((argument) =>
        thisCall(argument, methods.vm.captureUpvalue),
      ),
    'local upvalue capture',
  )
  const registrations = context
    .nodes(caseByOpcode(dispatch, opcode))
    .filter(
      ({ node }) =>
        node.type === 'CallExpression' &&
        propertyName(node.callee?.property) === 'set' &&
        node.arguments.length === 2 &&
        node.callee?.object?.type === 'Identifier',
    )
  if (registrations.length !== 1) {
    decline('class-runtime-opcodes', 'Closure shell registration changed')
  }
  const map = context.bindingFor(registrations[0].node.callee.object)
  const shell = context.bindingFor(registrations[0].node.arguments[0])
  for (const callOpcode of [42, 43, 44]) {
    uniqueCaseNode(
      context,
      dispatch,
      callOpcode,
      (node) =>
        node.type === 'CallExpression' &&
        propertyName(node.callee?.property) === 'get' &&
        context.sameRef(node.callee?.object, map),
      'closure shell lookup',
    )
  }
  uniqueCaseNode(
    context,
    dispatch,
    opcode,
    (node) =>
      registerWrite(node) &&
      node.right?.type === 'Identifier' &&
      context.sameRef(node.right, shell),
    'closure shell result',
  )
}

export function verifyOpcodeCases(
  context,
  dispatch,
  methods,
  vmFields,
  vmBinding,
  root,
) {
  const observed = dispatch.cases.map((entry) =>
    entry.test === null ? null : numberValue(entry.test),
  )
  const extra = observed
    .filter((value) => value !== null && !ORDER.includes(value))
    .sort((left, right) => left - right)
  if (
    observed.length < ORDER.length + 1 ||
    observed.filter((value) => value === null).length !== 1 ||
    new Set(observed).size !== observed.length ||
    ORDER.some((opcode) => !observed.includes(opcode)) ||
    extra.some((opcode, index) => opcode !== 61 + index)
  ) {
    decline('class-runtime-opcodes', 'Opcode case set changed')
  }
  for (const [opcodeText, operator] of Object.entries(BINARY_OPERATORS)) {
    const opcode = Number(opcodeText)
    const writes = context
      .nodes(caseByOpcode(dispatch, opcode))
      .filter(
        ({ node }) =>
          registerWrite(node) &&
          node.right?.type === 'BinaryExpression' &&
          node.right.operator === operator,
      )
    if (writes.length !== 1) {
      decline(
        'class-runtime-opcodes',
        `Opcode ${opcode} has no unique ${operator} result write`,
      )
    }
  }
  const exponentWrites = context
    .nodes(caseByOpcode(dispatch, 60))
    .filter(({ node }) => {
      const call = registerWrite(node) ? node.right : null
      return (
        call?.type === 'CallExpression' &&
        call.callee?.type === 'MemberExpression' &&
        !call.callee.computed &&
        call.callee.object?.type === 'Identifier' &&
        call.callee.object.name === 'Math' &&
        propertyName(call.callee.property) === 'pow' &&
        call.arguments.length === 2
      )
    })
  if (exponentWrites.length !== 1) {
    decline('class-runtime-opcodes', 'Exponent result write changed')
  }
  verifyLoadsStoresAndJumps(context, dispatch, methods, vmFields)
  verifyCallAndReturnCases(context, dispatch, methods)
  verifyClosureCase(context, dispatch, methods, vmBinding, root)
  return Object.freeze({
    orderedCases: ORDER.length,
    arithmeticCases: 22,
    loadStoreCases: 11,
    unaryCases: 7,
    jumpCases: 4,
    callReturnCases: 5,
    closureCases: 1,
  })
}
