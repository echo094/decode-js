import {
  EXPECTED_SLOTS,
  decline,
  numberValue,
  propertyName,
  prototypeMethods,
} from './container-role-helpers.js'

function thisField(node, field = null) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'ThisExpression' &&
    (field === null || propertyName(node.property) === field)
  )
}

function unique(nodes, role) {
  if (nodes.length !== 1) {
    decline('class-runtime-slots', `${role} is not unique`)
  }
  return nodes[0]
}

function local(context, fn, predicate, role) {
  return unique(
    context
      .nodes(fn)
      .filter(
        ({ node }) =>
          node.type === 'VariableDeclarator' && predicate(node.init),
      )
      .map(({ node }) => ({ node, binding: context.bindingFor(node.id) })),
    role,
  )
}

function slot(node, regs, fp, context, offset) {
  const index = node?.property
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    context.sameRef(node.object, regs) &&
    index?.type === 'BinaryExpression' &&
    index.operator === '+' &&
    context.sameRef(index.left, fp) &&
    numberValue(index.right) === offset
  )
}

function thisSlot(node, regsField, fpField, offset) {
  const index = node?.property
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    thisField(node.object, regsField) &&
    index?.type === 'BinaryExpression' &&
    index.operator === '+' &&
    thisField(index.left, fpField) &&
    numberValue(index.right) === offset
  )
}

function constructorValue(constructor, field) {
  const assignments = constructor.body.body.filter((statement) => {
    const expression =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    return (
      expression?.type === 'AssignmentExpression' &&
      thisField(expression.left, field)
    )
  })
  return assignments.length === 1 ? assignments[0].expression.right : null
}

export function verifyFrameSlots(
  context,
  vmBinding,
  methods,
  frame,
  randomized = false,
) {
  const prototype = prototypeMethods(context, { binding: vmBinding })
  const push = unique(
    prototype.filter(({ name }) => name === methods.vm.pushFrame),
    'frame method',
  ).fn
  const run = unique(
    prototype.filter(({ name }) => name === methods.vm.run),
    'run method',
  ).fn
  const operand = unique(
    prototype.filter(({ name }) => name === methods.vm.operand),
    'operand method',
  ).fn
  const capture = unique(
    prototype.filter(({ name }) => name === methods.vm.captureUpvalue),
    'upvalue capture method',
  ).fn
  const close = unique(
    prototype.filter(({ name }) => name === methods.vm.closeUpvalues),
    'upvalue close method',
  ).fn
  const constructor = vmBinding.path.node
  const regs = local(
    context,
    push,
    (init) =>
      thisField(init) &&
      constructorValue(constructor, propertyName(init.property))?.type ===
        'ArrayExpression' &&
      constructorValue(constructor, propertyName(init.property)).elements
        .length === 0,
    'register local',
  )
  const fp = local(
    context,
    push,
    (init) =>
      thisField(init) &&
      numberValue(constructorValue(constructor, propertyName(init.property))) >=
        1,
    'frame-base local',
  )
  const regsField = propertyName(regs.node.init.property)
  const topField = propertyName(fp.node.init.property)
  if (randomized) {
    const frameFields = context
      .nodes(run)
      .flatMap(({ node }) =>
        node.type === 'VariableDeclarator' &&
        thisField(node.init) &&
        numberValue(
          constructorValue(constructor, propertyName(node.init.property)),
        ) === 0
          ? [propertyName(node.init.property)]
          : [],
      )
    if (new Set(frameFields).size !== 1)
      decline('randomized-class-layout', 'Current frame field is not unique')
    return {
      fields: { regs: regsField, frame: frameFields[0], nextFrame: topField },
    }
  }
  if (
    constructorValue(constructor, regsField)?.type !== 'ArrayExpression' ||
    constructorValue(constructor, regsField).elements.length !== 0 ||
    numberValue(constructorValue(constructor, topField)) !== 1
  ) {
    decline('class-runtime-slots', 'VM register/frame origins changed')
  }
  const descriptor = local(
    context,
    push,
    (init) =>
      init?.type === 'MemberExpression' &&
      !init.computed &&
      propertyName(init.property) === frame.closureField,
    'frame descriptor local',
  )
  const closureBinding = context.bindingFor(descriptor.node.init.object)
  if (
    !closureBinding ||
    !push.params.some(
      (parameter) => context.bindingFor(parameter) === closureBinding,
    )
  ) {
    decline('class-runtime-slots', 'Frame descriptor source changed')
  }
  const size = local(
    context,
    push,
    (init) =>
      init?.type === 'BinaryExpression' &&
      init.operator === '+' &&
      numberValue(init.left) === 8 &&
      init.right?.type === 'MemberExpression' &&
      !init.right.computed &&
      context.sameRef(init.right.object, descriptor.binding) &&
      propertyName(init.right.property) === frame.regCount.field,
    'frame-size local',
  )
  const base = local(
    context,
    push,
    (init) =>
      init?.type === 'BinaryExpression' &&
      init.operator === '+' &&
      context.sameRef(init.left, fp.binding) &&
      numberValue(init.right) === 8,
    'register-base local',
  )
  const writes = new Map()
  for (const statement of push.body.body) {
    const expression =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    if (
      expression?.type !== 'AssignmentExpression' ||
      expression.operator !== '='
    ) {
      continue
    }
    for (const offset of [0, 1, 2, 3, 4, 6, 7]) {
      if (!slot(expression.left, regs.binding, fp.binding, context, offset)) {
        continue
      }
      if (writes.has(offset)) {
        decline('class-runtime-slots', 'Frame header write is duplicated')
      }
      writes.set(offset, expression.right)
    }
  }
  const caller = writes.get(1)
  const callerField = thisField(caller) ? propertyName(caller.property) : null
  const parameter = (node) => {
    const binding = context.bindingFor(node)
    return (
      binding &&
      push.params.some((part) => context.bindingFor(part) === binding)
    )
  }
  if (
    writes.size !== 7 ||
    writes.get(0)?.type !== 'MemberExpression' ||
    !context.sameRef(writes.get(0).object, descriptor.binding) ||
    propertyName(writes.get(0).property) !== frame.start.field ||
    !callerField ||
    numberValue(constructorValue(constructor, callerField)) !== 0 ||
    !parameter(writes.get(2)) ||
    !parameter(writes.get(3)) ||
    context.bindingFor(writes.get(2)) === context.bindingFor(writes.get(3)) ||
    !context.sameRef(writes.get(4), closureBinding) ||
    !context.sameRef(writes.get(6), size.binding) ||
    !context.sameRef(writes.get(7), base.binding)
  ) {
    decline('class-runtime-slots', 'Frame header role writes are incomplete')
  }

  const runRegs = local(
    context,
    run,
    (init) => thisField(init, regsField),
    'dispatch registers',
  )
  const runFp = unique(
    context
      .nodes(run)
      .filter(
        ({ node }) =>
          node.type === 'VariableDeclarator' &&
          thisField(node.init, callerField),
      )
      .map(({ node }) => ({ node, binding: context.bindingFor(node.id) }))
      .filter((candidate) =>
        context
          .nodes(run)
          .some(({ node }) =>
            slot(node, runRegs.binding, candidate.binding, context, 0),
          ),
      ),
    'dispatch frame base',
  )
  const dispatch = unique(
    context.nodes(run).filter(({ node }) => node.type === 'SwitchStatement'),
    'dispatch switch',
  ).node
  const caseHas = (opcode, offset) => {
    const branch = unique(
      dispatch.cases.filter((entry) => numberValue(entry.test) === opcode),
      `opcode ${opcode}`,
    )
    return context
      .nodes(branch)
      .some(({ node }) =>
        slot(node, runRegs.binding, runFp.binding, context, offset),
      )
  }
  if (
    ![54, 55, 59].every((opcode) => caseHas(opcode, 5)) ||
    ![1, 2, 3, 6].every((offset) => caseHas(45, offset))
  ) {
    decline('class-runtime-slots', 'Handler or return slot uses changed')
  }
  const operandSlot = context
    .nodes(operand)
    .filter(({ node }) => thisSlot(node, regsField, callerField, 0))
  const captureSlot = context
    .nodes(capture)
    .filter(
      ({ node }) =>
        node.type === 'MemberExpression' &&
        node.computed &&
        thisField(node.object, regsField) &&
        node.property?.type === 'BinaryExpression' &&
        numberValue(node.property.right) === 7 &&
        capture.params.some(
          (parameter) =>
            context.bindingFor(parameter) ===
            context.bindingFor(node.property.left),
        ),
    )
  const closeRegs = local(
    context,
    close,
    (init) => thisField(init, regsField),
    'close-upvalues registers',
  )
  const closeUses = [6, 7].every((offset) =>
    context
      .nodes(close)
      .some(({ node }) =>
        close.params.some((parameter) =>
          slot(
            node,
            closeRegs.binding,
            context.bindingFor(parameter),
            context,
            offset,
          ),
        ),
      ),
  )
  const returnBranch = unique(
    dispatch.cases.filter((entry) => numberValue(entry.test) === 45),
    'return opcode',
  )
  const callerLocal = unique(
    context
      .nodes(returnBranch)
      .filter(
        ({ node }) =>
          node.type === 'VariableDeclarator' &&
          slot(node.init, runRegs.binding, runFp.binding, context, 1),
      )
      .map(({ node }) => context.bindingFor(node.id)),
    'caller frame local',
  )
  const callerBase = context
    .nodes(returnBranch)
    .some(({ node }) => slot(node, runRegs.binding, callerLocal, context, 7))
  if (
    operandSlot.length !== 1 ||
    captureSlot.length !== 1 ||
    !closeUses ||
    !callerBase
  ) {
    decline('class-runtime-slots', 'Operand or upvalue slot uses changed')
  }
  return {
    values: { ...EXPECTED_SLOTS },
    fields: { regs: regsField, frame: callerField, nextFrame: topField },
    frameStart: 1,
  }
}

function operandCall(node, method) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.object?.type === 'ThisExpression' &&
    propertyName(node.callee.property) === method
  )
}

export function verifySpreadSentinel(context, dispatch, operandMethod) {
  const cases = [42, 43, 44].map((opcode) => {
    const matches = dispatch.cases.filter(
      (entry) => numberValue(entry.test) === opcode,
    )
    if (matches.length !== 1) {
      decline('class-runtime-sentinel', 'Call opcode case is not unique')
    }
    return matches[0]
  })
  for (const branch of cases) {
    const operandDeclarations = context
      .nodes(branch)
      .filter(
        ({ node }) =>
          node.type === 'VariableDeclarator' &&
          operandCall(node.init, operandMethod),
      )
    const tests = operandDeclarations.flatMap(({ node }) => {
      const binding = context.bindingFor(node.id)
      return context.nodes(branch).filter(({ node: candidate }) => {
        const test = candidate.type === 'IfStatement' ? candidate.test : null
        return (
          test?.type === 'BinaryExpression' &&
          test.operator === '===' &&
          context.sameRef(test.left, binding) &&
          numberValue(test.right) === 65535
        )
      })
    })
    if (tests.length !== 1) {
      decline(
        'class-runtime-sentinel',
        'Spread sentinel is not connected to each call path',
      )
    }
  }
  const extraCases = dispatch.cases.filter(
    (entry) => numberValue(entry.test) >= 61,
  )
  const uses = context
    .nodes(dispatch)
    .filter(({ node }) => numberValue(node) === 65535)
  const canonicalUses = uses.filter(
    ({ path }) =>
      !extraCases.some((entry) =>
        path.findParent((parent) => parent.node === entry),
      ),
  )
  if (
    canonicalUses.length !== 3 ||
    uses.some(
      ({ path }) =>
        !cases.some((entry) =>
          path.findParent((parent) => parent.node === entry),
        ) &&
        !extraCases.some((entry) =>
          path.findParent((parent) => parent.node === entry),
        ),
    )
  ) {
    decline('class-runtime-sentinel', 'Spread sentinel use count changed')
  }
  return 65535
}

export function verifyTimingMode(context, run, dispatch, wordField) {
  const opcodeBinding = context.bindingFor(dispatch.discriminant)
  const branches = context
    .nodes(run)
    .filter(
      ({ node }) =>
        node.type === 'IfStatement' &&
        node.test?.type === 'BooleanLiteral' &&
        node.test.value === false &&
        context
          .nodes(node)
          .some(
            ({ node: candidate }) =>
              candidate.type === 'AssignmentExpression' &&
              candidate.left?.type === 'Identifier' &&
              context.bindingFor(candidate.left) === opcodeBinding &&
              numberValue(candidate.right) === 39,
          ) &&
        context
          .nodes(node)
          .some(({ node: candidate }) => thisField(candidate, wordField)),
    )
  if (!opcodeBinding || branches.length !== 1) {
    decline('class-runtime-timing', 'Disabled timing branch is not unique')
  }
  return false
}
