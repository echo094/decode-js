import { parse } from '@babel/parser'
import {
  ContainerDecline,
  EXPECTED_OPCODES,
  EXPECTED_SENTINELS,
  EXPECTED_SLOTS,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
  isWordArray,
  makeContext,
  numberValue,
  propertyName,
  readPlainObject,
  topLevelDeclarations,
} from './container-role-helpers.js'
import {
  hasPinnedMinifiedHandlerTableBody,
  hasPinnedMinifiedRuntimeBody,
} from './minified-runtime-body.js'

function isUndefined(node, context) {
  return (
    (node?.type === 'Identifier' &&
      node.name === 'undefined' &&
      !context.bindingFor(node)) ||
    (node?.type === 'UnaryExpression' &&
      node.operator === 'void' &&
      numberValue(node.argument) === 0)
  )
}

export function poolValues(node, context) {
  if (node?.type !== 'ArrayExpression') return null
  const values = []
  for (const element of node.elements) {
    if (element?.type === 'StringLiteral') {
      values.push(element.value)
    } else if (
      element?.type === 'NumericLiteral' ||
      element?.type === 'BooleanLiteral'
    ) {
      values.push(element.value)
    } else if (element?.type === 'NullLiteral') {
      values.push(null)
    } else if (
      element?.type === 'UnaryExpression' &&
      element.operator === '!' &&
      (numberValue(element.argument) === 0 ||
        numberValue(element.argument) === 1)
    ) {
      values.push(numberValue(element.argument) === 0)
    } else if (isUndefined(element, context)) {
      values.push(undefined)
    } else {
      return null
    }
  }
  return values
}

function sole(items, role) {
  if (items.length !== 1) {
    decline(items.length ? 'ambiguous-role' : 'missing-role', role)
  }
  return items[0]
}

function functionFor(context, declarations, node, role) {
  const binding = context.bindingFor(node)
  return sole(
    declarations.filter(
      (entry) => entry.kind === 'function' && entry.binding === binding,
    ),
    role,
  ).init
}

function same(context, node, id) {
  return context.sameRef(node, context.bindingFor(id))
}

function directThisAssignments(fn) {
  const result = new Map()
  for (const statement of fn.body.body) {
    const expr =
      statement.type === 'ExpressionStatement' && statement.expression
    if (
      expr?.type !== 'AssignmentExpression' ||
      expr.operator !== '=' ||
      expr.left?.type !== 'MemberExpression' ||
      expr.left.computed ||
      expr.left.object.type !== 'ThisExpression'
    ) {
      continue
    }
    const name = propertyName(expr.left.property)
    if (result.has(name)) decline('ambiguous-role', 'Duplicate VM field')
    result.set(name, expr.right)
  }
  return result
}

function member(node, object, property, context) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    same(context, node.object, object) &&
    propertyName(node.property) === property
  )
}

function localFor(context, fn, predicate, role) {
  return sole(
    context
      .nodes(fn)
      .map(({ node }) => node)
      .filter(
        (node) => node.type === 'VariableDeclarator' && predicate(node.init),
      ),
    role,
  ).id
}

function frameSlot(node, regs, fp, context) {
  if (
    node?.type !== 'MemberExpression' ||
    !node.computed ||
    !same(context, node.object, regs) ||
    node.property?.type !== 'BinaryExpression' ||
    node.property.operator !== '+' ||
    !same(context, node.property.left, fp)
  ) {
    return null
  }
  return numberValue(node.property.right)
}

function observeFrame(context, frame, vmFields, closure, rootDescriptor) {
  if (frame.params.length !== 5) {
    decline('incomplete-role', 'Frame initializer has unexpected arguments')
  }
  const [vmArg, closureArg, , thisArg, retArg] = frame.params
  const regs = localFor(
    context,
    frame,
    (init) => member(init, vmArg, vmFields.regs, context),
    'Frame register array',
  )
  const fp = localFor(
    context,
    frame,
    (init) => member(init, vmArg, vmFields.top, context),
    'Frame pointer',
  )
  const fn = localFor(
    context,
    frame,
    (init) => member(init, closureArg, closure.fn, context),
    'Closure descriptor',
  )
  const regCount = sole(
    [...rootDescriptor]
      .filter(
        ([, value]) =>
          Number.isSafeInteger(numberValue(value)) && numberValue(value) > 0,
      )
      .map(([name]) => name),
    'Root register count',
  )
  const size = localFor(
    context,
    frame,
    (init) =>
      init?.type === 'BinaryExpression' &&
      init.operator === '+' &&
      numberValue(init.left) === 8 &&
      member(init.right, fn, regCount, context),
    'Frame size',
  )
  const base = sole(
    context
      .nodes(frame)
      .map(({ node }) => node)
      .filter(
        (node) =>
          node.type === 'AssignmentExpression' &&
          node.operator === '=' &&
          node.right?.type === 'BinaryExpression' &&
          node.right.operator === '+' &&
          same(context, node.right.left, fp) &&
          numberValue(node.right.right) === 8,
      ),
    'Register base',
  ).left
  const writes = new Map()
  for (const { node } of context.nodes(frame)) {
    if (node.type !== 'AssignmentExpression' || node.operator !== '=') continue
    const slot = frameSlot(node.left, regs, fp, context)
    if (slot === null) continue
    if (writes.has(slot))
      decline('ambiguous-role', 'Duplicate frame slot write')
    writes.set(slot, node.right)
  }
  const pc = writes.get(0)
  const start =
    pc?.type === 'MemberExpression' &&
    !pc.computed &&
    same(context, pc.object, fn) &&
    propertyName(pc.property)
  if (!start || numberValue(rootDescriptor.get(start)) !== 0) {
    decline('incomplete-role', 'Root start PC is not connected to frame PC')
  }
  const expected = new Map([
    [0, (value) => member(value, fn, start, context)],
    [1, (value) => member(value, vmArg, vmFields.frame, context)],
    [2, (value) => same(context, value, retArg)],
    [3, (value) => same(context, value, thisArg)],
    [4, (value) => same(context, value, closureArg)],
    [6, (value) => same(context, value, size)],
    [7, (value) => same(context, value, base)],
  ])
  if ([...expected].some(([slot, check]) => !check(writes.get(slot)))) {
    decline('incomplete-role', 'Frame header writes differ from pinned layout')
  }
  return {
    startPc: 0,
    regCount: numberValue(rootDescriptor.get(regCount)),
    headerSize: 8,
    frameStart: 1,
  }
}

function verifyDispatchRoles(context, run, dispatch, vmFields) {
  const [vmArg] = run.params
  const regs = sole(
    context
      .nodes(run)
      .map(({ node }) => node)
      .filter(
        (node) =>
          node.type === 'AssignmentExpression' &&
          node.operator === '=' &&
          member(node.right, vmArg, vmFields.regs, context),
      ),
    'Dispatch register array',
  ).left
  const fp = localFor(
    context,
    run,
    (init) => member(init, vmArg, vmFields.frame, context),
    'Dispatch frame pointer',
  )
  const caseFor = (opcode) =>
    dispatch.cases.find((item) => numberValue(item.test) === opcode)
  const nodesFor = (opcode) =>
    context.nodes(caseFor(opcode)).map(({ node }) => node)
  for (const opcode of [
    EXPECTED_OPCODES.CALL,
    EXPECTED_OPCODES.CALL_METHOD,
    EXPECTED_OPCODES.NEW,
  ]) {
    const uses = nodesFor(opcode).filter(
      (node) =>
        node.type === 'BinaryExpression' &&
        node.operator === '===' &&
        numberValue(node.right) === EXPECTED_SENTINELS.CALL_SPREAD,
    )
    if (uses.length !== 1) {
      decline(
        'incomplete-role',
        'CALL_SPREAD sentinel is not in all call handlers',
      )
    }
  }
  for (const opcode of [
    EXPECTED_OPCODES.TRY_SETUP,
    EXPECTED_OPCODES.TRY_END,
    EXPECTED_OPCODES.FINALLY_SETUP,
  ]) {
    if (
      !nodesFor(opcode).some(
        (node) =>
          frameSlot(node, regs, fp, context) === EXPECTED_SLOTS.HANDLERS,
      )
    ) {
      decline('incomplete-role', 'Handler stack slot is not connected')
    }
  }
  for (const opcode of [EXPECTED_OPCODES.JUMP, EXPECTED_OPCODES.JUMP_REG]) {
    if (
      !nodesFor(opcode).some(
        (node) =>
          node.type === 'AssignmentExpression' &&
          frameSlot(node.left, regs, fp, context) === EXPECTED_SLOTS.PC,
      )
    ) {
      decline('incomplete-role', 'Jump handler does not write the PC slot')
    }
  }
  if (
    !nodesFor(EXPECTED_OPCODES.PATCH).some(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.left?.type === 'MemberExpression' &&
        node.left.computed &&
        member(node.left.object, vmArg, vmFields.words, context),
    )
  ) {
    decline('incomplete-role', 'PATCH handler does not write wordcode')
  }
}

function verifyHandlerTableDispatch(context, declarations, vm, run, vmFields) {
  const vmBinding = context.bindingFor(vm.id)
  const aliases = declarations.filter(
    (entry) =>
      entry.kind === 'variable' &&
      entry.init?.type === 'MemberExpression' &&
      !entry.init.computed &&
      propertyName(entry.init.property) === 'prototype' &&
      context.sameRef(entry.init.object, vmBinding),
  )
  const alias = sole(aliases, 'VM prototype table')
  const handlers = context.program.body
    .filter((statement) => statement.type === 'ExpressionStatement')
    .map((statement) => statement.expression)
    .filter(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.operator === '=' &&
        node.left?.type === 'MemberExpression' &&
        node.left.computed &&
        context.sameRef(node.left.object, alias.binding),
    )
  const expected = new Set(Object.values(EXPECTED_OPCODES))
  const keys = handlers.map((handler) => numberValue(handler.left.property))
  if (
    keys.length !== expected.size ||
    new Set(keys).size !== expected.size ||
    keys.some((key) => !expected.has(key)) ||
    handlers.some(
      (handler) =>
        handler.right?.type !== 'FunctionExpression' ||
        handler.right.params.length !== 0,
    )
  ) {
    decline('incomplete-role', 'Minified opcode table is incomplete')
  }
  const dynamic = sole(
    context
      .nodes(run)
      .map(({ node }) => node)
      .filter(
        (node) =>
          node.type === 'CallExpression' &&
          node.arguments.length === 0 &&
          node.callee?.type === 'MemberExpression' &&
          node.callee.computed &&
          same(context, node.callee.object, run.params[0]),
      ),
    'Dynamic VM dispatch',
  )
  const opcodeBinding = context.bindingFor(dynamic.callee.property)
  const reads = context
    .nodes(run)
    .map(({ node }) => node)
    .filter(
      (node) =>
        node.type === 'VariableDeclarator' &&
        context.bindingFor(node.id) === opcodeBinding &&
        node.init?.type === 'MemberExpression' &&
        node.init.computed &&
        member(node.init.object, run.params[0], vmFields.words, context),
    )
  if (!opcodeBinding || reads.length !== 1) {
    decline('incomplete-role', 'Opcode table is detached from wordcode read')
  }
}

function recognize(ast, handlerTable = false) {
  const context = makeContext(ast)
  const declarations = topLevelDeclarations(context)
  const boots = context.program.body
    .filter((statement) => statement.type === 'ExpressionStatement')
    .map((statement) => statement.expression)
    .filter(
      (call) =>
        call.type === 'CallExpression' &&
        call.arguments.length === 4 &&
        call.arguments[0]?.type === 'NewExpression' &&
        isWordArray(call.arguments[0].arguments[0]) &&
        poolValues(call.arguments[0].arguments[1], context) &&
        call.arguments[1]?.type === 'NewExpression' &&
        isUndefined(call.arguments[2], context) &&
        call.arguments[3]?.type === 'NullLiteral',
    )
  const boot = sole(boots, 'Unique minified VM boot')
  const vmCall = boot.arguments[0]
  if (
    vmCall.arguments.length !== 3 ||
    vmCall.arguments[2]?.type !== 'Identifier'
  ) {
    decline('altered-boot', 'VM construction lacks global binding')
  }
  const globalBinding = context.bindingFor(vmCall.arguments[2])
  if (
    !globalBinding ||
    !declarations.some(
      (entry) =>
        entry.binding === globalBinding &&
        entry.init?.type === 'Identifier' &&
        entry.init.name === 'globalThis',
    )
  ) {
    decline('altered-boot', 'VM global argument is not globalThis')
  }
  const vm = functionFor(context, declarations, vmCall.callee, 'VM constructor')
  const closure = functionFor(
    context,
    declarations,
    boot.arguments[1].callee,
    'Closure constructor',
  )
  const run = functionFor(context, declarations, boot.callee, 'VM run function')
  if (
    vm.params.length !== 3 ||
    closure.params.length !== 1 ||
    run.params.length !== 4
  ) {
    decline('incomplete-role', 'Boot constructor or run arity changed')
  }
  const vmAssignments = directThisAssignments(vm)
  const vmField = (param, role) =>
    sole(
      [...vmAssignments]
        .filter(([, value]) => same(context, value, param))
        .map(([name]) => name),
      role,
    )
  const vmFields = {
    words: vmField(vm.params[0], 'VM wordcode field'),
    pool: vmField(vm.params[1], 'VM pool field'),
    globals: vmField(vm.params[2], 'VM globals field'),
  }
  const closureAssignments = directThisAssignments(closure)
  const closureFn = sole(
    [...closureAssignments]
      .filter(([, value]) => same(context, value, closure.params[0]))
      .map(([name]) => name),
    'Closure descriptor field',
  )
  const descriptor = readPlainObject(boot.arguments[1].arguments[0])
  if (!descriptor || descriptor.size !== 3) {
    decline('altered-boot', 'Root Closure descriptor is malformed')
  }
  let dispatch
  if (!handlerTable) {
    const switches = context
      .nodes(run)
      .filter(({ node }) => node.type === 'SwitchStatement')
    dispatch = sole(switches, 'VM dispatch switch').node
    const cases = dispatch.cases.map((item) => numberValue(item.test))
    // This is the pinned runtime's source order, which differs from the opcode
    // object's insertion order near the final handler cases.
    const expectedCases = [
      ...Object.values(EXPECTED_OPCODES).slice(0, -4),
      EXPECTED_OPCODES.FINALLY_SETUP,
      EXPECTED_OPCODES.PATCH,
      EXPECTED_OPCODES.JUMP_REG,
      EXPECTED_OPCODES.DEBUGGER,
    ]
    if (
      cases.length !== expectedCases.length + 1 ||
      cases.at(-1) !== null ||
      expectedCases.some((value, index) => cases[index] !== value)
    ) {
      decline(
        'incomplete-role',
        'Dispatch labels differ from pinned opcode order',
      )
    }
    const opcodeId = sole(
      context
        .nodes(run)
        .map(({ node }) => node)
        .filter(
          (node) =>
            node.type === 'VariableDeclarator' &&
            node.init?.type === 'MemberExpression' &&
            node.init.computed &&
            member(node.init.object, run.params[0], vmFields.words, context) &&
            same(context, dispatch.discriminant, node.id),
        ),
      'Dispatch wordcode read',
    ).id
    if (!same(context, dispatch.discriminant, opcodeId)) {
      decline('incomplete-role', 'Switch is detached from bytecode read')
    }
  }
  const frameCall = sole(
    context
      .nodes(run)
      .map(({ node }) => node)
      .filter(
        (node) =>
          node.type === 'CallExpression' &&
          node.arguments.length === 5 &&
          same(context, node.arguments[0], run.params[0]) &&
          same(context, node.arguments[1], run.params[1]) &&
          same(context, node.arguments[2], run.params[3]) &&
          same(context, node.arguments[3], run.params[2]) &&
          numberValue(node.arguments[4]) === 0,
      ),
    'Root frame initialization',
  )
  const frame = functionFor(
    context,
    declarations,
    frameCall.callee,
    'Frame initializer',
  )
  const vmFieldByValue = (value, role) =>
    sole(
      [...vmAssignments]
        .filter(([, node]) => numberValue(node) === value)
        .map(([name]) => name),
      role,
    )
  vmFields.regs = sole(
    [...vmAssignments]
      .filter(
        ([, node]) =>
          node.type === 'ArrayExpression' && node.elements.length === 0,
      )
      .map(([name]) => name),
    'VM register field',
  )
  vmFields.top = vmFieldByValue(1, 'VM register top field')
  vmFields.frame = vmFieldByValue(0, 'VM frame pointer field')
  const frameMetadata = observeFrame(
    context,
    frame,
    vmFields,
    { fn: closureFn },
    descriptor,
  )
  if (handlerTable) {
    verifyHandlerTableDispatch(context, declarations, vm, run, vmFields)
  } else {
    verifyDispatchRoles(context, run, dispatch, vmFields)
  }
  const pinned = handlerTable
    ? hasPinnedMinifiedHandlerTableBody(ast, boot)
    : hasPinnedMinifiedRuntimeBody(ast, boot)
  if (!pinned) {
    decline(
      'incomplete-role',
      'Minified runtime body differs from pinned source',
    )
  }
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-minified-observation.v1',
    words: vmCall.arguments[0].elements.map((item) => item.value),
    pool: poolValues(vmCall.arguments[1], context),
    opcodes: { ...EXPECTED_OPCODES },
    sentinels: { ...EXPECTED_SENTINELS },
    slots: { ...EXPECTED_SLOTS },
    root: { startPc: frameMetadata.startPc, regCount: frameMetadata.regCount },
    frame: {
      headerSize: frameMetadata.headerSize,
      frameStart: frameMetadata.frameStart,
    },
  })
}

function diagnose(input, handlerTable) {
  try {
    const ast = typeof input === 'string' ? parse(input, PARSER_OPTIONS) : input
    if (ast?.type !== 'File' && ast?.type !== 'Program') {
      decline('invalid-input', 'Expected source text or Babel AST')
    }
    return deepFreeze({
      ok: true,
      result: recognize(ast, handlerTable),
      diagnostic: null,
    })
  } catch (error) {
    if (!(error instanceof ContainerDecline)) throw error
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: { code: error.code, message: error.message },
    })
  }
}

export function diagnoseMinifiedRuntime(input) {
  return diagnose(input, false)
}

export function diagnoseMinifiedHandlerTable(input) {
  return diagnose(input, true)
}
