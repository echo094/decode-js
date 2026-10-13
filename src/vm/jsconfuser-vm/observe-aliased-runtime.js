import {
  cloneRuntimeFragment,
  runtimeFragmentPattern,
} from './runtime-fragment-pattern.js'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { diagnoseContainer } from './extract-container.js'
import {
  ContainerDecline,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
  makeContext,
  numberValue,
  propertyName,
  prototypeMethods,
  referenceCount,
  topLevelDeclarations,
} from './container-role-helpers.js'

function caseBody(entry) {
  const statements =
    entry.consequent.length === 1 &&
    entry.consequent[0].type === 'BlockStatement'
      ? entry.consequent[0].body
      : entry.consequent
  return statements.filter(
    (statement) =>
      statement.type !== 'BreakStatement' &&
      statement.type !== 'EmptyStatement',
  )
}

function singleDeclaration(statement) {
  return statement?.type === 'VariableDeclaration' &&
    statement.declarations.length === 1
    ? statement.declarations[0]
    : null
}

function methodCall(node, name) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.object.type === 'ThisExpression' &&
    propertyName(node.callee.property) === name
  )
}

function isDummyLiteral(node) {
  return (
    node?.type === 'NullLiteral' ||
    node?.type === 'NumericLiteral' ||
    node?.type === 'StringLiteral' ||
    (node?.type === 'Identifier' && node.name === 'undefined') ||
    (node?.type === 'ArrayExpression' && node.elements.length === 0) ||
    (node?.type === 'ObjectExpression' && node.properties.length === 0)
  )
}

function within(path, ancestor) {
  for (let current = path; current; current = current.parentPath) {
    if (current.node === ancestor) return true
  }
  return false
}

function fakeExpression(node, parameters, context) {
  if (node?.type === 'Identifier')
    return parameters.has(context.bindingFor(node))
  if (node?.type === 'ArrayExpression')
    return node.elements.every((item) =>
      fakeExpression(item, parameters, context),
    )
  if (node?.type === 'LogicalExpression')
    return (
      ['&&', '||'].includes(node.operator) &&
      fakeExpression(node.left, parameters, context) &&
      fakeExpression(node.right, parameters, context)
    )
  return false
}

export function classCallLayouts(context, declarations, roles, methods) {
  const layouts = new Map()
  const classMethods = Object.values(roles.constructors).flatMap(({ name }) => {
    const candidates = declarations.filter(
      (item) => item.kind === 'function' && item.name === name,
    )
    return candidates.length === 1
      ? prototypeMethods(context, candidates[0])
      : []
  })
  const counts = new Map()
  for (const { name } of classMethods)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  for (const { name, fn } of classMethods) {
    if (counts.get(name) !== 1) continue
    if (!fn.params.every((param) => param.type === 'Identifier')) continue
    const bindings = fn.params.map((param) => context.bindingFor(param))
    const parameters = new Set(bindings)
    const fakeWrites = context.nodes(fn).flatMap(({ node }) => {
      if (
        node.type !== 'AssignmentExpression' ||
        node.operator !== '=' ||
        node.left?.type !== 'MemberExpression' ||
        node.left.computed ||
        node.left.object.type !== 'ThisExpression' ||
        !fakeExpression(node.right, parameters, context)
      ) {
        return []
      }
      const field = propertyName(node.left.property)
      const uses = context
        .nodes(context.program)
        .filter(
          ({ node: candidate }) =>
            candidate.type === 'MemberExpression' &&
            !candidate.computed &&
            propertyName(candidate.property) === field,
        )
      return uses.length === 1 && uses[0].node === node.left ? [node.right] : []
    })
    const fakePositions = new Set()
    for (const [index, binding] of bindings.entries()) {
      const references = context
        .nodes(fn)
        .filter(({ node }) => context.isReference(node, binding))
      if (
        references.length > 0 &&
        references.every(({ path }) =>
          fakeWrites.some((right) => within(path, right)),
        )
      ) {
        fakePositions.add(index)
      }
    }
    const realPositions = bindings.flatMap((_, index) =>
      fakePositions.has(index) ? [] : [index],
    )
    let order = realPositions
    if (name === methods.constant) {
      order = context.nodes(fn).flatMap(({ node }) => {
        const initial = node.type === 'VariableDeclarator' ? node.init : null
        if (
          initial?.type !== 'LogicalExpression' ||
          initial.operator !== '??' ||
          !methodCall(initial.right, methods.operand)
        ) {
          return []
        }
        const index = bindings.indexOf(context.bindingFor(initial.left))
        return index >= 0 ? [index] : []
      })
      if (
        order.length !== 2 ||
        new Set(order).size !== 2 ||
        order.some((index) => fakePositions.has(index))
      ) {
        decline('alias-runtime', 'Class constant parameter order is ambiguous')
      }
    }
    layouts.set(name, {
      arity: bindings.length,
      fakePositions,
      order,
    })
  }
  if (
    layouts.get(methods.operand)?.order.length !== 0 ||
    layouts.get(methods.constant)?.order.length !== 2
  ) {
    decline('alias-runtime', 'Class operand bridge is ambiguous')
  }
  return layouts
}

export function normalizedArguments(node, layout) {
  if (!layout || node.arguments.length === 0) return node.arguments
  if (
    node.arguments.length !== layout.arity ||
    [...layout.fakePositions].some(
      (index) => !isDummyLiteral(node.arguments[index]),
    )
  ) {
    decline('alias-runtime', 'Class fake call arguments changed')
  }
  return layout.order.map((index) => node.arguments[index])
}

export function normalizeFakeCalls(statements, layouts) {
  traverse(t.blockStatement(statements), {
    noScope: true,
    CallExpression(path) {
      const callee = path.node.callee
      if (callee.type !== 'MemberExpression' || callee.computed) {
        return
      }
      const layout = layouts.get(propertyName(callee.property))
      if (layout) path.node.arguments = normalizedArguments(path.node, layout)
    },
  })
}

function operandAccess(node, binding, context) {
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    context.sameRef(node.object, binding) &&
    numberValue(node.property) !== null
  )
}

function aliasCase(context, entry, canonical, methods, opcodes, layouts) {
  const opcode = numberValue(entry.test)
  const body =
    entry.consequent[0]?.type === 'BlockStatement'
      ? entry.consequent[0].body
      : null
  const unsorted = singleDeclaration(body?.[0])
  const ordered = singleDeclaration(body?.[1])
  const reads = unsorted?.init?.elements
  const permutation = ordered?.init?.elements
  if (
    !Number.isSafeInteger(opcode) ||
    body?.at(-1)?.type !== 'BreakStatement' ||
    body[0]?.kind !== 'let' ||
    body[1]?.kind !== 'let' ||
    unsorted?.init?.type !== 'ArrayExpression' ||
    ordered?.init?.type !== 'ArrayExpression' ||
    reads.length < 1 ||
    permutation.length !== reads.length ||
    !reads.every(
      (node) =>
        methodCall(node, methods.operand) &&
        normalizedArguments(node, layouts.get(methods.operand)).length === 0,
    )
  ) {
    decline('alias-runtime', `Alias case ${opcode} has no operand bridge`)
  }
  const unsortedBinding = context.bindingFor(unsorted.id)
  const orderedBinding = context.bindingFor(ordered.id)
  const canonicalToStored = permutation.map((node) => {
    if (!operandAccess(node, unsortedBinding, context)) {
      decline('alias-runtime', `Alias case ${opcode} permutation changed`)
    }
    return numberValue(node.property)
  })
  if (
    !unsortedBinding ||
    !orderedBinding ||
    new Set(canonicalToStored).size !== reads.length ||
    canonicalToStored.some((index) => index < 0 || index >= reads.length) ||
    referenceCount(context, unsortedBinding) !== reads.length ||
    referenceCount(context, orderedBinding) !== reads.length
  ) {
    decline('alias-runtime', `Alias case ${opcode} operands are ambiguous`)
  }
  const orderedUses = context
    .nodes(entry)
    .filter(
      ({ node }) =>
        node.type === 'Identifier' && context.isReference(node, orderedBinding),
    )
  if (
    orderedUses.some(
      ({ path }) =>
        !operandAccess(path.parentPath?.node, orderedBinding, context) ||
        path.parentPath.node.object !== path.node,
    )
  ) {
    decline('alias-runtime', `Alias case ${opcode} has an indirect operand use`)
  }
  const { nodes: cloned, origins } = cloneRuntimeFragment(
    caseBody(entry).slice(2),
  )
  normalizeFakeCalls(cloned, layouts)
  let consumed = 0
  const isCloneAccess = (node, index) =>
    node?.type === 'MemberExpression' &&
    node.computed &&
    node.object?.type === 'Identifier' &&
    context.sameRef(origins.get(node.object), orderedBinding) &&
    numberValue(node.property) === index
  traverse(t.blockStatement(cloned), {
    noScope: true,
    CallExpression(path) {
      if (!methodCall(path.node, methods.constant)) return
      if (
        path.node.arguments.length !== 2 ||
        !isCloneAccess(path.node.arguments[0], consumed) ||
        !isCloneAccess(path.node.arguments[1], consumed + 1)
      ) {
        decline('alias-runtime', `Alias case ${opcode} constant read changed`)
      }
      path.node.arguments = []
      consumed += 2
    },
    MemberExpression(path) {
      if (
        path.node.object?.type !== 'Identifier' ||
        !context.sameRef(origins.get(path.node.object), orderedBinding)
      ) {
        return
      }
      if (!isCloneAccess(path.node, consumed)) {
        decline('alias-runtime', `Alias case ${opcode} operand order changed`)
      }
      path.replaceWith(
        t.callExpression(
          t.memberExpression(t.thisExpression(), t.identifier(methods.operand)),
          [],
        ),
      )
      consumed += 1
    },
  })
  if (consumed !== reads.length) {
    decline('alias-runtime', `Alias case ${opcode} operand count changed`)
  }
  const signature = JSON.stringify(
    runtimeFragmentPattern(cloned, context, origins),
  )
  const matches = canonical.filter((candidate) => {
    const { nodes: body, origins: candidateOrigins } = cloneRuntimeFragment(
      caseBody(candidate.entry),
    )
    normalizeFakeCalls(body, layouts)
    return (
      JSON.stringify(
        runtimeFragmentPattern(body, context, candidateOrigins),
      ) === signature
    )
  })
  if (matches.length !== 1) {
    decline(
      'alias-runtime',
      `Alias case ${opcode} has no unique canonical body`,
    )
  }
  return {
    opcode,
    originalOpcode: opcodes[matches[0].name],
    originalName: matches[0].name,
    arity: reads.length,
    canonicalToStored,
  }
}

function recognize(
  ast,
  {
    antiObservation = null,
    specializedObservation = null,
    macroObservation = null,
  } = {},
) {
  const container = diagnoseContainer(ast)
  if (!container.ok)
    decline('alias-runtime-container', 'Numeric container is not admitted')
  const context = makeContext(ast)
  const declarations = topLevelDeclarations(context)
  const roles = container.result.roles
  const vm = declarations.filter(
    (item) =>
      item.kind === 'function' && item.name === roles.constructors.VM.name,
  )
  if (vm.length !== 1) decline('alias-runtime', 'VM constructor is not unique')
  const run = prototypeMethods(context, vm[0]).filter(
    (item) => item.name === roles.methods.vm.run.name,
  )
  if (run.length !== 1) decline('alias-runtime', 'VM run method is not unique')
  const switches = context
    .nodes(run[0].fn)
    .filter(({ node }) => node.type === 'SwitchStatement')
  if (switches.length !== 1)
    decline('alias-runtime', 'VM dispatch is not unique')
  const numericCanonical = roles.op.name === null
  const op = numericCanonical
    ? []
    : declarations.filter((item) => item.name === roles.op.name)
  if (!numericCanonical && op.length !== 1)
    decline('alias-runtime', 'Opcode map is not unique')
  const nameByOpcode = new Map(
    Object.entries(roles.op.values).map(([name, value]) => [value, name]),
  )
  const methods = {
    operand: roles.methods.vm.operand.name,
    constant: roles.methods.vm.constant.name,
  }
  const layouts = numericCanonical
    ? classCallLayouts(context, declarations, roles, methods)
    : new Map()
  const canonical = []
  const extra = []
  for (const entry of switches[0].node.cases.filter((item) => item.test)) {
    const test = entry.test
    const name = numericCanonical
      ? nameByOpcode.get(numberValue(test))
      : test.type === 'MemberExpression' &&
          !test.computed &&
          context.sameRef(test.object, op[0].binding)
        ? propertyName(test.property)
        : null
    if (name) {
      if (!Object.hasOwn(roles.op.values, name)) {
        decline('alias-runtime', 'Dispatch uses an unknown canonical opcode')
      }
      canonical.push({ name, entry })
    } else {
      extra.push(entry)
    }
  }
  if (
    canonical.length !== Object.keys(roles.op.values).length ||
    extra.length === 0
  ) {
    decline('alias-runtime', 'Canonical or alias cases are incomplete')
  }
  extra.sort((left, right) => numberValue(left.test) - numberValue(right.test))
  const antiPrefixCount = antiObservation?.syntheticCases.length ?? 0
  const specializedPrefixCount = specializedObservation?.specialized.length ?? 0
  const macroPrefixCount = macroObservation?.macros.length ?? 0
  const prefixCount =
    antiPrefixCount + specializedPrefixCount + macroPrefixCount
  for (const [index, entry] of extra.slice(0, prefixCount).entries()) {
    if (numberValue(entry.test) !== 61 + index) {
      decline('alias-runtime', 'Earlier opcode prefix is not contiguous')
    }
  }
  const aliases = extra
    .slice(prefixCount)
    .map((entry) =>
      aliasCase(context, entry, canonical, methods, roles.op.values, layouts),
    )
  if (
    aliases.length === 0 ||
    aliases.some((item, index) => item.opcode !== 61 + prefixCount + index) ||
    new Set(aliases.map((item) => item.opcode)).size !== aliases.length
  ) {
    decline('alias-runtime', 'Alias opcode range is not contiguous')
  }
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-aliased-runtime-observation.v1',
    antiPrefixCount,
    specializedPrefixCount,
    macroPrefixCount,
    aliases,
  })
}

export function diagnoseAliasedRuntime(input, options) {
  try {
    const ast = typeof input === 'string' ? parse(input, PARSER_OPTIONS) : input
    if (ast?.type !== 'File' && ast?.type !== 'Program') {
      decline('invalid-input', 'Expected source text or a Babel AST')
    }
    return deepFreeze({
      ok: true,
      result: recognize(ast, options),
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof ContainerDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'alias-runtime-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
