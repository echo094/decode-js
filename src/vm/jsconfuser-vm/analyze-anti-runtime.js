import { parse } from '@babel/parser'
import { diagnoseContainer } from './extract-container.js'
import {
  classCallLayouts,
  normalizedArguments,
} from './observe-aliased-runtime.js'
import {
  canonicalStepTemplates,
  orderedOperandAccesses,
  segmentSyntheticSteps,
} from './anti-runtime-step-templates.js'
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

function singleDeclaration(statement) {
  return statement?.type === 'VariableDeclaration' &&
    statement.declarations.length === 1
    ? statement.declarations[0]
    : null
}

function operandCall(node, name, layouts) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.object?.type === 'ThisExpression' &&
    propertyName(node.callee.property) === name &&
    normalizedArguments(node, layouts.get(name)).length === 0
  )
}

function syntheticCase(context, entry, methods, templates, layouts) {
  const opcode = numberValue(entry.test)
  const body =
    entry.consequent.length === 1 &&
    entry.consequent[0].type === 'BlockStatement'
      ? entry.consequent[0].body
      : null
  const unsorted = singleDeclaration(body?.[0])
  const canonical = singleDeclaration(body?.[1])
  const reads = unsorted?.init?.elements
  const permutation = canonical?.init?.elements
  if (
    !Number.isSafeInteger(opcode) ||
    !unsorted ||
    !canonical ||
    body[0].kind !== 'let' ||
    body[1].kind !== 'let' ||
    unsorted.init?.type !== 'ArrayExpression' ||
    canonical.init?.type !== 'ArrayExpression' ||
    reads.length < 2 ||
    permutation.length !== reads.length ||
    !reads.every((node) => operandCall(node, methods.operand, layouts)) ||
    body.at(-1)?.type !== 'BreakStatement'
  ) {
    decline('anti-runtime', `Synthetic case ${opcode} has no operand bridge`)
  }
  const unsortedBinding = context.bindingFor(unsorted.id)
  const canonicalBinding = context.bindingFor(canonical.id)
  const canonicalToStored = permutation.map((node) => {
    if (
      node?.type !== 'MemberExpression' ||
      !node.computed ||
      !context.sameRef(node.object, unsortedBinding)
    ) {
      decline('anti-runtime', `Synthetic case ${opcode} permutation changed`)
    }
    return numberValue(node.property)
  })
  if (
    !unsortedBinding ||
    !canonicalBinding ||
    canonicalToStored.some(
      (index) =>
        !Number.isSafeInteger(index) || index < 0 || index >= reads.length,
    ) ||
    new Set(canonicalToStored).size !== reads.length ||
    referenceCount(context, unsortedBinding) !== reads.length ||
    referenceCount(context, canonicalBinding) !== reads.length
  ) {
    decline('anti-runtime', `Synthetic case ${opcode} operands are ambiguous`)
  }
  const accesses = orderedOperandAccesses(
    context,
    entry,
    canonicalBinding,
    methods,
    layouts,
  )
  if (
    accesses.length !== reads.length ||
    accesses.some((index, position) => index !== position) ||
    context
      .nodes(entry)
      .filter(({ node }) => operandCall(node, methods.operand, layouts))
      .length !== reads.length
  ) {
    decline('anti-runtime', `Synthetic case ${opcode} step reads changed`)
  }
  const steps = segmentSyntheticSteps(
    context,
    entry,
    canonicalBinding,
    methods,
    templates,
    layouts,
  )
  if (
    steps.length < 3 ||
    steps.reduce((total, step) => total + step.operandCount, 0) !== reads.length
  ) {
    decline('anti-runtime-steps', `Synthetic case ${opcode} step width changed`)
  }
  return { opcode, arity: reads.length, canonicalToStored, steps }
}

function recognize(ast, { allowSpecializedTail = false } = {}) {
  const container = diagnoseContainer(ast)
  if (!container.ok) {
    decline('anti-runtime-container', 'Numeric container is not admitted')
  }
  const context = makeContext(ast)
  const vmName = container.result.roles.constructors.VM.name
  const runName = container.result.roles.methods.vm.run.name
  const methods = {
    operand: container.result.roles.methods.vm.operand.name,
    constant: container.result.roles.methods.vm.constant.name,
  }
  const vm = topLevelDeclarations(context).filter(
    (declaration) =>
      declaration.name === vmName &&
      declaration.binding.path.isFunctionDeclaration(),
  )
  if (vm.length !== 1) {
    decline('anti-runtime', 'VM constructor is not unique')
  }
  const run = prototypeMethods(context, vm[0]).filter(
    (method) => method.name === runName,
  )
  if (run.length !== 1) {
    decline('anti-runtime', 'VM run method is not unique')
  }
  const switches = context
    .nodes(run[0].fn)
    .filter(({ node }) => node.type === 'SwitchStatement')
  if (switches.length !== 1) {
    decline('anti-runtime', 'Numeric dispatch is not unique')
  }
  const roles = container.result.roles
  const numericCanonical = roles.op.name === null
  const op = numericCanonical
    ? []
    : topLevelDeclarations(context).filter(
        (declaration) => declaration.name === roles.op.name,
      )
  if (!numericCanonical && op.length !== 1) {
    decline('anti-runtime', 'Opcode map binding is not unique')
  }
  const declarations = topLevelDeclarations(context)
  const layouts = numericCanonical
    ? classCallLayouts(context, declarations, roles, methods)
    : new Map()
  const known = new Set(Object.values(roles.op.values))
  const nameByOpcode = new Map(
    Object.entries(roles.op.values).map(([name, value]) => [value, name]),
  )
  const isCanonical = (entry) =>
    numericCanonical
      ? nameByOpcode.has(numberValue(entry.test))
      : entry.test?.type === 'MemberExpression' &&
        !entry.test.computed &&
        context.sameRef(entry.test.object, op[0].binding) &&
        Object.prototype.hasOwnProperty.call(
          roles.op.values,
          propertyName(entry.test.property),
        )
  const nonDefault = switches[0].node.cases.filter(
    (entry) => entry.test !== null,
  )
  const canonical = nonDefault.filter(isCanonical)
  if (canonical.length !== known.size) {
    decline('anti-runtime', 'Canonical opcode cases are incomplete')
  }
  const extra = nonDefault
    .filter((entry) => !isCanonical(entry))
    .sort((left, right) => numberValue(left.test) - numberValue(right.test))
  if (extra.length === 0) {
    decline('anti-runtime', 'No synthetic opcode cases were emitted')
  }
  const templates = canonicalStepTemplates(
    context,
    canonical,
    methods,
    nameByOpcode,
    layouts,
  )
  const cases = []
  for (const entry of extra) {
    try {
      cases.push(syntheticCase(context, entry, methods, templates, layouts))
    } catch (error) {
      if (!allowSpecializedTail || !(error instanceof ContainerDecline))
        throw error
      break
    }
  }
  if (cases.length === 0) {
    decline('anti-runtime', 'No synthetic opcode prefix was emitted')
  }
  if (!allowSpecializedTail && cases.length !== extra.length) {
    decline('anti-runtime', 'Unproved extra opcode cases remain')
  }
  const opcodes = cases.map(({ opcode }) => opcode)
  if (
    new Set(opcodes).size !== cases.length ||
    opcodes.some((opcode, index) => opcode !== Math.max(...known) + index + 1)
  ) {
    decline('anti-runtime', 'Synthetic opcode set is not contiguous')
  }
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-anti-runtime-observation.v1',
    syntheticCases: cases,
  })
}

export function diagnoseAntiRuntime(input, options) {
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
        code: 'anti-runtime-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
