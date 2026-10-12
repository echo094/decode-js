export const VM_SWITCH_SCHEMA = 'decode-js-vm-switch.v1'

const BINARY = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '&',
  '|',
  '^',
  '<<',
  '>>',
  '>>>',
  '<',
  '>',
  '<=',
  '>=',
  '===',
  '!==',
  '==',
  '!=',
  'in',
  'instanceof',
])
const UNARY = new Set(['-', '+', '!', '~'])
const CODE_KINDS = new Set(['numeric-u32', 'binary', 'source-switch'])

export class VmSwitchDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'VmSwitchDecline'
    this.code = code
  }
}

function fail(code, message) {
  throw new VmSwitchDecline(code, message)
}

function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    fail('invalid-switch-model', `${label} must be a non-negative safe integer`)
}

function register(value, count, label) {
  nonnegative(value, label)
  if (value >= count)
    fail(
      'invalid-switch-register',
      `${label} exceeds the function register count`,
    )
}

function literal(value) {
  if (value === null || value === undefined) return
  if (['string', 'boolean', 'number', 'bigint'].includes(typeof value)) return
  fail(
    'unsupported-switch-literal',
    'VM switch literal is not a primitive value',
  )
}

function registerList(values, count, label) {
  if (!Array.isArray(values))
    fail('invalid-switch-model', `${label} must be an array`)
  for (const value of values) register(value, count, label)
}

function validateOperation(op, fn, functionEntries) {
  const count = fn.regCount
  if (
    !op ||
    typeof op !== 'object' ||
    Array.isArray(op) ||
    typeof op.kind !== 'string'
  )
    fail('invalid-switch-operation', 'VM switch case has no typed operation')
  const destination = () => register(op.destination, count, 'destination')
  const source = () => register(op.source, count, 'source')
  const name = () => {
    if (typeof op.name !== 'string')
      fail('invalid-switch-operation', 'Global name must be a string')
  }
  switch (op.kind) {
    case 'assign': {
      destination()
      const value = op.value
      if (!value || typeof value !== 'object')
        fail('invalid-switch-operation', 'Assignment needs a typed value')
      if (value.kind === 'literal') literal(value.value)
      else if (value.kind === 'register')
        register(value.index, count, 'value register')
      else if (value.kind === 'binary') {
        if (!BINARY.has(value.operator))
          fail(
            'unsupported-switch-operator',
            'Binary operator is not in the JS operator set',
          )
        register(value.left, count, 'left register')
        register(value.right, count, 'right register')
      } else if (value.kind === 'unary') {
        if (!UNARY.has(value.operator))
          fail(
            'unsupported-switch-operator',
            'Unary operator is not in the JS operator set',
          )
        register(value.source, count, 'unary source')
      } else if (value.kind === 'typeof')
        register(value.source, count, 'typeof source')
      else if (!['this', 'undefined'].includes(value.kind))
        fail(
          'unsupported-switch-value',
          `Unknown VM switch value ${value.kind}`,
        )
      return
    }
    case 'global-read':
    case 'safe-typeof':
      destination()
      name()
      return
    case 'global-write':
      name()
      source()
      return
    case 'upvalue-read':
      destination()
      nonnegative(op.index, 'upvalue index')
      if (op.index >= fn.captureCount)
        fail('invalid-switch-reference', 'Upvalue read exceeds capture count')
      return
    case 'upvalue-write':
      nonnegative(op.index, 'upvalue index')
      if (op.index >= fn.captureCount)
        fail('invalid-switch-reference', 'Upvalue write exceeds capture count')
      source()
      return
    case 'property-read':
    case 'property-delete':
      destination()
      register(op.object, count, 'property object')
      register(op.key, count, 'property key')
      return
    case 'property-write':
      register(op.object, count, 'property object')
      register(op.key, count, 'property key')
      register(op.value, count, 'property value')
      return
    case 'jump':
      nonnegative(op.target, 'jump target')
      return
    case 'branch':
      register(op.condition, count, 'branch condition')
      if (!['true', 'false'].includes(op.when))
        fail('invalid-switch-operation', 'Branch polarity is invalid')
      nonnegative(op.target, 'branch target')
      return
    case 'indirect-jump':
    case 'return':
    case 'throw':
      source()
      return
    case 'call':
      destination()
      if (!['apply', 'construct'].includes(op.mode))
        fail('invalid-switch-operation', 'Call mode is invalid')
      register(op.callee, count, 'callee')
      if (op.receiver?.kind === 'register')
        register(op.receiver.index, count, 'receiver')
      else if (!['none', 'null', 'global'].includes(op.receiver?.kind))
        fail('invalid-switch-operation', 'Call receiver is invalid')
      if (op.mode === 'construct' && op.receiver.kind !== 'none')
        fail('invalid-switch-operation', 'Constructor call has a receiver')
      if (op.mode === 'apply' && op.receiver.kind === 'none')
        fail('invalid-switch-operation', 'Apply call has no receiver mode')
      if (
        !op.arguments ||
        !['fixed', 'array-register'].includes(op.arguments.kind)
      )
        fail('invalid-switch-operation', 'Call arguments are invalid')
      registerList(op.arguments.registers, count, 'call arguments')
      if (
        op.arguments.kind === 'array-register' &&
        op.arguments.registers.length !== 1
      )
        fail('invalid-switch-operation', 'Spread call needs one array register')
      return
    case 'closure': {
      destination()
      nonnegative(op.entry, 'closure entry')
      const child = functionEntries.get(op.entry)
      if (!child)
        fail('invalid-switch-target', 'Closure entry is not a function')
      if (!Array.isArray(op.captures))
        fail('invalid-switch-operation', 'Closure captures are missing')
      if (op.captures.length !== child.captureCount)
        fail(
          'invalid-switch-reference',
          'Closure capture count differs from child frame',
        )
      for (const capture of op.captures) {
        if (!['local', 'upvalue'].includes(capture?.kind))
          fail('invalid-switch-operation', 'Closure capture kind is invalid')
        if (capture.kind === 'local')
          register(capture.index, count, 'local capture')
        else {
          nonnegative(capture.index, 'upvalue capture')
          if (capture.index >= fn.captureCount)
            fail(
              'invalid-switch-reference',
              'Inherited capture exceeds parent frame',
            )
        }
      }
      return
    }
    case 'array':
      destination()
      registerList(op.elements, count, 'array elements')
      return
    case 'object':
      destination()
      if (!Array.isArray(op.pairs))
        fail('invalid-switch-operation', 'Object pairs are missing')
      for (const pair of op.pairs) {
        register(pair?.key, count, 'object key')
        register(pair?.value, count, 'object value')
      }
      return
    case 'accessor':
      if (!['get', 'set'].includes(op.accessor))
        fail('invalid-switch-operation', 'Accessor kind is invalid')
      register(op.object, count, 'accessor object')
      register(op.key, count, 'accessor key')
      register(op.callback, count, 'accessor callback')
      return
    case 'for-in-setup':
      destination()
      source()
      return
    case 'for-in-next':
      destination()
      register(op.iterator, count, 'for-in iterator')
      nonnegative(op.exit, 'for-in exit')
      return
    case 'catch-setup':
      nonnegative(op.target, 'catch target')
      register(op.exceptionRegister, count, 'exception register')
      return
    case 'handler-pop':
    case 'debugger':
      return
    case 'finally-setup':
      nonnegative(op.target, 'finally target')
      register(op.continuation, count, 'continuation register')
      register(op.payload, count, 'payload register')
      nonnegative(op.throwPad, 'throw pad')
      return
    default:
      fail(
        'unsupported-switch-operation',
        `Unknown VM switch operation ${op.kind}`,
      )
  }
}

export function validateVmSwitchModel(model) {
  if (
    model?.schemaVersion !== VM_SWITCH_SCHEMA ||
    !CODE_KINDS.has(model.code?.kind) ||
    model.storage?.kind !== 'register-machine' ||
    !Array.isArray(model.storage.functions) ||
    !Array.isArray(model.functions?.functions) ||
    !(model.instructionsByFunction instanceof Map) ||
    (model.controlByFunction !== undefined &&
      !(model.controlByFunction instanceof Map)) ||
    (model.structuredControl !== undefined &&
      !Array.isArray(model.structuredControl?.edges)) ||
    (model.controlByFunction === undefined) !==
      (model.structuredControl === undefined)
  )
    fail('invalid-switch-model', 'VM switch model has an invalid envelope')
  const functions = model.functions.functions
  if (!functions.length || functions[0].id !== 0)
    fail('invalid-switch-model', 'VM switch requires function zero as its root')
  const entries = new Map(functions.map((fn) => [fn.startPc, fn]))
  if (entries.size !== functions.length)
    fail('invalid-switch-model', 'Function entries are not unique')
  if (model.storage.functions.length !== functions.length)
    fail('invalid-switch-model', 'Storage does not cover every function')
  if (
    new Set(model.storage.functions.map(({ id }) => id)).size !==
    functions.length
  )
    fail('invalid-switch-model', 'Function storage identities are not unique')
  nonnegative(model.code.instructionCount, 'code instruction count')
  if (model.code.kind === 'numeric-u32')
    nonnegative(model.code.wordCount, 'code word count')
  const edgeById = new Map()
  for (const edge of model.structuredControl?.edges ?? []) {
    if (typeof edge?.id !== 'string' || edgeById.has(edge.id))
      fail('invalid-switch-model', 'Control edge IDs are not unique')
    edgeById.set(edge.id, edge)
  }
  const seen = new Set()
  const ids = new Set()
  let total = 0
  for (const fn of functions) {
    nonnegative(fn.id, 'function ID')
    nonnegative(fn.startPc, 'function entry')
    nonnegative(fn.regCount, 'register count')
    nonnegative(fn.paramCount, 'parameter count')
    nonnegative(fn.captureCount, 'capture count')
    if (
      ids.has(fn.id) ||
      fn.paramCount > fn.regCount ||
      typeof fn.hasRest !== 'boolean'
    )
      fail('invalid-switch-model', 'Function metadata is inconsistent')
    ids.add(fn.id)
    const storage = model.storage.functions.find(({ id }) => id === fn.id)
    if (
      !storage ||
      storage.registerCount !== fn.regCount ||
      storage.captureCount !== fn.captureCount
    )
      fail('invalid-switch-model', 'Function storage does not match its frame')
    const cases = model.instructionsByFunction.get(fn.id)
    const control = model.controlByFunction?.get(fn.id)
    if (!Array.isArray(cases) || !cases.length)
      fail('invalid-switch-model', `Function ${fn.id} has no cases`)
    if (
      model.controlByFunction &&
      !['structured', 'state-machine'].includes(control?.mode)
    )
      fail('invalid-switch-model', `Function ${fn.id} has no control mode`)
    const local = new Set()
    for (const item of cases) {
      nonnegative(item?.pc, 'case PC')
      nonnegative(item?.nextPc, 'next PC')
      if (item.nextPc <= item.pc || seen.has(item.pc))
        fail(
          'invalid-switch-model',
          'VM switch case identity or order is invalid',
        )
      seen.add(item.pc)
      local.add(item.pc)
      validateOperation(item.operation, fn, entries)
    }
    if (!local.has(fn.startPc))
      fail('invalid-switch-model', 'Function entry has no case')
    for (const item of cases) {
      const op = item.operation
      const targets = []
      if (['jump', 'branch', 'catch-setup', 'finally-setup'].includes(op.kind))
        targets.push(op.target)
      if (op.kind === 'for-in-next') targets.push(op.exit)
      if (op.kind === 'finally-setup') targets.push(op.throwPad)
      if (targets.some((target) => !local.has(target)))
        fail(
          'invalid-switch-target',
          `Function ${fn.id} transfers to a missing case`,
        )
      if (
        !['jump', 'indirect-jump', 'return', 'throw'].includes(op.kind) &&
        !local.has(item.nextPc)
      )
        fail(
          'invalid-switch-target',
          `Function ${fn.id} falls through to a missing case`,
        )
    }
    if (control?.mode === 'structured') {
      if (!Array.isArray(control.blocks))
        fail(
          'invalid-switch-model',
          'Structured control has no block inventory',
        )
      const leaves = control.blocks.flatMap((block) => block.leaves ?? [])
      if (
        leaves.length !== cases.length ||
        new Set(leaves.map(({ pc }) => pc)).size !== cases.length ||
        leaves.some(
          (leaf) =>
            !local.has(leaf.pc) ||
            leaf.operation !==
              cases.find((item) => item.pc === leaf.pc).operation,
        )
      )
        fail(
          'incomplete-switch-cases',
          'Structured leaves do not match VM switch cases',
        )
      for (const block of control.blocks) {
        if (
          block.functionId !== fn.id ||
          !Array.isArray(block.successorEdgeIds) ||
          block.successorEdgeIds.some((id) => {
            const edge = edgeById.get(id)
            return (
              !edge ||
              edge.functionId !== fn.id ||
              !local.has(edge.sourcePc) ||
              (edge.targetPc !== null && !local.has(edge.targetPc))
            )
          })
        )
          fail('invalid-switch-model', 'Structured block has an invalid edge')
      }
    }
    total += cases.length
  }
  if (
    model.instructionsByFunction.size !== ids.size ||
    (model.controlByFunction && model.controlByFunction.size !== ids.size) ||
    total !== model.instructionCount ||
    total !== model.code.instructionCount
  )
    fail('incomplete-switch-cases', 'VM switch case census is incomplete')
  return model
}
