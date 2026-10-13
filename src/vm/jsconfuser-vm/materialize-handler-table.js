import {
  cloneNode,
  blockStatement,
  breakStatement,
  switchCase,
  switchStatement,
} from '@babel/types'
import {
  EXPECTED_OPCODES,
  EXPECTED_SLOTS,
  decline,
  makeContext,
  numberValue,
  propertyName,
  prototypeMethods,
  referenceCount,
  topLevelDeclarations,
  topLevelVariables,
} from './container-role-helpers.js'

function prototypeAlias(context) {
  const aliases = topLevelVariables(topLevelDeclarations(context)).filter(
    (candidate) => {
      const member = candidate.init
      const vm = context.bindingFor(member?.object)
      return (
        member?.type === 'MemberExpression' &&
        !member.computed &&
        propertyName(member.property) === 'prototype' &&
        vm?.path.isFunctionDeclaration() &&
        vm.constant &&
        candidate.binding.path.parentPath.node.declarations.length === 1 &&
        candidate.binding.constant
      )
    },
  )
  if (aliases.length !== 1) {
    decline('handler-table', 'VM prototype alias is not unique')
  }
  return {
    alias: aliases[0],
    vm: context.bindingFor(aliases[0].init.object),
  }
}

function tableHandlers(context, alias) {
  const assignments = context.program.body.flatMap((statement) => {
    const expression =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    return expression?.type === 'AssignmentExpression' &&
      expression.operator === '=' &&
      expression.left?.type === 'MemberExpression' &&
      expression.left.computed &&
      context.sameRef(expression.left.object, alias.binding)
      ? [{ statement, expression }]
      : []
  })
  if (
    assignments.length < Object.keys(EXPECTED_OPCODES).length ||
    referenceCount(context, alias.binding) !== assignments.length
  ) {
    decline('handler-table', 'Opcode handler set is incomplete')
  }
  const names = new Set()
  const numericCanonical = new Set()
  const numericKeys = new Set()
  const canonicalValues = new Set(Object.values(EXPECTED_OPCODES))
  let opBinding = null
  for (const { expression } of assignments) {
    const key = expression.left.property
    const name = propertyName(key?.property)
    const binding = context.bindingFor(key?.object)
    const numeric = numberValue(key)
    const fn = expression.right
    if (
      !(
        (key?.type === 'MemberExpression' &&
          !key.computed &&
          Object.prototype.hasOwnProperty.call(EXPECTED_OPCODES, name) &&
          !names.has(name) &&
          binding &&
          (!opBinding || binding === opBinding)) ||
        (Number.isSafeInteger(numeric) &&
          ((canonicalValues.has(numeric) && !numericCanonical.has(numeric)) ||
            (numeric > 60 && !numericKeys.has(numeric))))
      ) ||
      fn?.type !== 'FunctionExpression' ||
      fn.params.length !== 0 ||
      context
        .nodes(fn)
        .some(
          ({ node, path }) =>
            node.type === 'ReturnStatement' &&
            path.getFunctionParent()?.node === fn,
        )
    ) {
      decline('handler-table', 'Opcode handler key or body changed')
    }
    if (numeric !== null) {
      if (canonicalValues.has(numeric)) numericCanonical.add(numeric)
      else numericKeys.add(numeric)
    } else {
      names.add(name)
      opBinding = binding
    }
  }
  if (
    !(
      (names.size === Object.keys(EXPECTED_OPCODES).length &&
        numericCanonical.size === 0) ||
      (names.size === 0 && numericCanonical.size === canonicalValues.size)
    ) ||
    [...numericKeys].some((opcode, index) => !numericKeys.has(61 + index))
  ) {
    decline('handler-table', 'Opcode handler keys are incomplete')
  }
  return assignments
}

function dynamicDispatch(context, vm) {
  const methods = prototypeMethods(context, { binding: vm })
  const candidates = methods.flatMap((method) =>
    context
      .nodes(method.fn)
      .filter(
        ({ node, path }) =>
          node.type === 'ExpressionStatement' &&
          node.expression?.type === 'CallExpression' &&
          node.expression.arguments.length === 0 &&
          node.expression.callee?.type === 'MemberExpression' &&
          node.expression.callee.computed &&
          node.expression.callee.object?.type === 'ThisExpression' &&
          context
            .bindingFor(node.expression.callee.property)
            ?.path.isVariableDeclarator() &&
          path.getFunctionParent()?.node === method.fn,
      )
      .map(({ node, path }) => ({ node, path, run: method.fn })),
  )
  if (candidates.length !== 1) {
    decline('handler-table', 'Dynamic VM dispatch is not unique')
  }
  return candidates[0]
}

function thisField(node, field) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'ThisExpression' &&
    propertyName(node.property) === field
  )
}

function injectedLocals(context, assignments, run) {
  const locals = context
    .nodes(run)
    .filter(
      ({ node, path }) =>
        node.type === 'VariableDeclarator' &&
        node.id.type === 'Identifier' &&
        path.getFunctionParent()?.node === run,
    )
  const bases = locals.filter(({ node }) => {
    const value = node.init
    return (
      value?.type === 'MemberExpression' &&
      value.computed &&
      value.property?.type === 'BinaryExpression' &&
      value.property.operator === '+' &&
      context.bindingFor(value.object)?.path.node.init?.object?.type ===
        'ThisExpression' &&
      context.bindingFor(value.property.left)?.path.node.init?.object?.type ===
        'ThisExpression' &&
      (propertyName(value.property.right?.property) === 'REG_BASE' ||
        numberValue(value.property.right) === EXPECTED_SLOTS.REG_BASE)
    )
  })
  if (bases.length !== 1)
    decline('handler-table', 'Outer register base is not unique')
  const base = bases[0].node
  const regsBinding = context.bindingFor(base.init.object)
  const fpBinding = context.bindingFor(base.init.property.left)
  const regs = locals.find(
    ({ node }) => context.bindingFor(node.id) === regsBinding,
  )?.node
  const fp = locals.find(
    ({ node }) => context.bindingFor(node.id) === fpBinding,
  )?.node
  if (
    !regs ||
    !fp ||
    !thisField(regs.init, propertyName(regs.init?.property)) ||
    !thisField(fp.init, propertyName(fp.init?.property))
  )
    decline('handler-table', 'Outer frame locals are disconnected')
  const fields = {
    regs: propertyName(regs.init.property),
    fp: propertyName(fp.init.property),
  }
  const outer = { regs, fp, base }
  const slotBinding = context.bindingFor(base.init.property.right?.object)
  const registerBaseSlot = (node) =>
    slotBinding
      ? propertyName(node?.property) === 'REG_BASE' &&
        context.sameRef(node?.object, slotBinding)
      : numberValue(node) === EXPECTED_SLOTS.REG_BASE
  const plans = new Map()
  for (const { expression } of assignments) {
    const fn = expression.right
    const prefix = new Map()
    const removed = []
    for (const statement of fn.body.body) {
      const declaration =
        statement.type === 'VariableDeclaration' &&
        statement.declarations.length === 1
          ? statement.declarations[0]
          : null
      if (declaration?.id?.type !== 'Identifier') break
      const value = declaration.init
      let role
      if (thisField(value, fields.regs)) role = 'regs'
      else if (thisField(value, fields.fp)) role = 'fp'
      else if (
        value?.type === 'MemberExpression' &&
        value.computed &&
        value.property?.type === 'BinaryExpression' &&
        value.property.operator === '+' &&
        registerBaseSlot(value.property.right) &&
        (context.sameRef(
          value.object,
          context.bindingFor(prefix.get('regs')?.id),
        ) ||
          thisField(value.object, fields.regs)) &&
        (context.sameRef(
          value.property.left,
          context.bindingFor(prefix.get('fp')?.id),
        ) ||
          thisField(value.property.left, fields.fp))
      )
        role = 'base'
      else {
        if (
          value?.type === 'MemberExpression' &&
          ((removed.length === 0 && value.object?.type === 'ThisExpression') ||
            (!prefix.has('base') &&
              propertyName(value.property?.right?.property) === 'REG_BASE' &&
              context.sameRef(
                value.object,
                context.bindingFor(prefix.get('regs')?.id),
              )))
        )
          decline('handler-table', 'Injected frame locals changed')
        break
      }
      if (prefix.has(role))
        decline('handler-table', 'Injected handler local is duplicated')
      const binding = context.bindingFor(declaration.id)
      if (!binding?.constant)
        decline('handler-table', 'Injected handler local is reassigned')
      prefix.set(role, declaration)
      removed.push(statement)
    }
    plans.set(fn, { prefix, removed })
  }
  return { outer, plans }
}

export function materializeHandlerTable(input) {
  const ast = cloneNode(input, true)
  const context = makeContext(ast)
  const { alias, vm } = prototypeAlias(context)
  const assignments = tableHandlers(context, alias)
  const dispatch = dynamicDispatch(context, vm)
  const { outer, plans } = injectedLocals(context, assignments, dispatch.run)
  for (const { prefix } of plans.values()) {
    for (const [role, declaration] of prefix) {
      const binding = context.bindingFor(declaration.id)
      for (const reference of binding.referencePaths)
        reference.node.name = outer[role].id.name
    }
  }
  const cases = assignments.map(({ expression }) => {
    const removed = new Set(plans.get(expression.right).removed)
    const body = expression.right.body.body.filter(
      (statement) => !removed.has(statement),
    )
    return switchCase(cloneNode(expression.left.property, true), [
      blockStatement([
        ...body.map((statement) => cloneNode(statement, true)),
        breakStatement(),
      ]),
    ])
  })
  if (
    assignments.some(
      ({ expression }) => numberValue(expression.left.property) === 0,
    )
  ) {
    cases.push(switchCase(null, [breakStatement()]))
  }
  dispatch.path.replaceWith(
    switchStatement(
      cloneNode(dispatch.node.expression.callee.property, true),
      cases,
    ),
  )
  const removed = new Set([
    alias.binding.path.parentPath.node,
    ...assignments.map(({ statement }) => statement),
  ])
  ast.program.body = ast.program.body.filter(
    (statement) => !removed.has(statement),
  )
  context.programPath.scope.crawl()
  return ast
}
