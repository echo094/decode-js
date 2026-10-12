import * as t from '@babel/types'
import {
  classTemplate as template,
  layoutRoles,
} from './class-runtime-layout-template.js'
import {
  decline,
  numberValue,
  propertyName,
  prototypeMethods,
} from './container-role-helpers.js'

const OMIT = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
])
const RESERVED = new Set([
  'prototype',
  'constructor',
  'length',
  'name',
  'call',
  'apply',
  'bind',
  'toString',
  'valueOf',
  'then',
  'catch',
  'finally',
  'value',
  'get',
  'set',
  'writable',
  'enumerable',
  'configurable',
])
const properties = new Set()
for (const { node } of template.nodes(template.program)) {
  if (node.type === 'ObjectProperty' && !node.computed)
    properties.add(propertyName(node.key))
  if (
    node.type === 'AssignmentExpression' &&
    node.left?.type === 'MemberExpression' &&
    !node.left.computed &&
    node.left.object.type === 'ThisExpression'
  )
    properties.add(propertyName(node.left.property))
}
const constructors = template.program.body.filter(
  (node) =>
    node.type === 'FunctionDeclaration' &&
    template
      .nodes(node)
      .some(
        ({ node: child }) =>
          child.type === 'AssignmentExpression' &&
          child.left?.object?.type === 'ThisExpression',
      ),
)
const templateMethods = constructors.flatMap((fn) =>
  prototypeMethods(template, { binding: template.bindingFor(fn.id) }),
)
for (const method of templateMethods) properties.add(method.name)
for (const name of RESERVED) properties.delete(name)

function parameterExpression(node, parameters, context) {
  if (node?.type === 'Identifier')
    return parameters.has(context.bindingFor(node))
  if (node?.type === 'ArrayExpression')
    return (
      node.elements.length > 0 &&
      node.elements.every((item) =>
        parameterExpression(item, parameters, context),
      )
    )
  return (
    node?.type === 'LogicalExpression' &&
    ['&&', '||'].includes(node.operator) &&
    parameterExpression(node.left, parameters, context) &&
    parameterExpression(node.right, parameters, context)
  )
}

function dummy(node, context) {
  return (
    ['NullLiteral', 'NumericLiteral', 'StringLiteral'].includes(node?.type) ||
    (node?.type === 'Identifier' &&
      node.name === 'undefined' &&
      !context.bindingFor(node)) ||
    (node?.type === 'ArrayExpression' && node.elements.length === 0) ||
    (node?.type === 'ObjectExpression' && node.properties.length === 0)
  )
}

function fakeLayout(fn, context) {
  const parameters = new Set(fn.params.map((node) => context.bindingFor(node)))
  const removed = new Set()
  const fakeBindings = new Set()
  for (const statement of fn.body.body) {
    const write =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    if (
      write?.type !== 'AssignmentExpression' ||
      write.operator !== '=' ||
      write.left?.type !== 'MemberExpression' ||
      write.left.computed ||
      write.left.object.type !== 'ThisExpression' ||
      !parameterExpression(write.right, parameters, context)
    )
      continue
    const field = propertyName(write.left.property)
    if (RESERVED.has(field) || field === '__proto__') continue
    const uses = context
      .nodes(context.program)
      .filter(
        ({ node }) =>
          (node.type === 'MemberExpression' &&
            (!node.computed || node.property.type === 'StringLiteral') &&
            propertyName(node.property) === field) ||
          (node.type === 'ObjectProperty' && propertyName(node.key) === field),
      )
    if (uses.length !== 1 || uses[0].node !== write.left) continue
    removed.add(statement)
    for (const { node } of context.nodes(write.right)) {
      if (node.type === 'Identifier') fakeBindings.add(context.bindingFor(node))
    }
  }
  for (const binding of fakeBindings) {
    if (
      !binding ||
      context
        .nodes(fn)
        .some(
          ({ node, path }) =>
            context.isReference(node, binding) &&
            !path.findParent((parent) => removed.has(parent.node)),
        )
    )
      decline(
        'class-runtime-methods',
        'Fake parameter escapes its isolated stash',
      )
  }
  return { removed, fakeBindings }
}

// Match the entire retained runtime with one bijection for fields and captured
// bindings. Case-local bindings may be split by handler-table materialization;
// captures (registers, frame, base and helpers) retain their outer identities.
export function verifyClassRuntimeContract(
  context,
  vmBinding,
  root,
  methods,
  fields,
  slots,
  bridge,
  payload,
  frame,
  randomized = false,
) {
  const bindings = new Map()
  const reverseBindings = new Map()
  const members = new Map()
  const reverseMembers = new Map()
  const pairs = []
  const byTemplateFunction = new Map()
  let phase = 1
  let code = 'class-runtime-methods'
  let role = 'runtime'
  const keyTrail = []
  const literalValues = new Map()
  const layout = new Map()
  const mismatch = (detail) =>
    decline(
      code,
      `${role}: complete semantic contract changed (${detail}; ${keyTrail.join('.')})`,
    )
  const bind = (
    expected,
    actual,
    map = bindings,
    reverse = reverseBindings,
  ) => {
    if (!expected || !actual) mismatch('binding provenance')
    if (
      (map.has(expected) && map.get(expected) !== actual) ||
      (reverse.has(actual) && reverse.get(actual) !== expected)
    )
      mismatch('binding identity')
    map.set(expected, actual)
    reverse.set(actual, expected)
  }
  const member = (expected, actual) => {
    if (
      typeof actual !== 'string' ||
      RESERVED.has(actual) ||
      (members.has(expected) && members.get(expected) !== actual) ||
      (reverseMembers.has(actual) && reverseMembers.get(actual) !== expected)
    )
      mismatch('field identity')
    members.set(expected, actual)
    reverseMembers.set(actual, expected)
  }
  const templateCtor = (name) => constructors.find((fn) => fn.id.name === name)
  const inputCtor = (binding) => binding.path.node
  const add = (expected, actual) => {
    const pair = { expected, actual, ...fakeLayout(actual, context) }
    pairs.push(pair)
    byTemplateFunction.set(expected, pair)
    if (expected.id)
      bind(template.bindingFor(expected.id), context.bindingFor(actual.id))
    return pair
  }
  add(templateCtor('VM'), inputCtor(vmBinding))
  const closureBinding = context.bindingFor(root.closure.callee)
  add(templateCtor('Closure'), inputCtor(closureBinding))
  const capture = prototypeMethods(context, { binding: vmBinding }).find(
    ({ name }) => name === methods.vm.captureUpvalue,
  )
  const captures = context
    .nodes(capture.fn)
    .filter(
      ({ node }) =>
        node.type === 'NewExpression' &&
        context.bindingFor(node.callee)?.path.isFunctionDeclaration(),
    )
  if (captures.length !== 1) mismatch('upvalue constructor capture')
  const upvalue = context.bindingFor(captures[0].node.callee).path.node
  add(templateCtor('Upvalue'), upvalue)
  const owners = new Map([
    [template.bindingFor(templateCtor('VM').id), vmBinding],
    [template.bindingFor(templateCtor('Closure').id), closureBinding],
    [
      template.bindingFor(templateCtor('Upvalue').id),
      context.bindingFor(upvalue.id),
    ],
  ])
  const names = {
    run: methods.vm.run,
    _pushFrame: methods.vm.pushFrame,
    _operand: methods.vm.operand,
    _constant: methods.vm.constant,
    captureUpvalue: methods.vm.captureUpvalue,
    _closeUpvaluesFor: methods.vm.closeUpvalues,
    _read: methods.upvalue.read,
    _write: methods.upvalue.write,
    _close: methods.upvalue.close,
    bytecode: fields.words,
    constants: fields.pool,
    globals: fields.globals,
    _regs: slots.fields.regs,
    _f: slots.fields.frame,
    _regsTop: slots.fields.nextFrame,
    ...Object.fromEntries(
      Object.entries(methods.upvalue.fields).map(([name, value]) => [
        {
          closed: '_closed',
          value: '_value',
          regs: '_regs',
          absSlot: '_absSlot',
        }[name],
        value,
      ]),
    ),
  }
  for (const [name, actual] of Object.entries(names)) member(name, actual)
  for (const expected of templateMethods) {
    const owner = template.bindingFor(
      template.paths.get(expected.fn).parentPath.node.left.object.object,
    )
    const actual = prototypeMethods(context, {
      binding: owners.get(owner),
    }).find(({ name }) => name === names[expected.name])
    if (!actual) mismatch('method role')
    const pair = add(expected.fn, actual.fn)
    pair.expectedRoot = expected.node
    pair.actualRoot = actual.node
  }

  const functionTarget = (call) => {
    if (call.callee.type === 'Identifier') {
      const binding = template.bindingFor(call.callee)
      return binding?.path.isFunctionDeclaration() &&
        byTemplateFunction.has(binding.path.node)
        ? binding.path.node
        : null
    }
    if (call.callee.type === 'MemberExpression' && !call.callee.computed)
      return (
        templateMethods.find(
          ({ name }) => name === propertyName(call.callee.property),
        )?.fn ?? null
      )
    return null
  }
  const compare = (
    expected,
    actual,
    map = bindings,
    reverse = reverseBindings,
  ) => {
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || expected.length !== actual.length)
        mismatch(
          `statement/operand count ${expected.length}/${actual?.length}: ${expected[0]?.type}/${actual?.[0]?.type}`,
        )
      expected.forEach((node, index) =>
        compare(node, actual[index], map, reverse),
      )
      return
    }
    if (!expected || typeof expected !== 'object') {
      if (expected === null && actual === undefined) return
      if (expected !== actual)
        mismatch(`operation or literal ${expected}/${actual}`)
      return
    }
    const layoutRole = randomized && layoutRoles.get(expected)
    if (layoutRole) {
      const value = numberValue(actual)
      const absent =
        actual?.type === 'UnaryExpression' &&
        actual.operator === 'void' &&
        numberValue(actual.argument) === 0
      if (value === null && !(layoutRole.startsWith('SLOTS.NOISE_') && absent))
        mismatch(`layout ${layoutRole} is not an inlined value`)
      if (layout.has(layoutRole) && layout.get(layoutRole) !== value)
        mismatch(`layout ${layoutRole} changed between uses`)
      layout.set(layoutRole, value)
      return
    }
    if (!actual || typeof actual !== 'object' || expected.type !== actual.type)
      mismatch('node shape')
    if (literalValues.has(expected)) {
      if (actual.value !== literalValues.get(expected))
        mismatch('root register count')
      return
    }
    if (expected.type === 'Identifier') {
      const path = template.paths.get(expected)
      const binding =
        path && (path.isBindingIdentifier() || path.isReferencedIdentifier())
          ? template.bindingFor(expected)
          : null
      if (binding) bind(binding, context.bindingFor(actual), map, reverse)
      else if (
        expected.name !== actual.name ||
        (path?.isReferencedIdentifier() && context.bindingFor(actual))
      )
        mismatch('global or property name')
      return
    }
    if (expected.type === 'SwitchCase') {
      if (!randomized) compare(expected.test, actual.test, map, reverse)
      const body = (entry) =>
        entry.consequent.length === 1 &&
        entry.consequent[0].type === 'BlockStatement'
          ? entry.consequent[0].body
          : entry.consequent
      const left = body(expected)
      const right = body(actual)
      const leftBreak = left.at(-1)?.type === 'BreakStatement'
      const rightBreak = right.at(-1)?.type === 'BreakStatement'
      if (leftBreak && !rightBreak) mismatch('case fallthrough')
      compare(
        leftBreak ? left.slice(0, -1) : left,
        rightBreak ? right.slice(0, -1) : right,
        map,
        reverse,
      )
      return
    }
    if (expected.type === 'SwitchStatement') {
      compare(expected.discriminant, actual.discriminant, map, reverse)
      for (const entry of expected.cases) {
        let candidate
        if (!randomized) {
          candidate = actual.cases.find(
            (item) => numberValue(item.test) === numberValue(entry.test),
          )
          if (!candidate) mismatch('canonical case')
        }
        const caseBindings = new Set(
          template
            .nodes(entry)
            .flatMap(({ node, path }) =>
              node.type === 'Identifier' &&
              path.isBindingIdentifier() &&
              !path.isReferencedIdentifier()
                ? [template.bindingFor(node)]
                : [],
            ),
        )
        const localMap = new Map(map)
        const localReverse = new Map(reverse)
        for (const { node } of template.nodes(entry)) {
          if (node.type === 'VariableDeclarator') {
            const binding = template.bindingFor(node.id)
            if (localMap.has(binding))
              localReverse.delete(localMap.get(binding))
            localMap.delete(binding)
          }
        }
        const oldRole = role
        const oldCode = code
        role = `Opcode ${numberValue(entry.test) ?? 'default'}`
        code = randomized ? 'randomized-class-case' : 'class-runtime-opcodes'
        if (randomized) {
          // Trial full semantic bodies under existing captured bindings/fields.
          // Restore all trial state: failed candidates cannot teach the matcher.
          const matches = []
          const trailLength = keyTrail.length
          const saved = [members, reverseMembers, layout].map((m) => new Map(m))
          const restore = () => {
            keyTrail.length = trailLength
            role = `Opcode ${numberValue(entry.test) ?? 'default'}`
            code = 'randomized-class-case'
            ;[members, reverseMembers, layout].forEach((m, i) => {
              m.clear()
              for (const [key, value] of saved[i]) m.set(key, value)
            })
          }
          for (const item of actual.cases) {
            if ((entry.test === null) !== (item.test === null)) continue
            restore()
            try {
              compare(entry, item, new Map(localMap), new Map(localReverse))
              matches.push(item)
            } catch (error) {
              if (!error.code) throw error
            }
          }
          restore()
          if (matches.length !== 1)
            mismatch('semantic case is missing or ambiguous')
          candidate = matches[0]
          compare(entry, candidate, localMap, localReverse)
          if (entry.test !== null)
            compare(entry.test, candidate.test, map, reverse)
        } else if (!(
          entry.test === null &&
          candidate.consequent.length === 1 &&
          candidate.consequent[0].type === 'BreakStatement'
        ))
          compare(entry, candidate, localMap, localReverse)
        for (const [expectedBinding, actualBinding] of localMap) {
          if (!caseBindings.has(expectedBinding))
            bind(expectedBinding, actualBinding, map, reverse)
        }
        role = oldRole
        code = oldCode
      }
      return
    }
    const target = ['CallExpression', 'NewExpression'].includes(expected.type)
      ? functionTarget(expected)
      : null
    let argumentsList = actual.arguments
    if (target && phase === 2) {
      const pair = byTemplateFunction.get(target)
      if (expected.arguments.length === 0 && target.params.length !== 0) {
        if (actual.arguments.length !== 0) mismatch('defaulted call arity')
      } else {
        if (actual.arguments.length !== pair.actual.params.length)
          mismatch('call arity')
        for (const [index, parameter] of pair.actual.params.entries()) {
          if (
            pair.fakeBindings.has(context.bindingFor(parameter)) &&
            !dummy(actual.arguments[index], context)
          )
            mismatch('fake argument side effect')
        }
        argumentsList = target.params.map((parameter) => {
          const wanted = bindings.get(template.bindingFor(parameter))
          const index = pair.actual.params.findIndex(
            (node) => context.bindingFor(node) === wanted,
          )
          if (index < 0) mismatch('parameter provenance')
          return actual.arguments[index]
        })
      }
    }
    for (const key of Object.keys(expected).filter((key) => !OMIT.has(key))) {
      keyTrail.push(key)
      if (key === 'params' && byTemplateFunction.has(expected)) {
        keyTrail.pop()
        continue
      }
      if (key === 'body' && byTemplateFunction.has(expected)) {
        const pair = byTemplateFunction.get(expected)
        compare(
          expected.body.directives ?? [],
          actual.body.directives ?? [],
          map,
          reverse,
        )
        compare(
          expected.body.body,
          actual.body.body.filter((node) => !pair.removed.has(node)),
          map,
          reverse,
        )
      } else if (key === 'arguments' && target) {
        if (phase === 2)
          compare(expected.arguments, argumentsList, map, reverse)
      } else if (
        (key === 'property' &&
          expected.type === 'MemberExpression' &&
          !expected.computed) ||
        (key === 'key' &&
          expected.type === 'ObjectProperty' &&
          !expected.computed)
      ) {
        const name = propertyName(expected[key])
        if (properties.has(name)) member(name, propertyName(actual[key]))
        else compare(expected[key], actual[key], map, reverse)
      } else if (key !== 'shorthand')
        compare(
          expected[key],
          key === 'method' &&
            expected.type === 'ObjectProperty' &&
            actual[key] === undefined
            ? false
            : actual[key] === undefined && t.NODE_FIELDS[expected.type]?.[key]
              ? t.NODE_FIELDS[expected.type][key].default
              : actual[key],
          map,
          reverse,
        )
      keyTrail.pop()
    }
  }
  // All parameter identities used by frame setup are established before calls
  // and their permuted arguments are compared. The run prelude then pins its
  // parameters before the closure shell's sub-VM run call is visited.
  for (phase = 1; phase <= 2; phase++) {
    for (const pair of pairs) {
      role =
        pair.expected.id?.name ??
        templateMethods.find(({ fn }) => fn === pair.expected)?.name
      code = 'class-runtime-methods'
      compare(
        pair.expectedRoot ?? pair.expected,
        pair.actualRoot ?? pair.actual,
      )
    }
  }
  for (const pair of pairs) {
    const real = pair.actual.params.filter(
      (node) => !pair.fakeBindings.has(context.bindingFor(node)),
    )
    if (
      real.length !== pair.expected.params.length ||
      pair.expected.params.some(
        (node) =>
          !real.some(
            (candidate) =>
              context.bindingFor(candidate) ===
              bindings.get(template.bindingFor(node)),
          ),
      )
    )
      mismatch('parameter set')
  }
  // Helpers captured by the runtime must be the matched declarations, including
  // their full bodies and initializers, rather than same-shaped call sites.
  for (const name of ['base64ToBytes', 'CLOSURE_MAP']) {
    const expected = template.programPath.scope.getBinding(name)
    const actual = bindings.get(expected)
    if (
      !actual ||
      !actual.constant ||
      actual.path.node.type !== expected.path.node.type
    )
      mismatch('runtime capture')
    role = name
    compare(expected.path.node, actual.path.node)
  }
  phase = 2
  code = 'class-runtime-boot'
  role = 'boot'
  if (bridge.decoder.path.node.async || bridge.decoder.path.node.generator)
    mismatch('numeric decoder is not synchronous')
  const expectedInstance = template.programPath.scope.getBinding('vm')
  const actualInstance = context.bindingFor(
    context.paths.get(bridge.construct).parentPath.node.id,
  )
  bind(expectedInstance, actualInstance)
  bind(template.programPath.scope.getBinding('BYTECODE'), payload.words.binding)
  bind(template.programPath.scope.getBinding('CONSTANTS'), payload.pool.binding)
  bind(
    template.programPath.scope.getBinding('globals'),
    payload.globals.binding,
  )
  bind(template.programPath.scope.getBinding('decodeBytecode'), bridge.decoder)
  compare(expectedInstance.path.node.init, bridge.construct)
  const bootCall = template.program.body.at(-1).expression
  const count = bootCall.arguments[0].arguments[0].properties.find(
    (property) => propertyName(property.key) === 'regCount',
  ).value
  // A value hole is limited to the source-derived root descriptor field.
  literalValues.set(count, frame.regCount.value)
  compare(bootCall, root.call)
  compare(template.program.directives ?? [], context.program.directives ?? [])
  const expectedGlobals = template.programPath.scope.getBinding('globals')
  compare(expectedGlobals.path.node, payload.globals.binding.path.node)
  const bootBranches = template.program.body.filter(
    (node) => node.type === 'IfStatement',
  )
  const actualBranches = context.program.body.filter(
    (node) => node.type === 'IfStatement',
  )
  compare(bootBranches, actualBranches)
  const declarationBindings = [
    payload.words.binding,
    payload.pool.binding,
    payload.globals.binding,
    actualInstance,
    bridge.decoder,
    bindings.get(template.programPath.scope.getBinding('base64ToBytes')),
    bindings.get(template.programPath.scope.getBinding('CLOSURE_MAP')),
  ]
  for (const binding of declarationBindings) {
    const statement = binding.path.getStatementParent().node
    if (
      binding.path.isVariableDeclarator() &&
      (statement.type !== 'VariableDeclaration' ||
        statement.kind !== 'var' ||
        statement.declarations.length !== 1 ||
        statement.declarations[0] !== binding.path.node)
    )
      mismatch('unaccounted declaration effect')
  }
  const allowed = new Set([
    ...pairs.map(
      ({ actual }) => context.paths.get(actual).getStatementParent().node,
    ),
    ...declarationBindings.map(
      (binding) => binding.path.getStatementParent().node,
    ),
    ...actualBranches,
    context.paths.get(root.call).getStatementParent().node,
  ])
  if (context.program.body.some((node) => !allowed.has(node)))
    mismatch('unaccounted top-level effect')
  if (!randomized) return true
  const group = (prefix) =>
    Object.fromEntries(
      [...layout]
        .filter(([role]) => role.startsWith(prefix + '.'))
        .map(([role, value]) => [role.slice(prefix.length + 1), value]),
    )
  const opcodes = group('OP'),
    slotsMap = group('SLOTS'),
    sentinel = group('SENTINELS').CALL_SPREAD
  const headerSize = layout.get('HEADER_SIZE'),
    frameStart = layout.get('FRAME_START')
  const activeSlots = Object.values(slotsMap).filter((value) => value !== null)
  if (
    Object.keys(opcodes).length !== 61 ||
    new Set(Object.values(opcodes)).size !== 61 ||
    Object.values(opcodes).some(
      (value) => !Number.isSafeInteger(value) || value < 0 || value > 65535,
    ) ||
    !Number.isSafeInteger(sentinel) ||
    sentinel < 65535 ||
    sentinel > 0xffffffff ||
    !Number.isSafeInteger(headerSize) ||
    headerSize < 8 ||
    headerSize > 16 ||
    !Number.isSafeInteger(frameStart) ||
    frameStart < 1 ||
    frameStart > 16 ||
    new Set(activeSlots).size !== activeSlots.length ||
    activeSlots.some(
      (value) =>
        !Number.isSafeInteger(value) || value < 0 || value >= headerSize,
    )
  )
    decline(
      'randomized-class-layout',
      'Opcode/sentinel/frame layout is not a bounded allocation',
    )
  return { opcodes, slots: slotsMap, sentinel, headerSize, frameStart }
}
