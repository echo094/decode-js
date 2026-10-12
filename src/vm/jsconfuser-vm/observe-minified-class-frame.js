import {
  decline,
  numberValue,
  propertyName,
  precedes,
} from './container-role-helpers.js'

function sole(items, role) {
  if (items.length !== 1) {
    decline(items.length ? 'ambiguous-role' : 'missing-role', role)
  }
  return items[0]
}

function same(context, node, binding) {
  return context.sameRef(node, binding)
}

function vmMember(context, node, receiver, field, allowThis) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    propertyName(node.property) === field &&
    (allowThis
      ? node.object.type === 'ThisExpression'
      : same(context, node.object, receiver))
  )
}

function bindingAssignedFrom(context, fn, binding, predicate) {
  if (!binding) decline('incomplete-role', 'Frame role binding is missing')
  return sole(
    context
      .nodes(fn)
      .map(({ node, path }) => ({ node, path }))
      .filter(({ path }) => path.getFunctionParent()?.node === fn)
      .filter(({ node }) => {
        if (
          node.type === 'VariableDeclarator' &&
          context.bindingFor(node.id) === binding
        ) {
          return predicate(node.init)
        }
        return (
          node.type === 'AssignmentExpression' &&
          node.operator === '=' &&
          context.bindingFor(node.left) === binding &&
          predicate(node.right)
        )
      }),
    'Unique frame role assignment',
  ).node
}

function assignedBinding(context, node) {
  return context.bindingFor(
    node.type === 'VariableDeclarator' ? node.id : node.left,
  )
}

function bindingFromValue(context, fn, predicate, role) {
  const assignment = sole(
    context
      .nodes(fn)
      .filter(({ path }) => path.getFunctionParent()?.node === fn)
      .map(({ node }) => node)
      .filter((node) =>
        node.type === 'VariableDeclarator'
          ? predicate(node.init)
          : node.type === 'AssignmentExpression' &&
            node.operator === '=' &&
            predicate(node.right),
      ),
    role,
  )
  const binding = assignedBinding(context, assignment)
  if (!binding) decline('incomplete-role', `${role} is unbound`)
  return binding
}

function slotWrite(context, node) {
  const left = node.left
  if (
    node.type !== 'AssignmentExpression' ||
    node.operator !== '=' ||
    left?.type !== 'MemberExpression' ||
    !left.computed ||
    left.property?.type !== 'BinaryExpression' ||
    left.property.operator !== '+'
  ) {
    return null
  }
  const slot = numberValue(left.property.right)
  const regs = context.bindingFor(left.object)
  const fp = context.bindingFor(left.property.left)
  return slot !== null && regs && fp
    ? { slot, regs, fp, value: node.right }
    : null
}

function frameCandidates(context) {
  const functions = context
    .nodes(context.program)
    .map(({ node }) => node)
    .filter(
      (node) =>
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression',
    )
  return functions.flatMap((fn) => {
    const writes = context
      .nodes(fn)
      .filter(({ path }) => path.getFunctionParent()?.node === fn)
      .map(({ node }) => slotWrite(context, node))
      .filter(Boolean)
    return writes
      .filter((write) => write.slot === 0)
      .map((first) => {
        const group = writes.filter(
          (write) => write.regs === first.regs && write.fp === first.fp,
        )
        const slots = new Map(group.map((write) => [write.slot, write.value]))
        return { fn, regs: first.regs, fp: first.fp, group, slots }
      })
      .filter(
        ({ group, slots }) =>
          group.length === 7 &&
          [0, 1, 2, 3, 4, 6, 7].every((slot) => slots.has(slot)),
      )
  })
}

function constructorField(constructor, predicate, role) {
  return propertyName(
    sole(
      constructor.body.body
        .filter((statement) => statement.type === 'ExpressionStatement')
        .map((statement) => statement.expression)
        .filter(
          (node) =>
            node.type === 'AssignmentExpression' &&
            node.operator === '=' &&
            node.left?.type === 'MemberExpression' &&
            !node.left.computed &&
            node.left.object.type === 'ThisExpression' &&
            predicate(node.right),
        ),
      role,
    ).left.property,
  )
}

function verifyFrameCall(context, frame, dispatch, vmConstructorBinding) {
  const framePath = context.paths.get(frame)
  const parent = framePath.parentPath?.node
  let method = null
  if (frame.type === 'FunctionExpression') {
    const left = parent?.left
    if (
      parent?.type !== 'AssignmentExpression' ||
      left?.type !== 'MemberExpression' ||
      left.computed ||
      left.object?.type !== 'MemberExpression' ||
      propertyName(left.object.property) !== 'prototype' ||
      context.bindingFor(left.object.object) !== vmConstructorBinding
    ) {
      decline('incomplete-role', 'Frame method is detached from VM prototype')
    }
    method = propertyName(left.property)
  }
  const frameBinding = frame.id && context.bindingFor(frame.id)
  const calls = context
    .nodes(dispatch.fn)
    .filter(
      ({ node, path }) =>
        node.type === 'CallExpression' &&
        path.getFunctionParent()?.node === dispatch.fn &&
        precedes(path, context.paths.get(dispatch.switchNode)),
    )
    .map(({ node }) => node)
    .filter((node) =>
      method
        ? node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          propertyName(node.callee.property) === method &&
          (dispatch.fn.type === 'FunctionExpression'
            ? node.callee.object.type === 'ThisExpression'
            : same(
                context,
                node.callee.object,
                context.bindingFor(dispatch.fn.params[0]),
              ))
        : same(context, node.callee, frameBinding),
    )
  const call = sole(calls, 'Dispatch frame initialization call')
  if (
    !method &&
    !(dispatch.fn.type === 'FunctionExpression'
      ? call.arguments[0]?.type === 'ThisExpression'
      : same(
          context,
          call.arguments[0],
          context.bindingFor(dispatch.fn.params[0]),
        ))
  ) {
    decline('incomplete-role', 'Frame call uses a different VM receiver')
  }
  return call
}

export function observeMinifiedClassFrame(
  context,
  {
    constructor,
    constructorBinding,
    dispatch,
    rootDescriptor,
    rootClosureBinding,
    fields,
  },
) {
  const vmFields = {
    regs: constructorField(
      constructor,
      (value) =>
        value?.type === 'ArrayExpression' && value.elements.length === 0,
      'VM register array',
    ),
    top: constructorField(
      constructor,
      (value) => numberValue(value) === 1,
      'VM register top',
    ),
    frame: constructorField(
      constructor,
      (value) => numberValue(value) === 0,
      'VM frame pointer',
    ),
  }
  if (
    new Set([...Object.values(vmFields), ...Object.values(fields)]).size !== 6
  ) {
    decline('ambiguous-role', 'VM state and payload fields overlap')
  }
  const candidate = sole(frameCandidates(context), 'Frame header writer')
  const { fn, regs, fp, slots } = candidate
  const receiver = context.bindingFor(fn.params[0])
  const allowThis = fn.type === 'FunctionExpression'
  bindingAssignedFrom(context, fn, regs, (value) =>
    vmMember(context, value, receiver, vmFields.regs, allowThis),
  )
  bindingAssignedFrom(context, fn, fp, (value) =>
    vmMember(context, value, receiver, vmFields.top, allowThis),
  )
  if (!vmMember(context, slots.get(1), receiver, vmFields.frame, allowThis)) {
    decline('incomplete-role', 'Caller frame header is detached')
  }
  const parameters = new Set(
    fn.params.map((param) => context.bindingFor(param)),
  )
  for (const slot of [2, 3, 4]) {
    if (!parameters.has(context.bindingFor(slots.get(slot)))) {
      decline('incomplete-role', `Frame header slot ${slot} is not a parameter`)
    }
  }
  const closure = context.bindingFor(slots.get(4))
  const descriptor = bindingFromValue(
    context,
    fn,
    (value) =>
      value?.type === 'MemberExpression' &&
      !value.computed &&
      propertyName(value.property) === rootDescriptor.field &&
      same(context, value.object, closure),
    'Frame closure descriptor',
  )
  const start = slots.get(0)
  if (
    start?.type !== 'MemberExpression' ||
    start.computed ||
    !same(context, start.object, descriptor) ||
    numberValue(rootDescriptor.entries.get(propertyName(start.property))) !== 0
  ) {
    decline('incomplete-role', 'Frame PC is detached from root start field')
  }
  const regCountField = sole(
    [...rootDescriptor.entries]
      .filter(([, value]) => numberValue(value) > 0)
      .map(([name]) => name),
    'Root register count field',
  )
  const size = context.bindingFor(slots.get(6))
  bindingAssignedFrom(
    context,
    fn,
    size,
    (value) =>
      value?.type === 'BinaryExpression' &&
      value.operator === '+' &&
      numberValue(value.left) === 8 &&
      value.right?.type === 'MemberExpression' &&
      !value.right.computed &&
      same(context, value.right.object, descriptor) &&
      propertyName(value.right.property) === regCountField,
  )
  const base = context.bindingFor(slots.get(7))
  bindingAssignedFrom(
    context,
    fn,
    base,
    (value) =>
      value?.type === 'BinaryExpression' &&
      value.operator === '+' &&
      same(context, value.left, fp) &&
      numberValue(value.right) === 8,
  )
  const end = bindingFromValue(
    context,
    fn,
    (value) =>
      value?.type === 'BinaryExpression' &&
      value.operator === '+' &&
      same(context, value.left, fp) &&
      same(context, value.right, size),
    'Frame end',
  )
  const writes = context
    .nodes(fn)
    .filter(({ path }) => path.getFunctionParent()?.node === fn)
    .map(({ node }) => node)
    .filter(
      (node) => node.type === 'AssignmentExpression' && node.operator === '=',
    )
  sole(
    writes.filter(
      (node) =>
        vmMember(context, node.left, receiver, vmFields.top, allowThis) &&
        same(context, node.right, end),
    ),
    'VM register top update',
  )
  sole(
    writes.filter(
      (node) =>
        vmMember(context, node.left, receiver, vmFields.frame, allowThis) &&
        same(context, node.right, fp),
    ),
    'VM current frame update',
  )
  const call = verifyFrameCall(context, fn, dispatch, constructorBinding)
  const retIndex = fn.params.findIndex(
    (parameter) =>
      context.bindingFor(parameter) === context.bindingFor(slots.get(2)),
  )
  if (numberValue(call.arguments[retIndex]) !== 0) {
    decline('incomplete-role', 'Root frame return destination is not zero')
  }
  const closureIndex = fn.params.findIndex(
    (parameter) => context.bindingFor(parameter) === closure,
  )
  if (!same(context, call.arguments[closureIndex], rootClosureBinding)) {
    decline('incomplete-role', 'Root closure is detached from frame call')
  }
  return { ...vmFields, headerSize: 8, frameStart: 1, startPc: 0 }
}
