import { parse } from '@babel/parser'
import {
  ContainerDecline,
  EXPECTED_OPCODES,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
  isWordArray,
  makeContext,
  numberValue,
  propertyName,
  precedes,
  readPlainObject,
  topLevelDeclarations,
} from './container-role-helpers.js'
import { poolValues } from './observe-minified-runtime.js'
import { observeMinifiedClassFrame } from './observe-minified-class-frame.js'
import { observeMinifiedClassLoadConstant } from './observe-minified-class-load-constant.js'

function isMinifiedPool(node, context) {
  const values = poolValues(node, context)
  return values !== null && values.some((value) => typeof value === 'string')
}

function sole(items, role) {
  if (items.length !== 1) {
    decline(items.length ? 'ambiguous-role' : 'missing-role', role)
  }
  return items[0]
}

function fieldForParameter(context, constructor, parameter) {
  const assignments = constructor.body.body
    .filter((statement) => statement.type === 'ExpressionStatement')
    .map((statement) => statement.expression)
    .filter(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.operator === '=' &&
        node.left?.type === 'MemberExpression' &&
        !node.left.computed &&
        node.left.object.type === 'ThisExpression' &&
        context.sameRef(node.right, context.bindingFor(parameter)),
    )
  return propertyName(
    sole(assignments, 'VM constructor parameter field').left.property,
  )
}

function observeDispatch(context, wordField, deferEntry) {
  const switches = context
    .nodes(context.program)
    .map(({ node }) => node)
    .filter((node) => node.type === 'SwitchStatement')
  const dispatch = sole(switches, 'Minified class dispatch switch')
  const expected = [
    ...Object.values(EXPECTED_OPCODES).slice(0, -4),
    EXPECTED_OPCODES.FINALLY_SETUP,
    EXPECTED_OPCODES.PATCH,
    EXPECTED_OPCODES.JUMP_REG,
    EXPECTED_OPCODES.DEBUGGER,
  ]
  const labels = dispatch.cases.map((item) => numberValue(item.test))
  if (
    labels.length !== expected.length + 1 ||
    labels.at(-1) !== null ||
    expected.some((value, index) => labels[index] !== value)
  ) {
    decline(
      'incomplete-role',
      'Numeric dispatch labels differ from pinned order',
    )
  }
  const dispatchPath = context.paths.get(dispatch)
  const functionPath = dispatchPath.getFunctionParent()
  const loop = dispatchPath.findParent((path) => path.isForStatement())
  if (!functionPath || !loop || dispatch.discriminant.type !== 'Identifier') {
    decline('incomplete-role', 'Dispatch function or loop is missing')
  }
  const discriminantBinding = context.bindingFor(dispatch.discriminant)
  if (!discriminantBinding) {
    decline('incomplete-role', 'Dispatch discriminant is unbound')
  }
  const vmParameter = functionPath.node.params[0]
  const candidates = context
    .nodes(functionPath.node)
    .filter(({ node, path }) => {
      if (
        !['AssignmentExpression', 'VariableDeclarator'].includes(node.type) ||
        (node.type === 'AssignmentExpression' && node.operator !== '=') ||
        context.bindingFor(node.left ?? node.id) !== discriminantBinding ||
        !precedes(path, dispatchPath) ||
        path.findParent((parent) => parent.isForStatement())?.node !== loop.node
      ) {
        return false
      }
      const read = node.right ?? node.init
      const field = read?.object
      return (
        read?.type === 'MemberExpression' &&
        read.computed &&
        (context.sameRef(read.property, discriminantBinding) ||
          (deferEntry && context.bindingFor(read.property))) &&
        field?.type === 'MemberExpression' &&
        !field.computed &&
        propertyName(field.property) === wordField &&
        (field.object.type === 'ThisExpression' ||
          context.sameRef(field.object, context.bindingFor(vmParameter)))
      )
    })
  sole(candidates, 'Dispatch read from observed VM word field')
  return {
    record: { caseCount: expected.length, mode: 'switch' },
    fn: functionPath.node,
    switchNode: dispatch,
  }
}

function rootClosureBinding(
  context,
  boot,
  vmCall,
  closureCall,
  dispatch,
  vmBinding,
) {
  const root = boot.expression
  if (root?.type !== 'CallExpression') {
    decline('altered-boot', 'Root boot is not a direct call')
  }
  if (dispatch.fn.type === 'FunctionDeclaration') {
    if (
      context.bindingFor(root.callee) !== context.bindingFor(dispatch.fn.id) ||
      root.arguments[0] !== vmCall
    ) {
      decline('altered-boot', 'Root call is detached from VM dispatch')
    }
  } else {
    const assignment = context.paths.get(dispatch.fn).parentPath?.node
    const member = assignment?.left
    if (
      assignment?.type !== 'AssignmentExpression' ||
      member?.type !== 'MemberExpression' ||
      member.computed ||
      member.object?.type !== 'MemberExpression' ||
      propertyName(member.object.property) !== 'prototype' ||
      context.bindingFor(member.object.object) !== vmBinding ||
      root.callee?.type !== 'MemberExpression' ||
      root.callee.computed ||
      root.callee.object !== vmCall ||
      propertyName(root.callee.property) !== propertyName(member.property)
    ) {
      decline('altered-boot', 'Root method is detached from VM dispatch')
    }
  }
  const index = sole(
    root.arguments
      .map((argument, position) => (argument === closureCall ? position : -1))
      .filter((position) => position >= 0),
    'Root closure argument',
  )
  const binding = context.bindingFor(dispatch.fn.params[index])
  if (!binding) decline('altered-boot', 'Root closure parameter is missing')
  return binding
}

function observe(input, { deferEntry = false } = {}) {
  const ast = typeof input === 'string' ? parse(input, PARSER_OPTIONS) : input
  if (ast?.type !== 'File' && ast?.type !== 'Program') {
    decline('invalid-input', 'Expected source text or Babel AST')
  }
  const context = makeContext(ast)
  const declarations = topLevelDeclarations(context)
  const global = sole(
    declarations.filter(
      (entry) =>
        entry.kind === 'variable' &&
        entry.init?.type === 'Identifier' &&
        entry.init.name === 'globalThis' &&
        !context.bindingFor(entry.init),
    ),
    'Top-level globalThis binding',
  )
  const boot = sole(
    context.program.body
      .filter((statement) => statement.type === 'ExpressionStatement')
      .filter((statement) => {
        const newExpressions = context
          .nodes(statement)
          .map(({ node }) => node)
          .filter((node) => node.type === 'NewExpression')
        return newExpressions.some(
          (node) =>
            node.arguments.some(isWordArray) &&
            node.arguments.some((arg) => isMinifiedPool(arg, context)) &&
            node.arguments.some((arg) => context.sameRef(arg, global.binding)),
        )
      }),
    'Unique minified class boot',
  )
  const constructions = context
    .nodes(boot)
    .map(({ node }) => node)
    .filter((node) => node.type === 'NewExpression')
  const vmCall = sole(
    constructions.filter(
      (node) =>
        node.arguments.some(isWordArray) &&
        node.arguments.some((arg) => isMinifiedPool(arg, context)) &&
        node.arguments.some((arg) => context.sameRef(arg, global.binding)),
    ),
    'VM construction',
  )
  const positions = {
    words: sole(
      vmCall.arguments
        .map((arg, index) => (isWordArray(arg) ? index : -1))
        .filter((index) => index >= 0),
      'Wordcode argument',
    ),
    pool: sole(
      vmCall.arguments
        .map((arg, index) => (isMinifiedPool(arg, context) ? index : -1))
        .filter((index) => index >= 0),
      'Pool argument',
    ),
    globals: sole(
      vmCall.arguments
        .map((arg, index) =>
          context.sameRef(arg, global.binding) ? index : -1,
        )
        .filter((index) => index >= 0),
      'Global argument',
    ),
  }
  const constructorEntry = sole(
    declarations.filter(
      (entry) =>
        entry.kind === 'function' &&
        entry.binding === context.bindingFor(vmCall.callee),
    ),
    'VM constructor binding',
  )
  const constructor = constructorEntry.init
  if (!deferEntry && constructor.params.length !== vmCall.arguments.length) {
    decline('incomplete-role', 'VM constructor argument count differs')
  }
  const fields = Object.fromEntries(
    Object.entries(positions).map(([role, index]) => [
      role,
      fieldForParameter(context, constructor, constructor.params[index]),
    ]),
  )
  if (new Set(Object.values(fields)).size !== 3) {
    decline('ambiguous-role', 'VM payload fields overlap')
  }
  const assignedFields = constructor.body.body
    .filter((statement) => statement.type === 'ExpressionStatement')
    .map((statement) => statement.expression)
    .filter(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.left?.type === 'MemberExpression' &&
        !node.left.computed &&
        node.left.object.type === 'ThisExpression',
    )
    .map((node) => propertyName(node.left.property))
  if (new Set(assignedFields).size !== assignedFields.length) {
    decline('ambiguous-role', 'VM constructor overwrites a field')
  }
  const descriptor = sole(
    constructions
      .flatMap((owner) =>
        owner.arguments.map((argument, index) => ({
          owner,
          index,
          entries: readPlainObject(argument),
        })),
      )
      .filter(
        ({ entries }) =>
          entries?.size === 3 &&
          [...entries.values()].filter((value) => numberValue(value) === 0)
            .length === 2 &&
          [...entries.values()].filter(
            (value) =>
              Number.isSafeInteger(numberValue(value)) &&
              numberValue(value) > 0,
          ).length === 1,
      ),
    'Root closure descriptor',
  )
  const closureConstructor = sole(
    declarations.filter(
      (entry) =>
        entry.kind === 'function' &&
        entry.binding === context.bindingFor(descriptor.owner.callee),
    ),
    'Root closure constructor',
  ).init
  const rootDescriptor = {
    entries: descriptor.entries,
    field: fieldForParameter(
      context,
      closureConstructor,
      closureConstructor.params[descriptor.index],
    ),
  }
  const words = vmCall.arguments[positions.words].elements.map(numberValue)
  const dispatch = observeDispatch(context, fields.words, deferEntry)
  const closureBinding = rootClosureBinding(
    context,
    boot,
    vmCall,
    descriptor.owner,
    dispatch,
    constructorEntry.binding,
  )
  const frame = observeMinifiedClassFrame(context, {
    constructor,
    constructorBinding: constructorEntry.binding,
    dispatch,
    rootDescriptor,
    rootClosureBinding: closureBinding,
    fields,
  })
  const loadConstant = observeMinifiedClassLoadConstant(context, {
    boot,
    dispatch,
    constructorBinding: constructorEntry.binding,
    fields,
    frame,
    deferEntry,
  })
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-minified-class-boot.v1',
    words,
    pool: poolValues(vmCall.arguments[positions.pool], context),
    positions,
    fields,
    dispatch: dispatch.record,
    frame,
    loadConstant,
    root: {
      regCount: [...descriptor.entries.values()]
        .map(numberValue)
        .find((value) => value > 0),
    },
  })
}

export function diagnoseMinifiedClassBoot(input, options) {
  try {
    return deepFreeze({
      ok: true,
      result: observe(input, options),
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
