import { parse } from '@babel/parser'
import { verifyClassRuntimeContract } from './class-runtime-contract.js'
import { identifyClassRuntimeMethods } from './class-runtime-method-roles.js'
import { verifyCollectionCases } from './class-runtime-collection-cases.js'
import { verifyOpcodeCases } from './class-runtime-opcode-cases.js'
import { verifyProtectionCases } from './class-runtime-protection-cases.js'
import {
  verifyFrameSlots,
  verifySpreadSentinel,
  verifyTimingMode,
} from './class-runtime-inline-values.js'
import {
  ContainerDecline,
  EXPECTED_OPCODES,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
  isPoolArray,
  isStableDeclaration,
  isWordArray,
  makeContext,
  numberValue,
  propertyName,
  prototypeMethods,
  readPlainObject,
  referenceCount,
  topLevelDeclarations,
  topLevelVariables,
  uniqueCandidate,
} from './container-role-helpers.js'

function stableFunction(context, node) {
  const binding = context.bindingFor(node)
  return binding?.path.isFunctionDeclaration() && binding.constant
    ? binding
    : null
}

function decoderBridge(context, declaration, words, pool) {
  const construct = declaration.init
  if (construct?.type !== 'NewExpression') return null
  const vm = stableFunction(context, construct.callee)
  if (!vm || !isStableDeclaration(declaration)) return null
  const poolArguments = construct.arguments.filter((argument) =>
    context.sameRef(argument, pool.binding),
  )
  const decoded = construct.arguments.filter(
    (argument) =>
      argument.type === 'CallExpression' &&
      argument.arguments.length === 1 &&
      context.sameRef(argument.arguments[0], words.binding) &&
      stableFunction(context, argument.callee),
  )
  if (poolArguments.length !== 1 || decoded.length !== 1) return null
  const decoder = stableFunction(context, decoded[0].callee)
  const first = decoder.path.node.body.body[0]
  const parameter = decoder.path.node.params[0]
  if (
    decoder.path.node.params.length !== 1 ||
    first?.type !== 'IfStatement' ||
    first.test?.type !== 'UnaryExpression' ||
    first.test.operator !== '!' ||
    first.test.argument?.type !== 'BooleanLiteral' ||
    first.test.argument.value !== false ||
    first.consequent?.type !== 'ReturnStatement' ||
    !context.sameRef(first.consequent.argument, context.bindingFor(parameter))
  ) {
    return null
  }
  return { vm, decoder, construct }
}

function canonicalSwitch(context, method, randomized) {
  const switches = context.nodes(method.fn).filter(({ node }) => {
    if (node.type !== 'SwitchStatement') return false
    const values = node.cases.map((entry) =>
      entry.test === null ? null : numberValue(entry.test),
    )
    if (randomized)
      return (
        values.length === 62 &&
        values.filter((value) => value === null).length === 1 &&
        values.every(
          (value) =>
            value === null ||
            (Number.isSafeInteger(value) && value >= 0 && value <= 65535),
        )
      )
    const expected = Object.values(EXPECTED_OPCODES)
    const extra = values
      .filter((value) => value !== null && !expected.includes(value))
      .sort((left, right) => left - right)
    return (
      values.length >= expected.length + 1 &&
      values.filter((value) => value === null).length === 1 &&
      new Set(values).size === values.length &&
      expected.every((value) => values.includes(value)) &&
      extra.every((value, index) => value === 61 + index)
    )
  })
  return switches.length === 1 ? switches[0].node : null
}

function assignedField(context, constructor, index) {
  const parameter = constructor.params[index]
  const binding = context.bindingFor(parameter)
  if (!binding) return null
  const assignments = constructor.body.body.filter((statement) => {
    const expression =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    return (
      expression?.type === 'AssignmentExpression' &&
      expression.operator === '=' &&
      expression.left?.type === 'MemberExpression' &&
      !expression.left.computed &&
      expression.left.object?.type === 'ThisExpression' &&
      context.sameRef(expression.right, binding)
    )
  })
  return assignments.length === 1
    ? propertyName(assignments[0].expression.left.property)
    : null
}

function constructorFieldMap(context, bridge, variables, pool, words, root) {
  const construct = bridge.construct
  const globals = variables.filter(
    (candidate) =>
      candidate.init?.type === 'Identifier' &&
      candidate.init.name === 'globalThis' &&
      !context.bindingFor(candidate.init) &&
      isStableDeclaration(candidate) &&
      construct.arguments.filter((argument) =>
        context.sameRef(argument, candidate.binding),
      ).length === 1,
  )
  if (globals.length !== 1) {
    decline('class-runtime-fields', 'Global root is not unique')
  }
  const argumentIndex = (predicate) => {
    const indexes = construct.arguments.flatMap((argument, index) =>
      predicate(argument) ? [index] : [],
    )
    return indexes.length === 1 ? indexes[0] : -1
  }
  const positions = {
    words: argumentIndex(
      (argument) =>
        argument.type === 'CallExpression' &&
        context.sameRef(argument.callee, bridge.decoder) &&
        argument.arguments.length === 1 &&
        context.sameRef(argument.arguments[0], words.binding),
    ),
    pool: argumentIndex((argument) => context.sameRef(argument, pool.binding)),
    globals: argumentIndex((argument) =>
      context.sameRef(argument, globals[0].binding),
    ),
  }
  const constructor = bridge.vm.path.node
  if (
    Object.values(positions).some((index) => index < 0) ||
    constructor.params.length !== construct.arguments.length
  ) {
    decline('class-runtime-fields', 'VM argument positions are incomplete')
  }
  const fields = Object.fromEntries(
    Object.entries(positions).map(([role, index]) => [
      role,
      assignedField(context, constructor, index),
    ]),
  )
  if (
    Object.values(fields).some((field) => field === null) ||
    new Set(Object.values(fields)).size !== 3
  ) {
    decline('class-runtime-fields', 'VM argument-to-field map is incomplete')
  }

  const discriminant = root.dispatch.discriminant
  const discriminantBinding = context.bindingFor(discriminant)
  const opcodeFetches = context.nodes(root.method.fn).filter(({ node }) => {
    const read = node.type === 'VariableDeclarator' ? node.init : null
    return (
      context.bindingFor(node.id) === discriminantBinding &&
      read?.type === 'MemberExpression' &&
      read.computed &&
      read.object?.type === 'MemberExpression' &&
      !read.object.computed &&
      read.object.object?.type === 'ThisExpression' &&
      propertyName(read.object.property) === fields.words
    )
  })
  if (!discriminantBinding || opcodeFetches.length !== 1) {
    decline(
      'class-runtime-fields',
      'Dispatch is not fetched from VM word field',
    )
  }
  return { globals: globals[0], fields, positions }
}

function rootCall(context, vm, vmConstructor, randomized) {
  const candidates = []
  for (const statement of context.program.body) {
    const call =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    if (
      call?.type !== 'CallExpression' ||
      call.callee?.type !== 'MemberExpression' ||
      call.callee.computed ||
      !context.sameRef(call.callee.object, vm.binding)
    ) {
      continue
    }
    const methodName = propertyName(call.callee.property)
    const methods = prototypeMethods(context, {
      binding: vmConstructor,
    }).filter((method) => method.name === methodName)
    if (methods.length !== 1) continue
    const dispatch = canonicalSwitch(context, methods[0], randomized)
    if (!dispatch) continue
    const closures = call.arguments.filter(
      (argument) =>
        argument.type === 'NewExpression' &&
        stableFunction(context, argument.callee) &&
        argument.arguments.some((part) => {
          const fields = readPlainObject(part)
          return (
            fields?.size === 3 &&
            [...fields.values()].filter((value) => numberValue(value) === 0)
              .length === 2 &&
            [...fields.values()].some((value) => {
              const count = numberValue(value)
              return Number.isSafeInteger(count) && count > 0
            })
          )
        }),
    )
    if (closures.length === 1) {
      candidates.push({
        call,
        method: methods[0],
        dispatch,
        closure: closures[0],
      })
    }
  }
  if (candidates.length !== 1) {
    decline('class-runtime-boot', 'Class runtime boot/dispatch is not unique')
  }
  return candidates[0]
}

function rootFrame(context, root, vmBinding, randomized) {
  const descriptorArguments = root.closure.arguments.flatMap(
    (argument, index) => {
      const fields = readPlainObject(argument)
      if (
        fields?.size !== 3 ||
        [...fields.values()].filter((value) => numberValue(value) === 0)
          .length !== 2
      ) {
        return []
      }
      const positive = [...fields.values()].filter((value) => {
        const count = numberValue(value)
        return Number.isSafeInteger(count) && count > 0
      })
      return positive.length === 1 ? [{ index, fields }] : []
    },
  )
  const closureConstructor = stableFunction(context, root.closure.callee)
  const runClosurePositions = root.call.arguments.flatMap((argument, index) =>
    argument === root.closure ? [index] : [],
  )
  if (
    descriptorArguments.length !== 1 ||
    runClosurePositions.length !== 1 ||
    !closureConstructor ||
    closureConstructor.path.node.params.length !==
      root.closure.arguments.length ||
    root.method.fn.params.length !== root.call.arguments.length
  ) {
    decline('class-runtime-frame', 'Root closure arguments are incomplete')
  }
  const descriptor = descriptorArguments[0]
  const descriptorField = assignedField(
    context,
    closureConstructor.path.node,
    descriptor.index,
  )
  const closureParameter = context.bindingFor(
    root.method.fn.params[runClosurePositions[0]],
  )
  if (!descriptorField || !closureParameter) {
    decline('class-runtime-frame', 'Root descriptor field is not connected')
  }
  const vmMethods = prototypeMethods(context, { binding: vmBinding })
  const calls = root.method.fn.body.body.flatMap((statement) => {
    const call =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    if (
      call?.type !== 'CallExpression' ||
      call.callee?.type !== 'MemberExpression' ||
      call.callee.computed ||
      call.callee.object?.type !== 'ThisExpression' ||
      call.arguments.filter((argument) =>
        context.sameRef(argument, closureParameter),
      ).length !== 1 ||
      !call.arguments.some((argument) => numberValue(argument) === 0)
    ) {
      return []
    }
    const method = vmMethods.filter(
      (candidate) => candidate.name === propertyName(call.callee.property),
    )
    return method.length === 1 ? [{ call, method: method[0] }] : []
  })
  if (calls.length !== 1) {
    decline('class-runtime-frame', 'Initial frame call is not unique')
  }
  const push = calls[0]
  const closurePositions = push.call.arguments.flatMap((argument, index) =>
    context.sameRef(argument, closureParameter) ? [index] : [],
  )
  const pushClosure = context.bindingFor(
    push.method.fn.params[closurePositions[0]],
  )
  const descriptorReads = context.nodes(push.method.fn).filter(({ node }) => {
    const read = node.type === 'VariableDeclarator' ? node.init : null
    return (
      read?.type === 'MemberExpression' &&
      !read.computed &&
      context.sameRef(read.object, pushClosure) &&
      propertyName(read.property) === descriptorField
    )
  })
  if (closurePositions.length !== 1 || descriptorReads.length !== 1) {
    decline('class-runtime-frame', 'Frame does not read root descriptor')
  }
  const fnBinding = context.bindingFor(descriptorReads[0].node.id)
  const fieldEntries = [...descriptor.fields.entries()].map(([name, value]) => [
    name,
    numberValue(value),
  ])
  const regCount = fieldEntries.find(([, value]) => value > 0)
  const headerExpressions = context.nodes(push.method.fn).filter(({ node }) => {
    if (node.type !== 'BinaryExpression' || node.operator !== '+') {
      return false
    }
    return (
      (randomized
        ? Number.isSafeInteger(numberValue(node.left)) &&
          numberValue(node.left) >= 8 &&
          numberValue(node.left) <= 16
        : numberValue(node.left) === 8) &&
      node.right?.type === 'MemberExpression' &&
      !node.right.computed &&
      context.sameRef(node.right.object, fnBinding) &&
      propertyName(node.right.property) === regCount[0]
    )
  })
  const operandSlots = vmMethods.flatMap((method) =>
    context
      .nodes(method.fn)
      .filter(
        ({ node, path }) =>
          path.getFunctionParent()?.node === method.fn &&
          path.findParent((p) => p.isReturnStatement()) &&
          node.type === 'UpdateExpression' &&
          node.operator === '++' &&
          !node.prefix &&
          node.argument?.type === 'MemberExpression' &&
          node.argument.property?.type === 'BinaryExpression' &&
          node.argument.property.operator === '+' &&
          numberValue(node.argument.property.right) !== null,
      )
      .map(({ node }) => numberValue(node.argument.property.right)),
  )
  if (randomized && operandSlots.length !== 1)
    decline('class-runtime-frame', 'Frame PC read is not unique')
  const startAssignments = context.nodes(push.method.fn).filter(({ node }) => {
    if (node.type !== 'AssignmentExpression') return false
    const read = node.right
    const slot = node.left?.property
    return (
      read?.type === 'MemberExpression' &&
      !read.computed &&
      context.sameRef(read.object, fnBinding) &&
      slot?.type === 'BinaryExpression' &&
      slot.operator === '+' &&
      (randomized
        ? numberValue(slot.right) === operandSlots[0]
        : numberValue(slot.right) === 0) &&
      node.left?.type === 'MemberExpression' &&
      node.left.computed
    )
  })
  const startNames = startAssignments.map(({ node }) =>
    propertyName(node.right.property),
  )
  const start = fieldEntries.filter(
    ([name, value]) => value === 0 && startNames.includes(name),
  )
  if (headerExpressions.length !== 1 || start.length !== 1) {
    decline('class-runtime-frame', 'Root frame metadata is not connected')
  }
  return {
    closureField: descriptorField,
    pushMethod: push.method.name,
    start: { field: start[0][0], value: 0 },
    regCount: { field: regCount[0], value: regCount[1] },
    headerSize: numberValue(headerExpressions[0].node.left),
  }
}

function recognize(input, randomized) {
  const ast = typeof input === 'string' ? parse(input, PARSER_OPTIONS) : input
  if (ast?.type !== 'File' && ast?.type !== 'Program') {
    decline('invalid-input', 'Expected source text or a Babel AST')
  }
  const context = makeContext(ast)
  const declarations = topLevelDeclarations(context)
  const variables = topLevelVariables(declarations)
  const pool = uniqueCandidate(
    variables.filter((candidate) => isPoolArray(candidate.init, context)),
    'class runtime constant pool',
  )
  const words = uniqueCandidate(
    variables.filter((candidate) => isWordArray(candidate.init)),
    'class runtime word array',
  )
  if (
    referenceCount(context, pool.binding) !== 1 ||
    referenceCount(context, words.binding) !== 1
  ) {
    decline('class-runtime-boot', 'Payload bindings have unexpected uses')
  }
  const bridges = variables
    .map((candidate) => ({
      candidate,
      bridge: decoderBridge(context, candidate, words, pool),
    }))
    .filter(({ bridge }) => bridge)
  if (bridges.length !== 1) {
    decline('class-runtime-boot', 'Class runtime payload bridge is not unique')
  }
  const { candidate: vm, bridge } = bridges[0]
  const root = rootCall(context, vm, bridge.vm, randomized)
  const frame = rootFrame(context, root, bridge.vm, randomized)
  const fieldMap = constructorFieldMap(
    context,
    bridge,
    variables,
    pool,
    words,
    root,
  )
  const methods = identifyClassRuntimeMethods(
    context,
    bridge.vm,
    root,
    frame,
    fieldMap.fields,
    randomized,
  )
  const spreadSentinel = randomized
    ? null
    : verifySpreadSentinel(context, root.dispatch, methods.vm.operand)
  const slots = verifyFrameSlots(context, bridge.vm, methods, frame, randomized)
  const opcodeCases = randomized
    ? {}
    : verifyOpcodeCases(
        context,
        root.dispatch,
        methods,
        fieldMap.fields,
        bridge.vm,
        root,
      )
  const collectionCases = randomized
    ? {}
    : verifyCollectionCases(context, root.dispatch)
  const protectionCases = randomized
    ? {}
    : verifyProtectionCases(
        context,
        root.dispatch,
        root.method.fn,
        methods,
        fieldMap.fields.words,
      )
  const timingChecks = randomized
    ? false
    : verifyTimingMode(
        context,
        root.method.fn,
        root.dispatch,
        fieldMap.fields.words,
      )
  const layout = verifyClassRuntimeContract(
    context,
    bridge.vm,
    root,
    methods,
    fieldMap.fields,
    slots,
    bridge,
    { words, pool, globals: fieldMap.globals },
    frame,
    randomized,
  )
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-class-runtime-observation.v1',
    ...(randomized ? { layout } : {}),
    pool: {
      name: pool.name,
      length: pool.init.elements.length,
      values: pool.init.elements.map((element) =>
        element.type === 'NullLiteral'
          ? null
          : element.type === 'UnaryExpression' && element.operator === '-'
            ? -element.argument.value
            : element.value,
      ),
    },
    words: {
      name: words.name,
      length: words.init.elements.length,
      values: words.init.elements.map((element) => element.value),
    },
    vm: {
      constructor: bridge.vm.identifier.name,
      instance: vm.name,
      fields: fieldMap.fields,
      argumentPositions: fieldMap.positions,
    },
    decoder: { name: bridge.decoder.identifier.name, numericMode: true },
    root: {
      method: root.method.name,
      closureConstructor: root.closure.callee.name,
      opcodeCases: root.dispatch.cases.length - 1,
    },
    frame,
    methods,
    spreadSentinel,
    slots,
    opcodeCases: { ...opcodeCases, ...collectionCases, ...protectionCases },
    timingChecks,
    globals: { name: fieldMap.globals.name },
  })
}

export function diagnoseClassRuntime(input, { randomized = false } = {}) {
  try {
    return deepFreeze({
      ok: true,
      result: recognize(input, randomized),
      diagnostic: null,
    })
  } catch (error) {
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof ContainerDecline
            ? error.code
            : error instanceof SyntaxError
              ? 'malformed-input'
              : 'class-runtime-error',
        message: error.message,
      },
    })
  }
}
