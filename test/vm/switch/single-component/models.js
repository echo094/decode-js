// Typed switch models and runners shared by the backend unit tests, one file per stage.
import { expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { emitVmSwitchProgram } from '../../../../src/vm/switch/to-source.js'
import { scriptTimeout } from '../../../helper.js'

export function runSource(source, context) {
  return runInNewContext(source, context, { timeout: scriptTimeout })
}

export function sourceSwitchModel() {
  const cases = [
    {
      pc: 0,
      nextPc: 1,
      operation: {
        kind: 'assign',
        destination: 0,
        value: { kind: 'literal', value: 7 },
      },
    },
    {
      pc: 1,
      nextPc: 2,
      operation: { kind: 'global-write', name: 'RESULT', source: 0 },
    },
    { pc: 2, nextPc: 3, operation: { kind: 'return', source: 0 } },
  ]
  return {
    schemaVersion: 'decode-js-vm-switch.v1',
    storage: {
      kind: 'register-machine',
      functions: [{ id: 0, registerCount: 1, captureCount: 0 }],
    },
    functions: {
      functions: [
        {
          id: 0,
          startPc: 0,
          regCount: 1,
          paramCount: 0,
          captureCount: 0,
          hasRest: false,
        },
      ],
    },
    instructionsByFunction: new Map([[0, cases]]),
    instructionCount: 3,
  }
}

export function withCases(cases, registerCount) {
  const model = sourceSwitchModel()
  model.storage.functions[0].registerCount = registerCount
  model.functions.functions[0].regCount = registerCount
  model.instructionsByFunction.set(0, cases)
  model.instructionCount = cases.length
  return model
}

// One case per operation, each falling through to the next PC.
export function casesOf(operations, registerCount) {
  return withCases(
    operations.map((operation, pc) => ({ pc, nextPc: pc + 1, operation })),
    registerCount,
  )
}

// Run the program; return RESULT, the copy proofs and the declared and used registers.
export function emitCopies(model) {
  const { output, simplification } = emitVmSwitchProgram(model)
  const context = { RESULT: null, W: 140 }
  context.globalThis = context
  runSource(output, context)
  const [declaration, ...body] = output
    .split('\n')
    .filter((line) => line.includes('__recovered_r_0_'))
  const names = (lines) =>
    [...new Set(lines.join('\n').match(/__recovered_r_0_\d+/g) ?? [])].sort()
  return {
    output,
    result: context.RESULT,
    seen: context.SEEN,
    copies: simplification.functions[0].copies,
    declared: names([declaration]),
    used: names(body),
  }
}

// var w = W; var d = w; (js-confuser-vm default options: LOAD_GLOBAL, MOVE w, MOVE d = w).
// Both moves coalesce: the second move's producer is the first move, so the chain resolves to
// one write of the final register at the retained root.
export const chain = [
  { kind: 'global-read', destination: 0, name: 'W' },
  { kind: 'assign', destination: 1, value: { kind: 'register', index: 0 } },
  { kind: 'assign', destination: 2, value: { kind: 'register', index: 1 } },
  { kind: 'global-write', name: 'RESULT', source: 2 },
  { kind: 'return', source: 2 },
]

export const chainRows = (root, links) =>
  links.map(([producerPc, movePc, sourceRegister]) => ({
    producerPc: root,
    movePc,
    sourceRegister,
    destinationRegister: 2,
    reachingDefinitions: [String(producerPc)],
  }))

export const row = ({
  producerPc,
  movePc,
  sourceRegister,
  destinationRegister,
  reachingDefinitions,
}) => ({
  producerPc,
  movePc,
  sourceRegister,
  destinationRegister,
  reachingDefinitions,
})

// Run a program under a fresh global; return the output and RESULT.
export function emitRun(model, globals = {}) {
  const { output, simplification } = emitVmSwitchProgram(model)
  const context = { RESULT: null, ...globals }
  context.globalThis = context
  runSource(output, context)
  return { output, simplification, result: context.RESULT }
}

export const literalOf = (value, destination = 0) => ({
  kind: 'assign',
  destination,
  value: { kind: 'literal', value },
})

// Single-use folding. `O` is a host object whose getters log each read, so a run shows the
// order the folded reads evaluate in.
export function loggingHost(values, extra = {}) {
  const LOG = []
  const O = {}
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(O, key, {
      get() {
        LOG.push(key)
        if (value instanceof Error) throw value
        return value
      },
      set(next) {
        LOG.push(`set ${key}`)
        values[key] = next
      },
      configurable: true,
    })
  return { LOG, O, ...extra }
}

export const read = (destination, object, key) => ({
  kind: 'property-read',
  destination,
  object,
  key,
})

export const globalO = { kind: 'global-read', destination: 0, name: 'O' }

export const r = (register) => `__recovered_r_0_${register}`

// `if (C) R = 'a'; else R = 'b';` with the branch `when` given: the compiler's jump-if-false
// leaves to the alternate; a jump-if-true (off its path) leaves to the arm that runs when C holds.
export const twoArmed = (when, prefix = []) => {
  const at = prefix.length
  const condition = prefix.length ? 1 : 0
  return [
    { kind: 'global-read', destination: 0, name: 'C' },
    ...prefix,
    { kind: 'branch', condition, when, target: at + 5 },
    literalOf('fallthrough', 2),
    { kind: 'global-write', name: 'R', source: 2 },
    { kind: 'jump', target: at + 7 },
    literalOf('branch', 2),
    { kind: 'global-write', name: 'R', source: 2 },
    literalOf(undefined, 2),
    { kind: 'return', source: 2 },
  ]
}

export const armOrder = (output) =>
  output.indexOf('"fallthrough"') < output.indexOf('"branch"')
    ? ['fallthrough', 'branch']
    : ['branch', 'fallthrough']

// Loops in the compiler's layout: i is r0, N r1, S r4; a compare into r2, the literal 1 into r3.
export const add1 = [
  literalOf(1, 3),
  {
    kind: 'assign',
    destination: 0,
    value: { kind: 'binary', operator: '+', left: 0, right: 3 },
  },
]

export const compareInto = (destination, operator, left, right) => ({
  kind: 'assign',
  destination,
  value: { kind: 'binary', operator, left, right },
})

export const loopEndOps = [
  { kind: 'global-write', name: 'RESULT', source: 0 },
  literalOf(undefined, 3),
  { kind: 'return', source: 3 },
]

// `function f(x, g) { switch (x) { case 1: A = 'a'; case 2: B = 'b'; } <after> } f(X, G);` in the
// compiler's layout: the discriminant is the parameter r0, `g` is r1 (passed only with `withG`), each
// case value is loaded into r3 and each test's compare written to r2. `after` adds operations after the switch, `value2` replaces
// case 2's value load. `captured` adds, after the switch, a closure capturing the compares'
// register: a child function that returns it.
export function switchInFunction({
  after = [],
  value2 = null,
  withG = false,
  captured = false,
} = {}) {
  const base = withG ? 6 : 5
  const value2Ops = value2 ?? [literalOf(2, 3)]
  const shift = value2Ops.length - 1
  const at = (offset) => base + offset + (offset >= 5 ? shift : 0)
  const compare = {
    kind: 'assign',
    destination: 2,
    value: { kind: 'binary', operator: '===', left: 0, right: 3 },
  }
  // Its entry is the child's, placed after this function's cases.
  const closure = captured
    ? {
        kind: 'closure',
        destination: 3,
        entry: null,
        captures: [{ kind: 'local', index: 2 }],
      }
    : null
  const fn = [
    literalOf(1, 3),
    compare,
    { kind: 'branch', condition: 2, when: 'false', target: at(4) },
    { kind: 'jump', target: at(9) },
    ...value2Ops,
    compare,
    { kind: 'branch', condition: 2, when: 'false', target: at(8) },
    { kind: 'jump', target: at(11) },
    { kind: 'jump', target: at(13) },
    literalOf('a', 3),
    { kind: 'global-write', name: 'A', source: 3 },
    literalOf('b', 3),
    { kind: 'global-write', name: 'B', source: 3 },
    ...after,
    ...(closure ? [closure] : []),
    literalOf(undefined, 3),
    { kind: 'return', source: 3 },
  ]
  const childEntry = base + fn.length
  if (closure) closure.entry = childEntry
  const model = casesOf(
    [
      { kind: 'closure', destination: 0, entry: base, captures: [] },
      { kind: 'global-read', destination: 1, name: 'X' },
      ...(withG ? [{ kind: 'global-read', destination: 3, name: 'G' }] : []),
      {
        kind: 'call',
        mode: 'apply',
        destination: 2,
        receiver: { kind: 'none' },
        callee: 0,
        arguments: { kind: 'fixed', registers: withG ? [1, 3] : [1] },
      },
      literalOf(undefined, 3),
      { kind: 'return', source: 3 },
    ],
    4,
  )
  const registerCount = 4
  model.storage.functions.push({ id: 1, registerCount, captureCount: 0 })
  model.functions.functions.push({
    id: 1,
    startPc: base,
    regCount: registerCount,
    paramCount: withG ? 2 : 1,
    captureCount: 0,
    hasRest: false,
  })
  model.instructionsByFunction.set(
    1,
    fn.map((operation, index) => ({
      pc: base + index,
      nextPc: base + index + 1,
      operation,
    })),
  )
  model.instructionCount = base + fn.length
  if (captured) {
    model.storage.functions.push({ id: 2, registerCount: 1, captureCount: 1 })
    model.functions.functions.push({
      id: 2,
      startPc: childEntry,
      regCount: 1,
      paramCount: 0,
      captureCount: 1,
      hasRest: false,
    })
    model.instructionsByFunction.set(2, [
      {
        pc: childEntry,
        nextPc: childEntry + 1,
        operation: { kind: 'upvalue-read', destination: 0, index: 0 },
      },
      {
        pc: childEntry + 1,
        nextPc: childEntry + 2,
        operation: { kind: 'return', source: 0 },
      },
    ])
    model.instructionCount = childEntry + 2
  }
  return model
}

// Run a program once per X; return the globals it wrote.
export function runSwitch(output, names, xs) {
  return xs.map((X) => {
    const context = { X }
    for (const name of names) context[name] = null
    context.globalThis = context
    runSource(output, context)
    return names.map((name) => context[name])
  })
}

// Run `output` once per [globals, expected] row; each row lists the globals the program writes.
export function runRoutes(output, names, rows) {
  for (const [inputs, written] of rows) {
    const context = { ...inputs }
    for (const name of names) context[name] = null
    context.globalThis = context
    runSource(output, context)
    expect(names.filter((name) => context[name] !== null)).toEqual(written)
  }
}
