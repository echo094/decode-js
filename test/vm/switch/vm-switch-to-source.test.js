import { test, expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { emitVmSwitchProgram } from '../../../src/vm/switch/vm-switch-to-source.js'
import { validateVmSwitchModel } from '../../../src/vm/switch/vm-switch-model.js'

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
    code: { kind: 'source-switch', instructionCount: 3 },
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
  model.code.instructionCount = cases.length
  model.storage.functions[0].registerCount = registerCount
  model.functions.functions[0].regCount = registerCount
  model.instructionsByFunction.set(0, cases)
  model.instructionCount = cases.length
  return model
}

test('keeps a terminal throw after handler pop outside the recovered catch', () => {
  const operations = [
    { kind: 'catch-setup', target: 4, exceptionRegister: 0 },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 7 } },
    { kind: 'handler-pop' },
    { kind: 'throw', source: 1 },
    { kind: 'global-write', name: 'CAUGHT', source: 0 },
    { kind: 'return', source: 0 },
  ]
  const cases = operations.map((operation, pc) => ({
    pc,
    nextPc: pc + 1,
    operation,
  }))
  const edges = cases.map(({ pc, nextPc, operation }) => ({
    id: `edge:${pc}`,
    functionId: 0,
    sourcePc: pc,
    targetPc: ['throw', 'return'].includes(operation.kind) ? null : nextPc,
    kind: ['throw', 'return'].includes(operation.kind)
      ? operation.kind
      : 'fallthrough',
  }))
  const model = withCases(cases, 2)
  model.structuredControl = { edges }
  model.controlByFunction = new Map([
    [
      0,
      {
        mode: 'structured',
        control: { regions: [] },
        blocks: cases.map((item) => ({
          id: `0:b@${item.pc}`,
          functionId: 0,
          startPc: item.pc,
          leaves: [{ ...item, reachable: true }],
          successorEdgeIds: [`edge:${item.pc}`],
        })),
      },
    ],
  ])
  const { output } = emitVmSwitchProgram(model)
  const context = { CAUGHT: null }
  context.globalThis = context
  let thrown
  try {
    runSource(output, context)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBe(7)
  expect(context.CAUGHT).toBe(null)
})

test('emits grouped leaves on both sides of a catch boundary', () => {
  const operations = [
    { kind: 'assign', destination: 0, value: { kind: 'literal', value: 9 } },
    { kind: 'catch-setup', target: 6, exceptionRegister: 1 },
    { kind: 'assign', destination: 2, value: { kind: 'literal', value: 7 } },
    { kind: 'handler-pop' },
    { kind: 'global-write', name: 'RESULT', source: 0 },
    { kind: 'return', source: 2 },
    { kind: 'return', source: 1 },
  ]
  const cases = operations.map((operation, pc) => ({
    pc,
    nextPc: pc + 1,
    operation,
  }))
  const groups = [[0, 1], [2, 3], [4], [5], [6]]
  const edges = groups.map((pcs) => {
    const last = cases[pcs.at(-1)]
    return {
      id: `edge:${last.pc}`,
      functionId: 0,
      sourcePc: last.pc,
      targetPc: last.operation.kind === 'return' ? null : last.nextPc,
      kind: last.operation.kind === 'return' ? 'return' : 'fallthrough',
    }
  })
  const model = withCases(cases, 3)
  model.structuredControl = { edges }
  model.controlByFunction = new Map([
    [
      0,
      {
        mode: 'structured',
        control: { regions: [] },
        blocks: groups.map((pcs) => ({
          id: `0:b@${pcs[0]}`,
          functionId: 0,
          startPc: pcs[0],
          leaves: pcs.map((pc) => ({ ...cases[pc], reachable: true })),
          successorEdgeIds: [`edge:${pcs.at(-1)}`],
        })),
      },
    ],
  ])
  const { output } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(9)
  expect(output).toContain(' = 7;')
})

test.each([false, true])(
  'keeps grouped normal continuation leaves exclusive to normal completion (%s)',
  (throws) => {
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
    const cases = operations.map((operation, pc) => ({
      pc,
      nextPc: pc + 1,
      operation,
    }))
    const groups = [[0, 1], [2, 3], [4, 5], [6], [7, 8]]
    const edges = groups.map((pcs) => {
      const last = cases[pcs.at(-1)]
      return {
        id: `edge:${last.pc}`,
        functionId: 0,
        sourcePc: last.pc,
        targetPc:
          last.operation.kind === 'return'
            ? null
            : last.operation.kind === 'jump'
              ? last.operation.target
              : last.nextPc,
        kind: ['return', 'jump'].includes(last.operation.kind)
          ? last.operation.kind
          : 'fallthrough',
      }
    })
    const model = withCases(cases, 2)
    model.structuredControl = { edges }
    model.controlByFunction = new Map([
      [
        0,
        {
          mode: 'structured',
          control: { regions: [] },
          blocks: groups.map((pcs) => ({
            id: `0:b@${pcs[0]}`,
            functionId: 0,
            startPc: pcs[0],
            leaves: pcs.map((pc) => ({ ...cases[pc], reachable: true })),
            successorEdgeIds: [`edge:${pcs.at(-1)}`],
          })),
        },
      ],
    ])
    const { output } = emitVmSwitchProgram(model)
    const context = { NORMAL: null, CAUGHT: null, RESULT: null }
    Object.defineProperty(context, 'BODY', {
      set() {
        if (throws) throw 42
      },
    })
    context.globalThis = context
    runSource(output, context)
    expect(context.NORMAL).toBe(throws ? null : 9)
    expect(context.CAUGHT).toBe(throws ? 42 : null)
    expect(context.RESULT).toBe(9)
  },
)

test('derives linear control and emits a source-switch model without numeric wordcode', () => {
  const model = sourceSwitchModel()
  expect(validateVmSwitchModel(model)).toBe(model)
  const { output } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(7)
  expect(output).not.toContain('BYTECODE')
  expect(output).not.toContain('__recovered_dispatch')
})

test('derives a structured branch from typed source-switch cases', () => {
  const model = withCases(
    [
      {
        pc: 0,
        nextPc: 1,
        operation: {
          kind: 'assign',
          destination: 0,
          value: { kind: 'literal', value: true },
        },
      },
      {
        pc: 1,
        nextPc: 2,
        operation: { kind: 'branch', condition: 0, when: 'true', target: 4 },
      },
      {
        pc: 2,
        nextPc: 3,
        operation: {
          kind: 'assign',
          destination: 1,
          value: { kind: 'literal', value: 11 },
        },
      },
      { pc: 3, nextPc: 4, operation: { kind: 'jump', target: 5 } },
      {
        pc: 4,
        nextPc: 5,
        operation: {
          kind: 'assign',
          destination: 1,
          value: { kind: 'literal', value: 22 },
        },
      },
      {
        pc: 5,
        nextPc: 6,
        operation: { kind: 'global-write', name: 'RESULT', source: 1 },
      },
      { pc: 6, nextPc: 7, operation: { kind: 'return', source: 1 } },
    ],
    2,
  )
  const { output } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(22)
  expect(output).toContain('if (')
  expect(output).not.toContain('__recovered_dispatch')

  model.instructionsByFunction.get(0)[0].operation.value.value = false
  const falseContext = { RESULT: null }
  falseContext.globalThis = falseContext
  runSource(emitVmSwitchProgram(model).output, falseContext)
  expect(falseContext.RESULT).toBe(11)
})

test('derives control for a source-switch loop without a frontend region plan', () => {
  const model = withCases(
    [
      {
        pc: 0,
        nextPc: 1,
        operation: {
          kind: 'assign',
          destination: 0,
          value: { kind: 'literal', value: 3 },
        },
      },
      {
        pc: 1,
        nextPc: 2,
        operation: {
          kind: 'assign',
          destination: 1,
          value: { kind: 'literal', value: 0 },
        },
      },
      {
        pc: 2,
        nextPc: 3,
        operation: {
          kind: 'assign',
          destination: 2,
          value: { kind: 'literal', value: 1 },
        },
      },
      {
        pc: 3,
        nextPc: 4,
        operation: { kind: 'branch', condition: 0, when: 'false', target: 7 },
      },
      {
        pc: 4,
        nextPc: 5,
        operation: {
          kind: 'assign',
          destination: 1,
          value: { kind: 'binary', operator: '+', left: 1, right: 0 },
        },
      },
      {
        pc: 5,
        nextPc: 6,
        operation: {
          kind: 'assign',
          destination: 0,
          value: { kind: 'binary', operator: '-', left: 0, right: 2 },
        },
      },
      { pc: 6, nextPc: 7, operation: { kind: 'jump', target: 3 } },
      {
        pc: 7,
        nextPc: 8,
        operation: { kind: 'global-write', name: 'RESULT', source: 1 },
      },
      { pc: 8, nextPc: 9, operation: { kind: 'return', source: 1 } },
    ],
    3,
  )
  const { output } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(6)
  expect(output).not.toContain('__recovered_dispatch')
})

test('retains dispatch for an indirect transfer without a frontend control plan', () => {
  const model = withCases(
    [
      {
        pc: 0,
        nextPc: 1,
        operation: {
          kind: 'assign',
          destination: 0,
          value: { kind: 'literal', value: 2 },
        },
      },
      { pc: 1, nextPc: 2, operation: { kind: 'indirect-jump', source: 0 } },
      {
        pc: 2,
        nextPc: 3,
        operation: { kind: 'global-write', name: 'RESULT', source: 0 },
      },
      { pc: 3, nextPc: 4, operation: { kind: 'return', source: 0 } },
    ],
    1,
  )
  const { output } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(2)
  expect(output).toContain('__recovered_dispatch')
  expect(output).not.toContain('catch (__recovered_error)')
  expect(output).not.toContain('__recovered_handlers')
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
  model.controlByFunction = new Map([[0, { mode: 'state-machine' }]])
  model.structuredControl = { edges: [] }
  const { output } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe('boom')
  expect(output).toContain('catch (__recovered_error)')
  expect(output).toContain('switch (__recovered_handler.register)')
})

test('falls back to dispatch when typed branches have no structured merge', () => {
  const model = withCases(
    [
      {
        pc: 0,
        nextPc: 1,
        operation: {
          kind: 'assign',
          destination: 0,
          value: { kind: 'literal', value: true },
        },
      },
      {
        pc: 1,
        nextPc: 2,
        operation: { kind: 'branch', condition: 0, when: 'true', target: 3 },
      },
      { pc: 2, nextPc: 3, operation: { kind: 'return', source: 0 } },
      { pc: 3, nextPc: 4, operation: { kind: 'return', source: 0 } },
    ],
    1,
  )
  const { output } = emitVmSwitchProgram(model)
  expect(runSource(output, { globalThis: {} })).toBe(undefined)
  expect(output).toContain('__recovered_dispatch')
})

test('rejects malformed switch semantics before source emission', () => {
  const malicious = sourceSwitchModel()
  malicious.instructionsByFunction.get(0)[0].operation.value = {
    kind: 'binary',
    operator: '+;globalThis.RESULT=99;//',
    left: 0,
    right: 0,
  }
  expect(() => emitVmSwitchProgram(malicious)).toThrowError(/operator/i)

  const missingTarget = sourceSwitchModel()
  missingTarget.instructionsByFunction.get(0)[1].operation = {
    kind: 'jump',
    target: 99,
  }
  expect(() => emitVmSwitchProgram(missingTarget)).toThrowError(/missing case/i)

  const missingCase = sourceSwitchModel()
  missingCase.instructionsByFunction.get(0).pop()
  expect(() => emitVmSwitchProgram(missingCase)).toThrowError(/missing case/i)

  const unknownMode = sourceSwitchModel()
  unknownMode.controlByFunction = new Map([[0, { mode: 'unknown' }]])
  unknownMode.structuredControl = { edges: [] }
  expect(() => emitVmSwitchProgram(unknownMode)).toThrowError(/control mode/i)

  const missingEdge = sourceSwitchModel()
  missingEdge.controlByFunction = new Map([
    [
      0,
      {
        mode: 'structured',
        blocks: [
          {
            id: 'root',
            functionId: 0,
            leaves: missingEdge.instructionsByFunction.get(0),
            successorEdgeIds: ['missing'],
          },
        ],
      },
    ],
  ])
  missingEdge.structuredControl = { edges: [] }
  expect(() => emitVmSwitchProgram(missingEdge)).toThrowError(/invalid edge/i)
})
