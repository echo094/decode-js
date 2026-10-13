import { parse } from '@babel/parser'
import {
  cloneRuntimeFragment,
  runtimeFragmentPattern,
} from './runtime-fragment-pattern.js'
import { diagnoseContainer } from './extract-container.js'
import { diagnoseAntiRuntime } from './analyze-anti-runtime.js'
import {
  classCallLayouts,
  normalizeFakeCalls,
} from './observe-aliased-runtime.js'
import {
  ContainerDecline,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
  makeContext,
  numberValue,
  propertyName,
  prototypeMethods,
  topLevelDeclarations,
} from './container-role-helpers.js'

const OMIT = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
])
const VARIABLE_WIDTH = new Set([
  'MAKE_CLOSURE',
  'BUILD_ARRAY',
  'BUILD_OBJECT',
  'CALL',
  'CALL_METHOD',
  'NEW',
])

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

function pattern(entry, layouts, context) {
  const { nodes, origins } = cloneRuntimeFragment(caseBody(entry))
  normalizeFakeCalls(nodes, layouts)
  return runtimeFragmentPattern(nodes, context, origins)
}

function methodCall(node, name, arity) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.object.type === 'ThisExpression' &&
    propertyName(node.callee.property) === name &&
    node.arguments.length === arity
  )
}

function match(expected, actual, values, methods) {
  if (methodCall(expected, methods.operand, 0)) {
    const value = numberValue(actual)
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      return false
    }
    values.push(value)
    return true
  }
  if (methodCall(expected, methods.constant, 0)) {
    if (!methodCall(actual, methods.constant, 2)) return false
    for (const operand of actual.arguments) {
      const value = numberValue(operand)
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        return false
      }
      values.push(value)
    }
    return true
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, index) =>
        match(item, actual[index], values, methods),
      )
    )
  }
  if (expected === null || typeof expected !== 'object') {
    return expected === actual
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
    return false
  }
  const keys = Object.keys(expected)
    .filter((key) => !OMIT.has(key))
    .sort()
  const actualKeys = Object.keys(actual)
    .filter((key) => !OMIT.has(key))
    .sort()
  return (
    keys.length === actualKeys.length &&
    keys.every(
      (key, index) =>
        key === actualKeys[index] &&
        match(expected[key], actual[key], values, methods),
    )
  )
}

function recognize(
  ast,
  { allowAntiPrefix = false, allowMacroTail = false } = {},
) {
  const container = diagnoseContainer(ast)
  if (!container.ok) {
    decline(
      'specialized-runtime-container',
      'Numeric container is not admitted',
    )
  }
  const context = makeContext(ast)
  const roles = container.result.roles
  const declarations = topLevelDeclarations(context)
  const vm = declarations.filter(
    (item) =>
      item.kind === 'function' && item.name === roles.constructors.VM.name,
  )
  if (vm.length !== 1) {
    decline('specialized-runtime', 'VM constructor is not unique')
  }
  const run = prototypeMethods(context, vm[0]).filter(
    (item) => item.name === roles.methods.vm.run.name,
  )
  if (run.length !== 1) {
    decline('specialized-runtime', 'VM run method is not unique')
  }
  const switches = context
    .nodes(run[0].fn)
    .filter(({ node }) => node.type === 'SwitchStatement')
  if (switches.length !== 1) {
    decline('specialized-runtime', 'VM dispatch is not unique')
  }
  const numericCanonical = roles.op.name === null
  const op = numericCanonical
    ? []
    : declarations.filter((item) => item.name === roles.op.name)
  if (!numericCanonical && op.length !== 1)
    decline('specialized-runtime', 'Opcode map is not unique')
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
    const name = numericCanonical
      ? nameByOpcode.get(numberValue(entry.test))
      : entry.test.type === 'MemberExpression' &&
          !entry.test.computed &&
          context.sameRef(entry.test.object, op[0].binding)
        ? propertyName(entry.test.property)
        : null
    if (name) {
      if (!Object.hasOwn(roles.op.values, name)) {
        decline('specialized-runtime', 'Unknown canonical dispatch label')
      }
      const body = pattern(entry, layouts, context)
      canonical.push({
        name,
        opcode: roles.op.values[name],
        body,
      })
    } else {
      extra.push(entry)
    }
  }
  if (
    canonical.length !== Object.keys(roles.op.values).length ||
    extra.length === 0
  ) {
    decline(
      'specialized-runtime',
      'Canonical or specialized cases are incomplete',
    )
  }
  extra.sort((left, right) => numberValue(left.test) - numberValue(right.test))
  let antiPrefixCount = 0
  if (allowAntiPrefix) {
    const anti = diagnoseAntiRuntime(ast, { allowSpecializedTail: true })
    if (!anti.ok) {
      decline('specialized-runtime', 'Anti opcode prefix is not proved')
    }
    antiPrefixCount = anti.result.syntheticCases.length
    for (const [index, entry] of extra.slice(0, antiPrefixCount).entries()) {
      if (numberValue(entry.test) !== 61 + index) {
        decline('specialized-runtime', 'Anti opcode prefix is not contiguous')
      }
    }
  }
  if (extra.length <= antiPrefixCount) {
    decline('specialized-runtime', 'No specialized opcode cases remain')
  }
  const specialized = []
  for (const [index, entry] of extra.slice(antiPrefixCount).entries()) {
    const opcode = numberValue(entry.test)
    if (
      opcode !== 61 + antiPrefixCount + index ||
      entry.consequent.length !== 1 ||
      entry.consequent[0].type !== 'BlockStatement' ||
      entry.consequent[0].body.at(-1)?.type !== 'BreakStatement'
    ) {
      if (allowMacroTail) break
      decline(
        'specialized-runtime',
        'Specialized opcode range or case form changed',
      )
    }
    const body = pattern(entry, layouts, context)
    const matches = canonical.flatMap((candidate) => {
      if (VARIABLE_WIDTH.has(candidate.name)) return []
      const operands = []
      if (!match(candidate.body, body, operands, methods)) return []
      return [
        {
          originalName: candidate.name,
          originalOpcode: candidate.opcode,
          operands,
        },
      ]
    })
    if (matches.length !== 1 || matches[0].operands.length < 1) {
      if (allowMacroTail) break
      decline(
        'specialized-runtime',
        `Specialized case ${opcode} has no unique original handler`,
      )
    }
    specialized.push({ opcode, ...matches[0] })
  }
  if (specialized.length === 0)
    decline('specialized-runtime', 'No specialized opcode cases remain')
  if (!allowMacroTail && specialized.length !== extra.length - antiPrefixCount)
    decline('specialized-runtime', 'Unproved extra opcode cases remain')
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-specialized-runtime-observation.v1',
    antiPrefixCount,
    specialized,
  })
}

export function diagnoseSpecializedRuntime(input, options) {
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
        code: 'specialized-runtime-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
