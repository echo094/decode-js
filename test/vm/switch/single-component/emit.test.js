import { test, expect } from 'vitest'
import { emitVmSwitchProgram } from '../../../../src/vm/switch/to-source.js'
import {
  runSource,
  sourceSwitchModel,
  withCases,
  casesOf,
  twoArmed,
  armOrder,
} from './models.js'

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

test.each([
  // The compiler's `if (C) A else B`: the predicate is written as the source wrote it.
  ['jump-if-false', 'false', [], 'if (C) {', ['fallthrough', 'branch']],
  // Already positive: the branch target's arm stays first.
  ['jump-if-true', 'true', [], 'if (C) {', ['branch', 'fallthrough']],
  // `if (!C) A else B`: the source's own negation stays.
  [
    'a negated test',
    'false',
    [
      {
        kind: 'assign',
        destination: 1,
        value: { kind: 'unary', operator: '!', source: 0 },
      },
    ],
    'if (!C) {',
    ['fallthrough', 'branch'],
  ],
])(
  'a two-armed conditional is written with its positive test first: %s',
  (name, when, prefix, head, order) => {
    const model = casesOf(twoArmed(when, prefix), 3)
    expect(model.instructionCount).toBe(prefix.length + 9)
    const { output } = emitVmSwitchProgram(model)
    expect(output).toContain(head)
    expect(output).toContain('} else {')
    expect(armOrder(output)).toEqual(order)
  },
)

test('a two-armed conditional runs the arm its test selects', () => {
  for (const [when, C, expected] of [
    ['false', true, 'fallthrough'],
    ['false', false, 'branch'],
    ['true', true, 'branch'],
    ['true', false, 'fallthrough'],
  ]) {
    const { output } = emitVmSwitchProgram(casesOf(twoArmed(when), 3))
    const context = { C, R: null }
    context.globalThis = context
    runSource(output, context)
    expect(context.R).toBe(expected)
  }
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

test('a finalizer that never completes leaves its resume unreachable and stays native', () => {
  // The compiler's `try { } finally { RESULT = 2; return 2; }`: the resume after the finalizer's
  // return, the throw pad and after_finally are unreachable, yet the resume is the region's own.
  const operations = [
    {
      kind: 'finally-setup',
      target: 4,
      continuation: 1,
      payload: 2,
      throwPad: 8,
    },
    { kind: 'handler-pop' },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 9 } },
    { kind: 'jump', target: 4 },
    { kind: 'assign', destination: 3, value: { kind: 'literal', value: 2 } },
    { kind: 'global-write', name: 'RESULT', source: 3 },
    { kind: 'return', source: 3 },
    { kind: 'indirect-jump', source: 1 },
    { kind: 'throw', source: 2 },
    { kind: 'assign', destination: 3, value: { kind: 'literal', value: 0 } },
    { kind: 'return', source: 3 },
  ]
  const { output, simplification } = emitVmSwitchProgram(casesOf(operations, 4))
  expect(output).toMatch(/try \{\s*\} finally \{/)
  // The resume, the throw pad and after_finally are dropped, not rendered.
  expect(output).not.toMatch(/if \(false\)/)
  expect(simplification.summary.provenUnreachable).toBe(4)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(2)
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
