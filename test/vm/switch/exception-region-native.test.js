import { expect, test } from 'vitest'
import { runInNewContext } from 'node:vm'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expectConsistentState } from '../../helper.js'
import { validateVmSwitchModel } from '../../../src/vm/switch/vm-switch-model.js'
import { emitVmSwitchProgram } from '../../../src/vm/switch/vm-switch-to-source.js'
import { proveCatchFinallyRegion } from '../../../src/vm/switch/vm-switch-exception-region.js'
import {
  nativeExceptionRegionModel,
  nativeModelSnapshot,
} from './exception-region-native-model.js'

const VM_TIMEOUT_MS = 1000

function outsideCarrierRefusal() {
  const model = nativeExceptionRegionModel({ outsideCarrier: true })
  const before = nativeModelSnapshot(model)
  expect(validateVmSwitchModel(model)).toBe(model)
  expect(() => emitVmSwitchProgram(model)).toThrowError(
    /captured completion registers/,
  )
  expect(nativeModelSnapshot(model)).toBe(before)
  // This unsupported model is parser data and never reaches the VM runner.
}

function publish() {
  outsideCarrierRefusal()
  const model = nativeExceptionRegionModel()
  const before = nativeModelSnapshot(model)
  const blocks = model.controlByFunction.get(1).blocks
  const plan = proveCatchFinallyRegion(
    {
      functionId: 1,
      instructions: model.instructionsByFunction.get(1),
      blocks,
      edgeById: new Map(
        model.structuredControl.edges.map((edge) => [edge.id, edge]),
      ),
    },
    blocks.find(({ startPc }) => startPc === 100),
  )
  expect(new Set(plan.owned.map(({ id }) => id)).size).toBe(blocks.length)
  expect(plan.owned.filter(({ startPc }) => startPc === 401)).toHaveLength(1)
  const { output, simplification } = emitVmSwitchProgram(model)
  expect(output).not.toMatch(/__recovered_(?:pc|dispatch|handlers)/)
  expect(output).toContain('catch (__recovered_error)')
  expect(output).toContain('} finally {')
  expect(output).toContain('__recovered_r_1_10 = __recovered_r_1_3;')
  expect(output).toContain('__recovered_r_1_8 = "right";')
  expect(output).not.toContain('__recovered_r_1_9 = "right";')
  expect(
    simplification.functions.find(({ functionId }) => functionId === 1).copies,
  ).toContainEqual(
    expect.objectContaining({
      producerPc: 120,
      movePc: 121,
      sourceRegister: 9,
      destinationRegister: 8,
    }),
  )
  const ast = parse(output)
  let nativeFinally = 0,
    joinReferences = 0
  traverse(ast, {
    TryStatement(path) {
      if (path.node.finalizer) nativeFinally++
    },
    StringLiteral(path) {
      if (path.node.value === 'join') joinReferences++
    },
  })
  expect(nativeFinally).toBe(1)
  expect(joinReferences).toBe(1)
  expectConsistentState(ast, output)
  expect(nativeModelSnapshot(model)).toBe(before)
  return output
}

// Expected traces below are authored independently of the typed model. Host
// callbacks only record effects and return/throw fixed values; no oracle is
// inferred from emitted text or from another implementation of the VM.
function fixedHost(branch, options = {}) {
  const trace = []
  const errors = {
    body: new SyntaxError('body getter'),
    catchGetter: new TypeError('catch getter'),
    catchCall: new Error('catch call'),
    finalizer: new RangeError('finalizer call'),
  }
  const host = {
    join(value) {
      trace.push(['join', value, this === host])
    },
    get body() {
      trace.push('body:get')
      if (options.bodyThrows) throw errors.body
      return 0
    },
    get method() {
      trace.push('method:get')
      return function (value) {
        trace.push(['method', this === host, value])
        return 100
      }
    },
    get argument() {
      trace.push('argument:get')
      return 7
    },
    get catch() {
      trace.push('catch:get')
      if (options.catchGetterThrows) throw errors.catchGetter
      return function (value) {
        trace.push(['catch', this === host, value === errors.body])
        if (options.catchCallThrows) throw errors.catchCall
        return 200
      }
    },
  }
  const context = {
    HOST: host,
    BRANCH: branch,
    TRY_INCREMENT(value) {
      trace.push(['try:increment', value])
    },
    CATCH_INCREMENT(value) {
      trace.push(['catch:increment', value])
    },
    FINALIZE(value) {
      trace.push(['finally', value])
      if (options.finalizerThrows) throw errors.finalizer
    },
  }
  context.globalThis = context
  return { context, trace, errors }
}

function observe(branch, options) {
  const output = publish(),
    host = fixedHost(branch, options)
  let thrown = null
  try {
    runInNewContext(
      `${output}\nglobalThis.RESULT = globalThis.REGION(globalThis.BRANCH);`,
      host.context,
      { timeout: VM_TIMEOUT_MS },
    )
  } catch (error) {
    thrown = error
  }
  // Read the actual captured cell through its published closure, also bounded.
  const capture = runInNewContext('globalThis.GET_CAPTURE()', host.context, {
    timeout: VM_TIMEOUT_MS,
  })
  return { ...host, thrown, capture, result: host.context.RESULT }
}

test('outside-region completion carrier capture declines before any native invocation', () => {
  outsideCarrierRefusal()
})

test('supported regional publication proves shared ownership and copy state without evaluation', () => {
  expect(publish()).toContain('} finally {')
})

test.each([false, true])(
  'normal branch %s joins once and returns the captured increment before finally',
  (branch) => {
    const actual = observe(branch)
    expect(actual.trace).toEqual([
      ['join', branch ? 'right' : 'left', true],
      'body:get',
      'method:get',
      'argument:get',
      ['method', true, 7],
      ['try:increment', 1],
      ['finally', 11],
    ])
    expect(actual.thrown).toBe(null)
    expect(actual.result).toBe(1)
    expect(actual.capture).toBe(11)
  },
)

test.each([false, true])(
  'body getter exception on branch %s reaches the catch value and shared return pad',
  (branch) => {
    const actual = observe(branch, { bodyThrows: true })
    expect(actual.trace).toEqual([
      ['join', branch ? 'right' : 'left', true],
      'body:get',
      'catch:get',
      ['catch', true, true],
      ['catch:increment', 1],
      ['finally', 11],
    ])
    expect(actual.thrown).toBe(null)
    expect(actual.result).toBe(1)
    expect(actual.capture).toBe(11)
  },
)

test('catch getter exception bypasses catch and propagates after finally', () => {
  const actual = observe(false, { bodyThrows: true, catchGetterThrows: true })
  expect(actual.trace).toEqual([
    ['join', 'left', true],
    'body:get',
    'catch:get',
    ['finally', 10],
  ])
  expect(actual.thrown).toBe(actual.errors.catchGetter)
  expect(actual.result).toBeUndefined()
  expect(actual.capture).toBe(10)
})

test('catch call exception propagates through finally without performing its return increment', () => {
  const actual = observe(true, { bodyThrows: true, catchCallThrows: true })
  expect(actual.trace).toEqual([
    ['join', 'right', true],
    'body:get',
    'catch:get',
    ['catch', true, true],
    ['finally', 10],
  ])
  expect(actual.thrown).toBe(actual.errors.catchCall)
  expect(actual.result).toBeUndefined()
  expect(actual.capture).toBe(10)
})

test('finalizer call exception replaces a pending normal return', () => {
  const actual = observe(true, { finalizerThrows: true })
  expect(actual.trace).toEqual([
    ['join', 'right', true],
    'body:get',
    'method:get',
    'argument:get',
    ['method', true, 7],
    ['try:increment', 1],
    ['finally', 11],
  ])
  expect(actual.thrown).toBe(actual.errors.finalizer)
  expect(actual.result).toBeUndefined()
  expect(actual.capture).toBe(11)
})

test('finalizer call exception replaces a pending caught-call throw', () => {
  const actual = observe(false, {
    bodyThrows: true,
    catchCallThrows: true,
    finalizerThrows: true,
  })
  expect(actual.trace).toEqual([
    ['join', 'left', true],
    'body:get',
    'catch:get',
    ['catch', true, true],
    ['finally', 10],
  ])
  expect(actual.thrown).toBe(actual.errors.finalizer)
  expect(actual.thrown).not.toBe(actual.errors.catchCall)
  expect(actual.result).toBeUndefined()
  expect(actual.capture).toBe(10)
})
