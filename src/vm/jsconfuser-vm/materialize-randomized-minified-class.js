import * as t from '@babel/types'
import {
  EXPECTED_OPCODES,
  EXPECTED_SLOTS,
  decline,
  makeContext,
  numberValue,
  propertyName,
  isWordArray,
  precedes,
} from './container-role-helpers.js'
import { semanticShape } from './minified-class-semantic-clauses.js'
import {
  HANDLER_CLAUSES,
  DEFAULT_CLAUSE,
} from './minified-class-handler-clauses.js'
import { ownedFunctions } from './minified-class-owned-functions.js'
import { clauseLiveness } from './minified-class-binding-liveness.js'
import { projectWords } from './materialize-randomized-runtime.js'

const fail = (condition, message) => {
  if (!condition) decline('randomized-minified-class', message)
}
const sole = (items, message) => {
  fail(items.length === 1, message)
  return items[0]
}
// These atoms execute unconditionally in the supplied block. Every expression
// result is discarded; do not flatten values, branches, calls or loop bodies.
function unusedAtoms(block) {
  const expressions = (node) =>
    node.type === 'SequenceExpression'
      ? node.expressions.flatMap(expressions)
      : [node]
  return block.body.flatMap((node) =>
    node.type === 'ExpressionStatement'
      ? expressions(node.expression)
      : node.type === 'VariableDeclaration'
        ? node.declarations
        : [node],
  )
}
const fixed = new Set([
  'prototype',
  'length',
  'apply',
  'call',
  'get',
  'set',
  'push',
  'pop',
  'slice',
  'name',
  'message',
  'configurable',
  'enumerable',
  'pow',
  'from',
  'fromCharCode',
  'charCodeAt',
  'isArray',
  'getOwnPropertyDescriptor',
  'getOwnPropertyNames',
  'getPrototypeOf',
  'create',
  'defineProperty',
  'construct',
  'hasOwnProperty',
  'toString',
  'valueOf',
])

// A provisional semantic skeleton only proposes labels. Complete source clauses
// and the enclosing owned graph must prove every proposed role before admission.
function skeleton(root, context = null) {
  const calls = new Map()
  const graph = context && ownedFunctions(context, null)
  const callKey = (node) => {
    const callee = node.callee
    if (callee.type === 'Identifier')
      return context ? context.bindingFor(callee) : callee.name
    return propertyName(callee.property)
  }
  function walk(node, property = false) {
    if (Array.isArray(node)) return node.map((item) => walk(item))
    if (!node || typeof node !== 'object') return node
    if (['CallExpression', 'NewExpression'].includes(node.type)) {
      const callee = node.callee
      const owned =
        callee.type === 'Identifier'
          ? context
            ? !!context.bindingFor(callee)
            : callee.name.startsWith('$')
          : callee.type === 'MemberExpression' &&
            !fixed.has(propertyName(callee.property))
      if (owned) {
        const key = callKey(node)
        if (!calls.has(key)) calls.set(key, calls.size)
        let args = node.arguments
        if (context) {
          const fn =
            callee.type === 'Identifier'
              ? context.bindingFor(callee)?.path.node
              : graph.functions.find(
                  (e) => e.method?.name === propertyName(callee.property),
                )?.fn
          if (!fn) return { type: 'UnownedCall' }
          const incoming = clauseLiveness(
            graph.stripped(graph.functions.find((e) => e.fn === fn)).body,
            (n) => context.bindingFor(n),
          )
          args = args.filter((_, i) =>
            incoming.has(context.bindingFor(fn.params[i])),
          )
          if (callee.type === 'MemberExpression')
            args = [callee.object, ...args]
        }
        return {
          type: 'OwnedCall',
          role: calls.get(key),
          args: args
            .map((a) => walk(a))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        }
      }
    }
    if (node.type === 'Identifier') {
      if (property) return fixed.has(node.name) ? node.name : '#field'
      return context
        ? context.bindingFor(node)
          ? '#local'
          : node.name
        : node.name.startsWith('$')
          ? '#local'
          : node.name
    }
    if (node.type === 'ThisExpression') return '#local'
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== 'method')
        .map(([key, value]) => [
          key,
          walk(
            value,
            (node.type === 'MemberExpression' &&
              !node.computed &&
              key === 'property') ||
              (node.type === 'ObjectProperty' &&
                !node.computed &&
                key === 'key'),
          ),
        ]),
    )
  }
  return JSON.stringify(walk(root))
}

export function materializeRandomizedMinifiedClass(input) {
  const ast = t.cloneNode(input, true),
    context = makeContext(ast)
  const switches = context
    .nodes(context.program)
    .filter(({ node }) => node.type === 'SwitchStatement')
  if (switches.length !== 1 || switches[0].node.cases.length !== 62) return null
  const dispatch = switches[0].node
  const constructions = context
    .nodes(context.program)
    .filter(
      ({ node, path }) =>
        node.type === 'NewExpression' &&
        !path.getFunctionParent() &&
        node.arguments.some(isWordArray),
    )
  if (constructions.length !== 1) return null
  const vmCall = constructions[0].node,
    vmBinding = context.bindingFor(vmCall.callee)
  if (!vmBinding?.path.isFunctionDeclaration()) return null
  const ctor = vmBinding.path.node
  const assignments = ctor.body.body.flatMap((s) =>
    s.type === 'ExpressionStatement' &&
    s.expression.type === 'AssignmentExpression'
      ? [s.expression]
      : [],
  )
  const regsWrite = sole(
    assignments.filter(
      (n) =>
        n.left.object?.type === 'ThisExpression' &&
        n.right.type === 'ArrayExpression' &&
        !n.right.elements.length,
    ),
    'Register field is not unique',
  )
  const regsField = propertyName(regsWrite.left.property)
  const regBindings = new Set(
    context
      .nodes(context.program)
      .flatMap(({ node }) => {
        const value =
          node.type === 'VariableDeclarator'
            ? node.init
            : node.type === 'AssignmentExpression'
              ? node.right
              : null
        return value?.type === 'MemberExpression' &&
          !value.computed &&
          propertyName(value.property) === regsField
          ? [context.bindingFor(node.id ?? node.left)]
          : []
      })
      .filter(Boolean),
  )
  const isRegs = (n) =>
    (n?.type === 'MemberExpression' &&
      !n.computed &&
      propertyName(n.property) === regsField) ||
    regBindings.has(context.bindingFor(n))
  const index = (n) =>
    n?.type === 'MemberExpression' &&
    n.computed &&
    isRegs(n.object) &&
    n.property?.type === 'BinaryExpression' &&
    n.property.operator === '+' &&
    numberValue(n.property.right) !== null
      ? {
          offset: numberValue(n.property.right),
          base: context.bindingFor(n.property.left),
          literal: n.property.right,
        }
      : null
  const runFn = context.paths.get(dispatch).getFunctionParent().node
  // A retained explicit noise map has dynamic header offsets guarded by typeof.
  // Class inlining followed by Closure folds those guards and offsets. This
  // normalizer only owns the resulting literal layout; leave map-bearing source
  // to its complete ordinary-runtime observer, including damaged handlers.
  if (
    context
      .nodes(runFn)
      .some(
        ({ node, path }) =>
          node.type === 'MemberExpression' &&
          node.computed &&
          isRegs(node.object) &&
          node.property?.type === 'BinaryExpression' &&
          node.property.operator === '+' &&
          numberValue(node.property.right) === null &&
          !path.findParent((p) => p.isTryStatement()),
      )
  )
    return null
  const guards = context
    .nodes(runFn)
    .filter(
      ({ node, path }) =>
        node.type === 'IfStatement' &&
        node.test?.type === 'BinaryExpression' &&
        node.test.operator === '>=' &&
        node.test.right?.type === 'MemberExpression' &&
        propertyName(node.test.right.property) === 'length' &&
        node.consequent.type === 'BreakStatement' &&
        !path.findParent((p) => p.isTryStatement()),
    )
  const cursorBinding = context.bindingFor(
    sole(guards, 'Dispatch cursor guard is not unique').node.test.left,
  )
  const cursorReads = context
    .nodes(runFn)
    .filter(
      ({ node, path }) =>
        !path.findParent((p) => p.isTryStatement()) &&
        ((node.type === 'VariableDeclarator' &&
          context.bindingFor(node.id) === cursorBinding &&
          index(node.init)) ||
          (node.type === 'AssignmentExpression' &&
            context.bindingFor(node.left) === cursorBinding &&
            index(node.right))),
    )
  const pcOffset = index(
    sole(cursorReads, 'Dispatch PC read is not unique').node.init ??
      cursorReads[0].node.right,
  ).offset
  const frameCandidates = context
    .nodes(context.program)
    .filter(
      ({ node }) =>
        ['FunctionDeclaration', 'FunctionExpression'].includes(node.type) &&
        node !== runFn,
    )
    .flatMap(({ node: fn }) => {
      const writes = context
        .nodes(fn)
        .filter(
          ({ node, path }) =>
            path.getFunctionParent()?.node === fn &&
            node.type === 'AssignmentExpression' &&
            index(node.left),
        )
        .map(({ node }) => ({ node, ...index(node.left) }))
      const starts = writes.filter(
        ({ node, offset }) =>
          offset === pcOffset &&
          node.right.type === 'MemberExpression' &&
          !node.right.computed &&
          context.bindingFor(node.right.object)?.path.node.init?.type ===
            'MemberExpression' &&
          !context.bindingFor(node.right.object).path.node.init.computed &&
          fn.params.some(
            (p) =>
              context.bindingFor(p) ===
              context.bindingFor(
                context.bindingFor(node.right.object).path.node.init.object,
              ),
          ),
      )
      return starts
        .map((start) => ({
          fn,
          start,
          writes: writes.filter((w) => w.base === start.base),
        }))
        .filter(({ writes }) => writes.length >= 7)
    })
  const frame = sole(frameCandidates, 'Connected frame writer is not unique')
  const descriptor = context.bindingFor(frame.start.node.right.object)
  const declaration = descriptor.path.node
  const closure = context.bindingFor(declaration.init.object)
  const locals = context
    .nodes(frame.fn)
    .flatMap(({ node }) =>
      node.type === 'VariableDeclarator'
        ? [{ node }]
        : node.type === 'AssignmentExpression' &&
            node.left.type === 'Identifier'
          ? [{ node: { id: node.left, init: node.right } }]
          : [],
    )
  const size = sole(
    locals.filter(
      ({ node }) =>
        node.init?.type === 'BinaryExpression' &&
        node.init.operator === '+' &&
        numberValue(node.init.left) >= 8 &&
        numberValue(node.init.left) <= 16 &&
        context.sameRef(node.init.right?.object, descriptor),
    ),
    'Header size role is not unique',
  ).node
  const header = size.init.left.value
  const base = sole(
    locals.filter(
      ({ node }) =>
        node.init?.type === 'BinaryExpression' &&
        node.init.operator === '+' &&
        context.sameRef(node.init.left, frame.start.base) &&
        numberValue(node.init.right) === header,
    ),
    'Register base role is not unique',
  ).node
  const byValue = (predicate, role) =>
    sole(
      frame.writes.filter(({ node }) => predicate(node.right)),
      `${role} header write is not unique`,
    ).offset
  const slots = {
    PC: frame.start.offset,
    FRAME_SIZE: byValue(
      (n) => context.sameRef(n, context.bindingFor(size.id)),
      'size',
    ),
    REG_BASE: byValue(
      (n) => context.sameRef(n, context.bindingFor(base.id)),
      'base',
    ),
    CLOSURE: byValue((n) => context.sameRef(n, closure), 'closure'),
    CALLER: byValue(
      (n) =>
        n.type === 'MemberExpression' &&
        !n.computed &&
        assignments.some(
          (a) =>
            propertyName(a.left.property) === propertyName(n.property) &&
            numberValue(a.right) === 0,
        ),
      'caller',
    ),
  }
  const fnPath = context.paths.get(frame.fn),
    method = fnPath.parentPath.node.left?.property
  const frameCalls = context
    .nodes(context.paths.get(dispatch).getFunctionParent().node)
    .filter(
      ({ node, path }) =>
        node.type === 'CallExpression' &&
        precedes(path, context.paths.get(dispatch)) &&
        (method
          ? node.callee.type === 'MemberExpression' &&
            propertyName(node.callee.property) === propertyName(method)
          : context.sameRef(node.callee, context.bindingFor(frame.fn.id))),
    )
  const frameCall = sole(frameCalls, 'Root frame invocation is not unique').node
  const returnParams = frame.fn.params.filter(
    (p, i) => numberValue(frameCall.arguments[i]) === 0,
  )
  const ret = sole(returnParams, 'Root return destination is not unique')
  slots.RET_DST = byValue(
    (n) => context.sameRef(n, context.bindingFor(ret)),
    'return destination',
  )
  const other = frame.writes.filter(
    (w) =>
      !Object.values(slots).includes(w.offset) &&
      frame.fn.params.some((p) =>
        context.sameRef(w.node.right, context.bindingFor(p)),
      ),
  )
  // Args is only copied to an optional noise slot. THIS is the parameter whose
  // initial dispatch argument is the root undefined receiver, checked below by
  // the complete root/entry/owned graph.
  const rootRun = context.paths.get(dispatch).getFunctionParent().node
  const rootCalls = context
    .nodes(context.program)
    .filter(
      ({ node, path }) =>
        node.type === 'CallExpression' &&
        !path.getFunctionParent() &&
        (rootRun.id
          ? context.sameRef(node.callee, context.bindingFor(rootRun.id))
          : node.callee.type === 'MemberExpression' &&
            propertyName(node.callee.property) ===
              propertyName(
                context.paths.get(rootRun).parentPath.node.left.property,
              )),
    )
  const rootCall = sole(rootCalls, 'Root dispatch call is not unique').node
  const undefinedValue = (n) =>
    n?.type === 'UnaryExpression' &&
    n.operator === 'void' &&
    numberValue(n.argument) === 0
  slots.THIS = sole(
    other.filter(({ node }) => {
      const i = frame.fn.params.findIndex((p) =>
        context.sameRef(node.right, context.bindingFor(p)),
      )
      const actual = frameCall.arguments[i]
      const j = rootRun.params.findIndex((p) =>
        context.sameRef(actual, context.bindingFor(p)),
      )
      return (
        j >= 0 &&
        (j >= rootCall.arguments.length ||
          undefinedValue(rootCall.arguments[j]))
      )
    }),
    'Root receiver header role is not unique',
  ).offset
  const pops = context
    .nodes(dispatch)
    .filter(
      ({ node }) =>
        node.type === 'CallExpression' &&
        propertyName(node.callee.property) === 'pop' &&
        index(node.callee.object),
    )
  const handlerOffsets = [
    ...new Set(pops.map(({ node }) => index(node.callee.object).offset)),
  ]
  slots.HANDLERS = sole(handlerOffsets, 'Handler stack role is not unique')
  fail(
    new Set(Object.values(slots)).size === 8 &&
      Object.values(slots).every(
        (v) => Number.isSafeInteger(v) && v >= 0 && v < header,
      ),
    'Core frame layout is not a bounded permutation',
  )
  const topRead = frame.start.base.path.node.init
  const topField = propertyName(topRead.property)
  const topInit = sole(
    assignments.filter((n) => propertyName(n.left.property) === topField),
    'Frame origin is not unique',
  ).right
  fail(
    Number.isSafeInteger(numberValue(topInit)) &&
      numberValue(topInit) >= 1 &&
      numberValue(topInit) <= 16,
    'Frame origin is out of bounds',
  )

  const frameStart = numberValue(topInit)
  const inverse = new Map(
    Object.entries(slots).map(([role, value]) => [value, EXPECTED_SLOTS[role]]),
  )
  const noise = [],
    noiseRoles = new Map(),
    noiseOffsets = new Map()
  const noiseRole = (role, offset, phase) => {
    fail(
      !inverse.has(offset) && offset >= 0 && offset < header,
      'Noise slot overlaps active layout',
    )
    fail(
      !noiseRoles.has(role) || noiseRoles.get(role) === offset,
      'Noise role allocation changed',
    )
    fail(
      !noiseOffsets.has(offset) || noiseOffsets.get(offset) === role,
      'Noise roles share a slot',
    )
    noiseRoles.set(role, offset)
    noiseOffsets.set(offset, role)
    noise.push({ role, offset, phase })
  }
  const end = sole(
    locals.filter(
      ({ node }) =>
        node.init?.type === 'BinaryExpression' &&
        node.init.operator === '+' &&
        context.sameRef(node.init.left, frame.start.base) &&
        context.sameRef(node.init.right, context.bindingFor(size.id)),
    ),
    'Frame end is not unique',
  ).node
  const paramReads = context
    .nodes(frame.fn)
    .filter(
      ({ node }) =>
        node.type === 'BinaryExpression' &&
        node.operator === '-' &&
        numberValue(node.right) === 1 &&
        node.left?.type === 'MemberExpression' &&
        context.sameRef(node.left.object, descriptor),
    )
  const paramField = propertyName(
    sole(paramReads, 'Rest parameter count field is not unique').node.left
      .property,
  )
  const argsSlices = context
    .nodes(frame.fn)
    .filter(
      ({ node }) =>
        node.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        propertyName(node.callee.property) === 'slice' &&
        frame.fn.params.some((p) =>
          context.sameRef(node.callee.object, context.bindingFor(p)),
        ),
    )
  const argsBinding = context.bindingFor(
    sole(argsSlices, 'Frame args slice is not unique').node.callee.object,
  )
  const argsParam = sole(
    frame.fn.params.filter((p) => context.bindingFor(p) === argsBinding),
    'Frame args parameter is not unique',
  )
  const argsActual = frameCall.arguments[frame.fn.params.indexOf(argsParam)]
  const argsIndex = rootRun.params.findIndex((p) =>
    context.sameRef(argsActual, context.bindingFor(p)),
  )
  fail(
    argsIndex >= 0 &&
      (rootCall.arguments[argsIndex]?.type === 'NullLiteral' ||
        (rootCall.arguments[argsIndex]?.type === 'ArrayExpression' &&
          rootCall.arguments[argsIndex].elements.length === 0)),
    'Root argument list is not empty',
  )
  const frameRegs = context.bindingFor(frame.start.node.left.object)
  fail(
    frameRegs &&
      frame.writes.every(
        (w) => context.bindingFor(w.node.left.object) === frameRegs,
      ),
    'Frame header receiver changed',
  )
  const sameReceiver = (actual, expected) =>
    expected?.type === 'ThisExpression'
      ? actual?.type === 'ThisExpression'
      : !!context.bindingFor(expected) &&
        context.bindingFor(actual) === context.bindingFor(expected)
  const definitionBefore = (binding, fn, use, block = fn.body) => {
    const definitions = context
      .nodes(fn)
      .filter(
        ({ node, path }) =>
          ['VariableDeclarator', 'AssignmentExpression'].includes(node.type) &&
          context.bindingFor(node.id ?? node.left) === binding &&
          path.getFunctionParent()?.node === fn &&
          precedes(path, context.paths.get(use)),
      )
    const definition = definitions.at(-1)
    fail(definition, 'Noise dependency has no preceding definition')
    const { node, path } = definition
    fail(
      node.type !== 'AssignmentExpression' || node.operator === '=',
      'Noise dependency assignment operator changed',
    )
    const direct = unusedAtoms(block).includes(node)
    const initLoop = path.findParent((p) => p.isForStatement())
    const inInitialFor =
      node.type === 'VariableDeclarator' &&
      path.parentPath.isVariableDeclaration() &&
      initLoop?.node.init === path.parentPath.node &&
      initLoop.parentPath.node === fn.body
    fail(direct || inInitialFor, 'Noise dependency definition is conditional')
    return node.init ?? node.right
  }
  const frameVm = topRead.object
  const frameRegSource = definitionBefore(frameRegs, frame.fn, frame.start.node)
  fail(
    frameRegSource.type === 'MemberExpression' &&
      !frameRegSource.computed &&
      propertyName(frameRegSource.property) === regsField &&
      sameReceiver(frameRegSource.object, frameVm),
    'Noise frame register alias is detached from VM',
  )
  const frameAtoms = unusedAtoms(frame.fn.body)
  const corePositions = frame.writes
    .filter((w) => inverse.has(w.offset))
    .map((w) => frameAtoms.indexOf(w.node))
  fail(
    corePositions.every((position) => position >= 0),
    'Core frame writes are not an unconditional prefix',
  )
  const topUpdate = sole(
    frameAtoms.filter(
      (node) =>
        node.type === 'AssignmentExpression' &&
        node.operator === '=' &&
        node.left.type === 'MemberExpression' &&
        !node.left.computed &&
        propertyName(node.left.property) === topField &&
        sameReceiver(node.left.object, frameVm) &&
        context.sameRef(node.right, context.bindingFor(end.id)),
    ),
    'Noise seed phase has no connected top update',
  )
  const lastCore = Math.max(...corePositions),
    topPosition = frameAtoms.indexOf(topUpdate)
  fail(topPosition > lastCore, 'Noise seed phase order changed')
  const extraWrites = frame.writes.filter((w) => !inverse.has(w.offset))
  const allowedPush = new Set()
  let pushOrder = -1
  for (const w of extraWrites) {
    fail(w.node.operator === '=', 'Noise assignment operator changed')
    const position = frameAtoms.indexOf(w.node)
    fail(
      position > lastCore && position < topPosition,
      'Noise seed is not an unconditional unused effect in its phase',
    )
    const n = w.node.right
    const role = context.sameRef(n, context.bindingFor(end.id))
      ? 'END'
      : n.type === 'MemberExpression' &&
          !n.computed &&
          context.sameRef(n.object, descriptor) &&
          propertyName(n.property) === paramField
        ? 'PARAMS'
        : context.sameRef(n, context.bindingFor(argsParam))
          ? 'ARGS'
          : n.type === 'MemberExpression' &&
              !n.computed &&
              context.sameRef(n.object, descriptor) &&
              propertyName(n.property) ===
                propertyName(frame.start.node.right.property)
            ? 'PC'
            : numberValue(n) === 0
              ? 'COUNTER'
              : null
    fail(role, 'Noise frame effect is outside the pinned shape')
    const order = ['END', 'PARAMS', 'ARGS', 'PC', 'COUNTER'].indexOf(role)
    fail(order > pushOrder, 'Noise frame effect order changed')
    pushOrder = order
    noiseRole(role, w.offset, 'push')
    allowedPush.add(w.node)
  }
  fail(
    frameAtoms
      .slice(lastCore + 1, topPosition)
      .every((n) => allowedPush.has(n)),
    'Noise seed phase contains another effect',
  )
  const dispatchFn = context.paths.get(dispatch).getFunctionParent().node
  const fetchEntry = sole(
    context
      .nodes(dispatchFn)
      .filter(
        ({ node, path }) =>
          ['AssignmentExpression', 'VariableDeclarator'].includes(node.type) &&
          context.bindingFor(node.left ?? node.id) ===
            context.bindingFor(dispatch.discriminant) &&
          (node.right ?? node.init)?.type === 'MemberExpression' &&
          (node.right ?? node.init).computed &&
          (node.right ?? node.init).object?.type === 'MemberExpression' &&
          path.getFunctionParent()?.node === dispatchFn &&
          !path.findParent((p) => p.isTryStatement()) &&
          precedes(path, context.paths.get(dispatch)),
      ),
    'Opcode fetch is not unique',
  ).node
  const fetch = { right: fetchEntry.right ?? fetchEntry.init }
  const cursor = context.bindingFor(fetch.right.property),
    wordsField = propertyName(fetch.right.object.property)
  fail(cursor, 'Opcode cursor is unbound')
  const dispatchPCNode = cursorReads[0].node.init ?? cursorReads[0].node.right
  const dispatchRegs = context.bindingFor(dispatchPCNode.object),
    dispatchFrame = index(dispatchPCNode).base
  fail(
    dispatchRegs && dispatchFrame,
    'Noise dispatch register/frame binding is missing',
  )
  const wordReceiver = fetch.right.object.object
  const wordsReference = (node) =>
    node?.type === 'MemberExpression' &&
    !node.computed &&
    propertyName(node.property) === wordsField &&
    (wordReceiver.type === 'ThisExpression'
      ? node.object.type === 'ThisExpression'
      : context.bindingFor(node.object) === context.bindingFor(wordReceiver))
  const loop = context.paths.get(dispatch).findParent((p) => p.isForStatement())
  const protectedTry = context.paths
    .get(dispatch)
    .findParent((p) => p.isTryStatement())
  fail(
    loop?.node.body.type === 'BlockStatement' &&
      protectedTry?.parentPath.node === loop.node.body,
    'Noise churn phase is not the direct dispatch loop prefix',
  )
  const dispatchRegSource = definitionBefore(
    dispatchRegs,
    dispatchFn,
    cursorReads[0].node,
    loop.node.body,
  )
  fail(
    dispatchRegSource.type === 'MemberExpression' &&
      !dispatchRegSource.computed &&
      propertyName(dispatchRegSource.property) === regsField &&
      sameReceiver(dispatchRegSource.object, wordReceiver),
    'Noise dispatch register alias is detached from VM',
  )
  const dispatchAtoms = unusedAtoms(loop.node.body)
  const fetchPosition = dispatchAtoms.indexOf(fetchEntry),
    tryPosition = dispatchAtoms.indexOf(protectedTry.node)
  fail(
    fetchPosition >= 0 && tryPosition > fetchPosition,
    'Noise fetch phase changed',
  )
  const beforeTry = context
    .nodes(dispatchFn)
    .filter(
      ({ node, path }) =>
        ['AssignmentExpression', 'UpdateExpression'].includes(node.type) &&
        index(node.left ?? node.argument) &&
        !path.findParent((p) => p.isTryStatement()),
    )
  const allowedDispatch = new Set()
  let churnOrder = -1
  for (const { node, path } of beforeTry) {
    const idx = index(node.left ?? node.argument)
    if (inverse.has(idx.offset)) continue
    fail(
      precedes(context.paths.get(fetchEntry), path) &&
        precedes(path, context.paths.get(dispatch)),
      'Noise churn is outside dispatch prefix',
    )
    const position = dispatchAtoms.indexOf(node)
    fail(
      position > fetchPosition && position < tryPosition,
      'Noise churn is not an unconditional unused effect in its phase',
    )
    fail(
      node.type !== 'AssignmentExpression' || node.operator === '=',
      'Noise assignment operator changed',
    )
    fail(
      context.bindingFor((node.left ?? node.argument).object) ===
        dispatchRegs && idx.base === dispatchFrame,
      'Noise register/frame receiver changed',
    )
    const right = node.right
    const sameSlot = (n) => {
      const read = index(n)
      if (read?.offset !== idx.offset || read?.base !== idx.base) return false
      fail(
        context.bindingFor(n.object) === dispatchRegs,
        'Noise register read receiver changed',
      )
      return true
    }
    const wordLength = (n) => {
      if (
        n?.type !== 'MemberExpression' ||
        n.computed ||
        propertyName(n.property) !== 'length'
      )
        return false
      if (wordsReference(n.object)) return true
      if (n.object.type !== 'Identifier') return false
      const alias = context.bindingFor(n.object)
      if (!alias) return false
      const source = definitionBefore(
        alias,
        dispatchFn,
        fetchEntry,
        loop.node.body,
      )
      fail(wordsReference(source), 'Noise word alias is detached from VM')
      const guardWords = guards[0].node.test.right.object
      fail(
        context.sameRef(guardWords, alias),
        'Noise word alias is detached from cursor guard',
      )
      return true
    }
    const role =
      node.type === 'UpdateExpression' && node.operator === '++' && !node.prefix
        ? 'COUNTER'
        : right?.type === 'BinaryExpression' &&
            right.operator === '%' &&
            right.left?.type === 'BinaryExpression' &&
            right.left.operator === '+' &&
            sameSlot(right.left.left) &&
            numberValue(right.left.right) === 1 &&
            wordLength(right.right)
          ? 'PC'
          : right?.type === 'BinaryExpression' &&
              right.operator === '|' &&
              numberValue(right.right) === 0 &&
              right.left?.type === 'BinaryExpression' &&
              right.left.operator === '^' &&
              sameSlot(right.left.left) &&
              context.sameRef(right.left.right, cursor)
            ? 'ACC'
            : context.sameRef(right, context.bindingFor(dispatch.discriminant))
              ? 'MIRROR'
              : null
    fail(role, 'Noise dispatch effect is outside the pinned shape')
    fail(
      role !== 'ACC' || cursor !== context.bindingFor(dispatch.discriminant),
      'ACC cursor has been overwritten by opcode',
    )
    const order = ['PC', 'COUNTER', 'MIRROR', 'ACC'].indexOf(role)
    fail(order > churnOrder, 'Noise dispatch effect order changed')
    churnOrder = order
    noiseRole(role, idx.offset, 'dispatch')
    allowedDispatch.add(node)
  }
  fail(
    dispatchAtoms
      .slice(fetchPosition + 1, tryPosition)
      .every((n) => allowedDispatch.has(n)),
    'Noise churn phase contains another effect',
  )
  for (const [role] of noiseRoles) {
    const phases = noise.filter((n) => n.role === role).map((n) => n.phase)
    fail(
      !['PC', 'COUNTER'].includes(role) || phases.length === 2,
      'Seeded churn role is incomplete',
    )
  }
  const allowed = new Set([...allowedPush, ...allowedDispatch])
  // Remove only proved effects from statement-value sequences. Unknown uses of
  // a noise offset are refused instead of silently becoming canonical offsets.
  for (const { node, path } of context.nodes(context.program)) {
    const idx = index(node)
    if (idx && !inverse.has(idx.offset))
      fail(
        path.findParent((p) => allowed.has(p.node)),
        'Noise slot escapes proved effect',
      )
  }
  for (const { node, path } of [...context.nodes(context.program)].reverse()) {
    if (allowed.has(node)) {
      if (path.parentPath.isExpressionStatement()) path.parentPath.remove()
      else if (path.parentPath.isSequenceExpression()) path.remove()
      else fail(false, 'Noise effect is not an ordered standalone effect')
    }
  }
  for (const { node } of context.nodes(context.program)) {
    const idx = index(node)
    if (idx && inverse.has(idx.offset))
      idx.literal.value = inverse.get(idx.offset)
  }
  size.init.left.value = 8
  base.init.right.value = 8
  topInit.value = 1
  const sentinels = context
    .nodes(dispatch)
    .filter(
      ({ node }) =>
        node.type === 'BinaryExpression' &&
        node.operator === '===' &&
        numberValue(node.right) >= 65535,
    )
    .map(({ node }) => node.right)
  fail(
    sentinels.every((n) => n.value <= 4294967295) &&
      sentinels.length === 3 &&
      new Set(sentinels.map((n) => n.value)).size === 1,
    'Spread sentinel is not shared by three call cases',
  )
  const sentinel = sentinels[0].value
  sentinels.forEach((n) => (n.value = 65535))
  const patterns = new Map(
    [...HANDLER_CLAUSES].map(([opcode, body]) => [opcode, skeleton(body)]),
  )
  const opcodes = {}
  for (const entry of dispatch.cases) {
    if (entry.test === null) {
      fail(
        skeleton(semanticShape(entry.consequent), context) ===
          skeleton(DEFAULT_CLAUSE),
        'Default case skeleton changed',
      )
      continue
    }
    fail(
      Number.isSafeInteger(numberValue(entry.test)) &&
        numberValue(entry.test) >= 0 &&
        numberValue(entry.test) <= 65535,
      'Opcode label is outside u16',
    )
    const candidate = skeleton(semanticShape(entry.consequent), context)
    const matches = [...patterns].filter(
      ([, signature]) => signature === candidate,
    )
    fail(matches.length === 1, 'Semantic case skeleton is missing or ambiguous')
    const opcode = matches[0][0],
      name = Object.keys(EXPECTED_OPCODES).find(
        (n) => EXPECTED_OPCODES[n] === opcode,
      )
    opcodes[name] = entry.test.value
    entry.test.value = opcode
  }
  fail(
    Object.keys(opcodes).length === 61 &&
      new Set(Object.values(opcodes)).size === 61,
    'Opcode map is not complete and distinct',
  )
  const words = vmCall.arguments.find(isWordArray)
  try {
    words.elements = projectWords(
      words.elements.map(numberValue),
      opcodes,
      sentinel,
    ).map(t.numericLiteral)
  } catch (error) {
    if (error.code === 'randomized-runtime')
      decline('randomized-minified-class-wordcode', error.message)
    throw error
  }
  context.programPath.scope.crawl()
  return {
    ast,
    layout: { opcodes, slots, sentinel, headerSize: header, frameStart, noise },
  }
}
