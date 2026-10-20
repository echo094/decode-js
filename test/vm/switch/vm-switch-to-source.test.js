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
  return linearPlan({
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
  })
}

// A structured plan of one block per case: each falls through, or returns or throws.
function linearPlan(model) {
  const cases = model.instructionsByFunction.get(0)
  const edges = cases.map(({ pc, nextPc, operation }) => {
    const terminal = ['throw', 'return'].includes(operation.kind)
    return {
      id: `edge:${pc}`,
      functionId: 0,
      sourcePc: pc,
      targetPc: terminal ? null : nextPc,
      kind: terminal ? operation.kind : 'fallthrough',
    }
  })
  model.structuredControl = { edges }
  model.controlByFunction = new Map([
    [
      0,
      {
        mode: 'structured',
        control: { kind: 'structured' },
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
  return model
}

function withCases(cases, registerCount) {
  const model = sourceSwitchModel()
  model.code.instructionCount = cases.length
  model.storage.functions[0].registerCount = registerCount
  model.functions.functions[0].regCount = registerCount
  model.instructionsByFunction.set(0, cases)
  model.instructionCount = cases.length
  return linearPlan(model)
}

test.each(['structured', 'state-machine'])(
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
    if (mode === 'state-machine') {
      model.controlByFunction = new Map([[0, { mode }]])
      model.structuredControl = { edges: [] }
    }
    const { output } = emitVmSwitchProgram(model)
    expect(output).not.toContain('debugger;')
    expect(output).not.toContain('void 0;')
    expect(output.includes('__recovered_dispatch')).toBe(
      mode === 'state-machine',
    )
    const context = { RESULT: null }
    context.globalThis = context
    runSource(output, context)
    expect(context.RESULT).toBe(7)
  },
)

test('declines a throw after handler pop, which is not a transfer', () => {
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
        control: { kind: 'structured' },
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
        control: { kind: 'structured' },
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
        control: { kind: 'structured' },
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
  // The normal completion's work between TRY_END and its jump is not compiler grammar.
  expect(() => emitVmSwitchProgram(model)).toThrowError(/is not a transfer/)
})

test('emits a source-switch model without numeric wordcode', () => {
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
