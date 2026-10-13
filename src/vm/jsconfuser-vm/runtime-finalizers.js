import { parse } from '@babel/parser'
import { CLASS_RUNTIME_SOURCE } from './class-runtime-source.js'
import {
  isControlBodyKey,
  simpleControlBody,
} from '../../visitor/jsconfuser-vm/normalize-source.js'
import {
  PARSER_OPTIONS,
  decline,
  makeContext,
  propertyName,
} from './container-role-helpers.js'

const template = makeContext(parse(CLASS_RUNTIME_SOURCE, PARSER_OPTIONS))
const method = (name) =>
  template
    .nodes(template.program)
    .find(
      ({ node }) =>
        node.type === 'AssignmentExpression' &&
        node.left?.type === 'MemberExpression' &&
        propertyName(node.left.property) === name &&
        node.right?.type === 'FunctionExpression',
    )?.node.right
const ignored = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

// Prove the dispatch shell and actual frame/capture finalizers. Handler bodies
// other than RETURN belong to their individual semantic observers.
export function verifyRuntimeFinalizers(context, roles, scalars) {
  const expectedRun = method('run')
  const actualRun = roles.vmMethods.run[0].fn
  const expectedDispatch = template
    .nodes(expectedRun)
    .find(({ node }) => node.type === 'SwitchStatement').node
  const actualDispatch = context
    .nodes(actualRun)
    .find(({ node }) => node.type === 'SwitchStatement').node
  const bindings = new Map()
  const reverse = new Map()
  const symbols = {
    OP: roles.op.binding,
    SLOTS: roles.slots.binding,
    TIMING_CHECKS: scalars.timing.binding,
  }
  const names = Object.fromEntries(
    Object.entries(roles.vmMethods).map(([role, list]) => [
      {
        operand: '_operand',
        pushFrame: '_pushFrame',
        closeUpvalues: '_closeUpvaluesFor',
        constant: '_constant',
        captureUpvalue: 'captureUpvalue',
        run: 'run',
      }[role],
      list[0].name,
    ]),
  )
  names._close = roles.upvalueMethods.close[0].name
  let code = 'runtime-dispatch-shell'
  const fail = (detail) =>
    decline(code, `Connected runtime finalizer contract changed: ${detail}`)
  for (const method of [
    ...Object.values(roles.vmMethods),
    ...Object.values(roles.upvalueMethods),
  ])
    if (method[0].node.expression.operator !== '=')
      fail('method installation operator')
  const compare = (expected, actual, controlBody = false) => {
    if (controlBody) {
      expected = simpleControlBody(expected)
      actual = simpleControlBody(actual)
    }
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || expected.length !== actual.length)
        fail('statement count')
      expected.forEach((part, index) => compare(part, actual[index]))
      return
    }
    if (!expected || typeof expected !== 'object') {
      if (expected !== actual && !(expected === null && actual === undefined))
        fail('operation or literal')
      return
    }
    if (!actual || expected.type !== actual.type) fail('node shape')
    if (expected.type === 'Identifier') {
      const path = template.paths.get(expected)
      if (path?.isBindingIdentifier() || path?.isReferencedIdentifier()) {
        const left = template.bindingFor(expected)
        const right = context.bindingFor(actual)
        if (!left && Object.hasOwn(symbols, expected.name)) {
          if (right !== symbols[expected.name])
            fail('captured scalar/map identity')
          return
        }
        if (left) {
          if (
            !right ||
            (bindings.has(left) && bindings.get(left) !== right) ||
            (reverse.has(right) && reverse.get(right) !== left)
          )
            fail('local/captured binding identity')
          bindings.set(left, right)
          reverse.set(right, left)
          return
        }
        if (right) fail('shadowed host global')
      }
      const wanted =
        path?.parentPath.isMemberExpression() &&
        !path.parentPath.node.computed &&
        path.key === 'property'
          ? (names[expected.name] ?? expected.name)
          : expected.name
      if (actual.name !== wanted) fail('host/property name')
      return
    }
    if (expected === expectedDispatch) {
      compare(expected.discriminant, actual.discriminant)
      return
    }
    for (const key of Object.keys(expected))
      if (!ignored.has(key))
        compare(
          expected[key],
          actual[key],
          isControlBodyKey(expected.type, key),
        )
  }
  compare(expectedRun, actualRun)
  code = 'runtime-return-finalizer'
  const returns = actualDispatch.cases.filter(
    (entry) =>
      entry.test?.type === 'MemberExpression' &&
      context.sameRef(entry.test.object, roles.op.binding) &&
      propertyName(entry.test.property) === 'RETURN',
  )
  if (returns.length !== 1) fail('RETURN case ownership')
  const expectedReturn = expectedDispatch.cases.find(
    (entry) => propertyName(entry.test?.property) === 'RETURN',
  )
  compare(expectedReturn, returns[0])
  code = 'runtime-capture-finalizer'
  compare(method('_closeUpvaluesFor'), roles.vmMethods.closeUpvalues[0].fn)
  compare(method('_close'), roles.upvalueMethods.close[0].fn)
  const timing = scalarTimingValue(scalars.timing.init)
  if (timing !== false && timing !== 0 && !Number.isFinite(timing))
    decline(
      'runtime-timing-mode',
      'Timing value is outside the proved false/zero/finite numeric source domain',
    )
  if (timing !== false && timing !== 0)
    decline(
      'runtime-active-timing',
      'Active timing poisoning cannot be erased under slow or paused execution',
    )
}

export function scalarTimingValue(node) {
  if (node?.type === 'BooleanLiteral' || node?.type === 'NumericLiteral')
    return node.value
  if (
    node?.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument?.type === 'NumericLiteral'
  )
    return -node.argument.value
  return undefined
}
