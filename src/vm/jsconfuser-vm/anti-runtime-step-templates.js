import { runtimeFragmentPattern } from './runtime-fragment-pattern.js'
import { decline, numberValue, propertyName } from './container-role-helpers.js'
import { normalizedArguments } from './observe-aliased-runtime.js'

const IGNORED_FIELDS = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'leadingComments',
  'innerComments',
  'trailingComments',
])

function thisCall(node, method) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.object?.type === 'ThisExpression' &&
    propertyName(node.callee.property) === method
  )
}

function project(node, context, operands, methods, layouts, origins) {
  if (Array.isArray(node)) {
    return node.map((item) =>
      project(item, context, operands, methods, layouts, origins),
    )
  }
  if (!node || typeof node !== 'object') return node
  if (thisCall(node, methods.operand)) {
    if (normalizedArguments(node, layouts.get(methods.operand)).length !== 0) {
      decline('anti-runtime-steps', 'Operand call arguments changed')
    }
    return { type: 'OperandRead' }
  }
  if (thisCall(node, methods.constant)) {
    const args = normalizedArguments(node, layouts.get(methods.constant))
    if (
      args.length !== 0 &&
      (args.length !== 2 ||
        !args.every(
          (argument) =>
            argument.type === 'MemberExpression' &&
            argument.computed &&
            context.sameRef(argument.object, operands),
        ))
    ) {
      decline('anti-runtime-steps', 'Constant operand bridge changed')
    }
    return { type: 'ConstantRead' }
  }
  if (
    node.type === 'MemberExpression' &&
    node.computed &&
    context.sameRef(node.object, operands)
  ) {
    return { type: 'OperandRead' }
  }
  const result = Object.fromEntries(
    Object.keys(node)
      .filter((key) => !IGNORED_FIELDS.has(key))
      .sort()
      .map((key) => [
        key,
        project(node[key], context, operands, methods, layouts, origins),
      ]),
  )
  origins.set(result, node)
  return result
}

function statements(entry) {
  const raw =
    entry.consequent.length === 1 &&
    entry.consequent[0].type === 'BlockStatement'
      ? entry.consequent[0].body
      : entry.consequent
  return raw.filter(
    (statement) =>
      statement.type !== 'BreakStatement' &&
      statement.type !== 'EmptyStatement',
  )
}

export function orderedOperandAccesses(
  context,
  node,
  operands,
  methods,
  layouts,
) {
  const accesses = []
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object' || !value.type) return
    if (thisCall(value, methods.constant)) {
      normalizedArguments(value, layouts.get(methods.constant)).forEach(visit)
      return
    }
    if (
      value.type === 'MemberExpression' &&
      value.computed &&
      context.sameRef(value.object, operands)
    ) {
      accesses.push(numberValue(value.property))
      return
    }
    Object.keys(value)
      .filter((key) => !IGNORED_FIELDS.has(key))
      .forEach((key) => visit(value[key]))
  }
  visit(node)
  return accesses
}

function pattern(body, context, operands, methods, layouts) {
  const origins = new WeakMap()
  const projected = project(body, context, operands, methods, layouts, origins)
  return JSON.stringify(runtimeFragmentPattern(projected, context, origins))
}

export function canonicalStepTemplates(
  context,
  entries,
  methods,
  nameByOpcode,
  layouts,
) {
  return entries.map((entry) => ({
    name:
      entry.test.type === 'NumericLiteral'
        ? nameByOpcode.get(entry.test.value)
        : propertyName(entry.test.property),
    body: statements(entry),
    pattern: pattern(statements(entry), context, null, methods, layouts),
  }))
}

export function segmentSyntheticSteps(
  context,
  entry,
  operands,
  methods,
  templates,
  layouts,
) {
  const body = entry.consequent[0].body.slice(2, -1)
  const steps = []
  let position = 0
  let operandStart = 0
  while (position < body.length) {
    const matches = templates.filter(
      (template) =>
        template.body.length > 0 &&
        template.pattern ===
          pattern(
            body.slice(position, position + template.body.length),
            context,
            operands,
            methods,
            layouts,
          ),
    )
    if (matches.length !== 1) {
      decline('anti-runtime-steps', 'Synthetic step template is ambiguous')
    }
    const match = matches[0]
    const stepBody = body.slice(position, position + match.body.length)
    const accesses = orderedOperandAccesses(
      context,
      stepBody,
      operands,
      methods,
      layouts,
    )
    if (
      accesses.length === 0 ||
      accesses.some((index, offset) => index !== operandStart + offset)
    ) {
      decline('anti-runtime-steps', 'Synthetic step operand span changed')
    }
    steps.push({
      name: match.name,
      operandStart,
      operandCount: accesses.length,
    })
    operandStart += accesses.length
    position += match.body.length
  }
  return steps
}
