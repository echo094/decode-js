import { test, expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { emitVmSwitchProgram } from '../../../src/vm/switch/vm-switch-to-source.js'

function runSource(source, context) {
  return runInNewContext(source, context, { timeout: 1000 })
}

function sourceSwitchModel() {
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

function withCases(cases, registerCount) {
  const model = sourceSwitchModel()
  model.storage.functions[0].registerCount = registerCount
  model.functions.functions[0].regCount = registerCount
  model.instructionsByFunction.set(0, cases)
  model.instructionCount = cases.length
  return model
}

test.each(['structured', 'dispatch'])(
  '%s: DEBUGGER emits no statement and preserves the following effect',
  (mode) => {
    const operations = [
      { kind: 'assign', destination: 0, value: { kind: 'literal', value: 7 } },
      { kind: 'debugger' },
      { kind: 'global-write', name: 'RESULT', source: 0 },
      { kind: 'return', source: 0 },
    ]
    const model = withCases(
      operations.map((operation, pc) => ({ pc, nextPc: pc + 1, operation })),
      1,
    )
    const { output } = emitVmSwitchProgram(model, {
      dispatch: mode === 'dispatch',
    })
    expect(output).not.toContain('debugger;')
    expect(output).not.toContain('void 0;')
    expect(output.includes('__recovered_dispatch')).toBe(mode === 'dispatch')
    const context = { RESULT: null }
    context.globalThis = context
    runSource(output, context)
    expect(context.RESULT).toBe(7)
  },
)

// One case per operation, each falling through to the next PC.
function casesOf(operations, registerCount) {
  return withCases(
    operations.map((operation, pc) => ({ pc, nextPc: pc + 1, operation })),
    registerCount,
  )
}

// Run the program; return RESULT, the copy proofs and the declared and used registers.
function emitCopies(model) {
  const { output, simplification } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
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
    copies: simplification.functions[0].copies,
    declared: names([declaration]),
    used: names(body),
  }
}

// var w = 140; var d = w; (js-confuser-vm default options: LOAD_CONST, MOVE w, MOVE d = w).
// Both moves coalesce: the second move's producer is the first move, so the chain resolves to
// one write of the final register at the retained root.
const chain = [
  { kind: 'assign', destination: 0, value: { kind: 'literal', value: 140 } },
  { kind: 'assign', destination: 1, value: { kind: 'register', index: 0 } },
  { kind: 'assign', destination: 2, value: { kind: 'register', index: 1 } },
  { kind: 'global-write', name: 'RESULT', source: 2 },
  { kind: 'return', source: 2 },
]
const chainRows = (root, links) =>
  links.map(([producerPc, movePc, sourceRegister]) => ({
    producerPc: root,
    movePc,
    sourceRegister,
    destinationRegister: 2,
    reachingDefinitions: [String(producerPc)],
  }))
const row = ({
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

test.each([
  [
    'across blocks',
    chain,
    0,
    [
      [0, 1, 0],
      [1, 2, 1],
    ],
  ],
  // The root is laid out after its move and reaches it through a jump step, so the later
  // link (1 -> 2) is planned before the earlier one (5 -> 1), as in VM-1 vm-full.
  [
    'in reverse visit order through jump steps',
    [
      { kind: 'jump', target: 5 },
      chain[1],
      chain[2],
      chain[3],
      chain[4],
      chain[0],
      { kind: 'jump', target: 1 },
    ],
    5,
    [
      [1, 2, 1],
      [5, 1, 0],
    ],
  ],
])(
  'a copy chain %s resolves to one write of its final register',
  (_, operations, root, links) => {
    const emitted = emitCopies(casesOf(operations, 3))
    expect(emitted.result).toBe(140)
    expect(emitted.copies.map(row)).toEqual(chainRows(root, links))
    const removed = new Set(emitted.copies.map(({ movePc }) => movePc))
    expect(
      emitted.copies.some(({ producerPc }) => removed.has(producerPc)),
    ).toBe(false)
    expect(emitted.output).toContain('__recovered_r_0_2 = 140;')
    expect(emitted.declared).toEqual(emitted.used)
    expect(emitted.declared).not.toContain('__recovered_r_0_1')
  },
)

test('a single copy still coalesces into its producer', () => {
  const operations = [
    { kind: 'assign', destination: 0, value: { kind: 'literal', value: 140 } },
    { kind: 'assign', destination: 1, value: { kind: 'register', index: 0 } },
    { kind: 'global-write', name: 'RESULT', source: 1 },
    { kind: 'return', source: 1 },
  ]
  const emitted = emitCopies(casesOf(operations, 2))
  expect(emitted.result).toBe(140)
  expect(emitted.copies.map(row)).toEqual([
    {
      producerPc: 0,
      movePc: 1,
      sourceRegister: 0,
      destinationRegister: 1,
      reachingDefinitions: ['0'],
    },
  ])
  expect(emitted.output).toContain('__recovered_r_0_1 = 140;')
  expect(emitted.declared).toEqual(emitted.used)
})

test('declines a throw after handler pop, which is not a transfer', () => {
  const operations = [
    { kind: 'catch-setup', target: 4, exceptionRegister: 0 },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 7 } },
    { kind: 'handler-pop' },
    { kind: 'throw', source: 1 },
    { kind: 'global-write', name: 'CAUGHT', source: 0 },
    { kind: 'return', source: 0 },
  ]
  const model = casesOf(operations, 2)
  // After TRY_END the code is no longer protected but would sit inside the native try
  // block; the compiler only places transfers there, so anything else declines.
  expect(() => emitVmSwitchProgram(model)).toThrowError(/is not a transfer/)
})

test('declines an effect after handler pop, which is not a transfer', () => {
  const operations = [
    { kind: 'assign', destination: 0, value: { kind: 'literal', value: 9 } },
    { kind: 'catch-setup', target: 6, exceptionRegister: 1 },
    { kind: 'assign', destination: 2, value: { kind: 'literal', value: 7 } },
    { kind: 'handler-pop' },
    { kind: 'global-write', name: 'RESULT', source: 0 },
    { kind: 'return', source: 2 },
    { kind: 'return', source: 1 },
  ]
  const model = casesOf(operations, 3)
  // After TRY_END the code is no longer protected but would sit inside the native try
  // block; the compiler only places transfers there, so anything else declines.
  expect(() => emitVmSwitchProgram(model)).toThrowError(/is not a transfer/)
})

test('declines normal-completion work after handler pop', () => {
  const operations = [
    { kind: 'assign', destination: 0, value: { kind: 'literal', value: 9 } },
    { kind: 'catch-setup', target: 6, exceptionRegister: 1 },
    { kind: 'global-write', name: 'BODY', source: 0 },
    { kind: 'handler-pop' },
    { kind: 'global-write', name: 'NORMAL', source: 0 },
    { kind: 'jump', target: 7 },
    { kind: 'global-write', name: 'CAUGHT', source: 1 },
    { kind: 'global-write', name: 'RESULT', source: 0 },
    { kind: 'return', source: 0 },
  ]
  const model = casesOf(operations, 2)
  // The normal completion's work between TRY_END and its jump is not compiler grammar.
  expect(() => emitVmSwitchProgram(model)).toThrowError(/is not a transfer/)
})

test('emits a source-switch model without numeric wordcode', () => {
  const model = sourceSwitchModel()
  const { output } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(7)
  expect(output).not.toContain('BYTECODE')
  expect(output).not.toContain('__recovered_dispatch')
})

test('retains a catch dispatch when a typed case installs a handler', () => {
  const model = withCases(
    [
      {
        pc: 0,
        nextPc: 1,
        operation: { kind: 'catch-setup', target: 3, exceptionRegister: 0 },
      },
      {
        pc: 1,
        nextPc: 2,
        operation: {
          kind: 'assign',
          destination: 1,
          value: { kind: 'literal', value: 'boom' },
        },
      },
      { pc: 2, nextPc: 3, operation: { kind: 'throw', source: 1 } },
      {
        pc: 3,
        nextPc: 4,
        operation: { kind: 'global-write', name: 'RESULT', source: 0 },
      },
      { pc: 4, nextPc: 5, operation: { kind: 'return', source: 0 } },
    ],
    2,
  )
  const { output } = emitVmSwitchProgram(model, { dispatch: true })
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe('boom')
  expect(output).toContain('catch (__recovered_error)')
  expect(output).toContain('switch (__recovered_handler.register)')
})
