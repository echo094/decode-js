import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expectConsistentState } from '../../helper.js'
import { validateVmSwitchModel } from '../../../src/vm/switch/vm-switch-model.js'
import { emitVmSwitchProgram } from '../../../src/vm/switch/vm-switch-to-source.js'
import { effectiveStructuredInstructions } from '../../../src/vm/switch/vm-switch-copy-planning.js'
import {
  exceptionRegionModel,
  regionProof,
  snapshot,
} from './exception-region-model.js'

function refusal(change, reason) {
  const model = exceptionRegionModel()
  change(model)
  const before = snapshot(model)
  expect(() => regionProof(model)).toThrowError(reason)
  expect(() => emitVmSwitchProgram(model)).toThrowError(reason)
  expect(snapshot(model)).toBe(before)
}
const edgeAt = (model, pc, kind) =>
  model.structuredControl.edges.find(
    (edge) => edge.sourcePc === pc && edge.kind === kind,
  )
const operationAt = (model, pc) =>
  model.instructionsByFunction.get(0).find((item) => item.pc === pc).operation
const blockAt = (model, pc) =>
  model.controlByFunction.get(0).blocks.find((item) => item.startPc === pc)

test('generic grouped diamond, branching catch/finalizer and shared joins have unique ownership', () => {
  const model = exceptionRegionModel(),
    before = snapshot(model)
  const plan = regionProof(model)
  expect(new Set(plan.owned.map(({ id }) => id)).size).toBe(plan.owned.length)
  expect(plan.owned).toHaveLength(model.controlByFunction.get(0).blocks.length)
  const { output, simplification } = emitVmSwitchProgram(model)
  const ast = parse(output)
  traverse(ast, {})
  expectConsistentState(ast, output)
  expect(output).not.toMatch(/__recovered_(?:pc|dispatch|handlers)/)
  expect(output.match(/globalThis\["SHARED"\]/g)).toHaveLength(1)
  expect(output.match(/globalThis\["FINAL"\]/g)).toHaveLength(1)
  expect(output).toContain('catch (__recovered_error)')
  expect(output).toContain('} finally {')
  expect(output).toContain('throw __recovered_r_0_3;')
  expect(output.indexOf('__recovered_r_0_5 = __recovered_r_0_2;')).toBeLessThan(
    output.indexOf('} finally {'),
  )
  expect(
    simplification.functions[0].copies.every(
      ({ destinationRegister }) => ![3, 4, 5].includes(destinationRegister),
    ),
  ).toBe(true)
  expect(snapshot(model)).toBe(before)
})

test('copy planning keeps implicit catch and completion definitions explicit', () => {
  const model = exceptionRegionModel(),
    control = model.controlByFunction.get(0)
  const effective = effectiveStructuredInstructions(
    0,
    model.instructionsByFunction.get(0),
    control,
    model.structuredControl.edges,
    10,
  )
  expect(effective.coalescedMovePcs.has(21)).toBe(false)
  expect(effective.coalescedMovePcs.has(91)).toBe(false)
  expect(
    effective.copyProofs.every(
      ({ sourceRegister, destinationRegister }) =>
        ![3, 4, 5].includes(sourceRegister) &&
        ![3, 4, 5].includes(destinationRegister),
    ),
  ).toBe(true)
})

test('generic shared return pad is owned once and needs only one resume return edge', () => {
  const model = exceptionRegionModel()
  operationAt(model, 92).value.value = 201
  const edge = edgeAt(model, 130, 'branch')
  model.structuredControl.edges = model.structuredControl.edges.filter(
    (item) => item.targetPc !== 202 || item.sourcePc !== 130,
  )
  blockAt(model, 130).successorEdgeIds = blockAt(
    model,
    130,
  ).successorEdgeIds.filter((id) =>
    model.structuredControl.edges.some((item) => item.id === id),
  )
  // The unused pad remains represented as dead input data.
  blockAt(model, 202).leaves[0].reachable = false
  const unused = edgeAt(model, 202, 'return')
  model.structuredControl.edges = model.structuredControl.edges.filter(
    (item) => item !== unused,
  )
  blockAt(model, 202).successorEdgeIds = []
  expect(edge).toBeDefined()
  expect(emitVmSwitchProgram(model).output).toContain('} finally {')
  expect(
    regionProof(model).owned.filter(({ startPc }) => startPc === 201),
  ).toHaveLength(1)
})

test('missing call exception route reaches effect-edge refusal', () =>
  refusal((model) => {
    const edge = edgeAt(model, 101, 'throw')
    model.structuredControl.edges = model.structuredControl.edges.filter(
      (item) => item !== edge,
    )
    blockAt(model, 101).successorEdgeIds = blockAt(
      model,
      101,
    ).successorEdgeIds.filter((id) => id !== edge.id)
  }, /effect edges at 101/))
test('inconsistent handler stack reaches edge-state refusal', () =>
  refusal((model) => {
    edgeAt(model, 15, 'handler').handlerStateAfter = {
      stack: [],
      finallyStack: [],
    }
  }, /edge state at 15/))
test('catch value routed to wrong register is refused', () =>
  refusal((model) => {
    edgeAt(model, 15, 'handler').payload.exceptionRegister = 2
  }, /catch route at 15/))
test('exceptional finalizer payload identity is checked', () =>
  refusal((model) => {
    edgeAt(model, 81, 'finally').payload = {
      ...edgeAt(model, 81, 'finally').payload,
      payloadRegister: 6,
    }
  }, /finally payload at 81/))
test('finalizer cannot observe pending payload', () =>
  refusal((model) => {
    operationAt(model, 111).source = 5
  }, /completion register used at 111/))
test('resume cannot omit the propagated-throw target', () =>
  refusal((model) => {
    const edge = model.structuredControl.edges.find(
      (edge) => edge.sourcePc === 130 && edge.targetPc === 200,
    )
    model.structuredControl.edges = model.structuredControl.edges.filter(
      (item) => item !== edge,
    )
    blockAt(model, 130).successorEdgeIds = blockAt(
      model,
      130,
    ).successorEdgeIds.filter((id) => id !== edge.id)
  }, /resume target census/))
test('normal cycles cannot masquerade as acyclic region structure', () =>
  refusal((model) => {
    operationAt(model, 11).target = 2
    edgeAt(model, 11, 'branch').targetPc = 2
  }, /cyclic try region at 2/))
test('shared route bypassing a lexical phase is refused', () =>
  refusal((model) => {
    operationAt(model, 11).target = 80
    const edge = edgeAt(model, 11, 'branch')
    edge.targetPc = 80
    edge.handlerStateAfter = blockAt(model, 80).handlerStateIn
  }, /edge state at 11/))
test('unlisted global edges cannot bypass successor inventories', () =>
  refusal((model) => {
    model.structuredControl.edges.push({
      ...edgeAt(model, 15, 'handler'),
      id: 'unlisted',
    })
  }, /unlisted edge at 15/))
test('grouped effectful calls require their own exception boundary', () =>
  refusal((model) => {
    Object.assign(operationAt(model, 12), operationAt(model, 101))
  }, /grouped effect boundary at 12/))

test('regional cross-block copy emission applies the retarget at the retained producer', () => {
  const model = exceptionRegionModel()
  operationAt(model, 10).destination = 6
  Object.assign(operationAt(model, 11), {
    kind: 'assign',
    destination: 8,
    value: { kind: 'register', index: 6 },
  })
  delete operationAt(model, 11).target
  edgeAt(model, 11, 'branch').kind = 'fallthrough'
  operationAt(model, 13).source = 8
  const { output, simplification } = emitVmSwitchProgram(model)
  expect(simplification.functions[0].copies).toContainEqual(
    expect.objectContaining({
      producerPc: 10,
      movePc: 11,
      sourceRegister: 6,
      destinationRegister: 8,
    }),
  )
  expect(output).toContain('__recovered_r_0_8 = "right";')
  expect(output).not.toContain('__recovered_r_0_6 = "right";')
  expect(output).not.toContain('__recovered_r_0_8 = __recovered_r_0_6;')
})
test('implicit catch destination is never treated as an ordinary removable copy definition', () => {
  const model = exceptionRegionModel()
  operationAt(model, 10).destination = 3
  Object.assign(operationAt(model, 11), {
    kind: 'assign',
    destination: 8,
    value: { kind: 'register', index: 3 },
  })
  delete operationAt(model, 11).target
  edgeAt(model, 11, 'branch').kind = 'fallthrough'
  operationAt(model, 13).source = 8
  const { output, simplification } = emitVmSwitchProgram(model)
  expect(
    simplification.functions[0].copies.some(
      ({ producerPc }) => producerPc === 10,
    ),
  ).toBe(false)
  expect(output).toContain('__recovered_r_0_3 = "right";')
  expect(output).toContain('__recovered_r_0_8 = __recovered_r_0_3;')
  expect(output).toContain('__recovered_r_0_3 = __recovered_error;')
})

test('completion carriers exposed by an outside closure cannot use native pending-completion storage', () => {
  const model = exceptionRegionModel()
  // Move the complete valid region behind a real closure-producing entry block.
  // The closure's child frame is a valid independent function capturing payload.
  const shiftState = (state) => {
    const result = structuredClone(state)
    for (const record of [...result.stack, ...result.finallyStack])
      for (const key of ['setupPc', 'finallyPc', 'throwPadPc', 'handlerPc'])
        if (Number.isSafeInteger(record[key])) record[key] += 1000
    return result
  }
  for (const item of model.instructionsByFunction.get(0)) {
    item.pc += 1000
    item.nextPc += 1000
    for (const key of ['target', 'throwPad'])
      if (Number.isSafeInteger(item.operation[key])) item.operation[key] += 1000
    if (item.operation.kind === 'assign' && item.operation.destination === 4)
      item.operation.value.value += 1000
  }
  for (const item of model.controlByFunction.get(0).blocks) {
    item.startPc += 1000
    item.endPc += 1000
    item.id = `0:b@${item.startPc}`
    item.handlerStateIn = shiftState(item.handlerStateIn)
    for (const leaf of item.leaves) {
      leaf.pc += 1000
      leaf.nextPc += 1000
    }
  }
  for (const edge of model.structuredControl.edges) {
    edge.sourcePc += 1000
    if (edge.targetPc !== null) edge.targetPc += 1000
    edge.handlerStateBefore = shiftState(edge.handlerStateBefore)
    edge.handlerStateAfter = shiftState(edge.handlerStateAfter)
    if (edge.kind === 'finally')
      edge.payload = { ...edge.payload, finallyPc: 1100, throwPadPc: 1200 }
  }
  const empty = { stack: [], finallyStack: [] }
  const prefix = {
    pc: 0,
    nextPc: 1000,
    operation: {
      kind: 'closure',
      destination: 9,
      entry: 2000,
      captures: [{ kind: 'local', index: 5 }],
    },
  }
  model.instructionsByFunction.get(0).unshift(prefix)
  model.controlByFunction.get(0).blocks.unshift({
    id: '0:b@0',
    functionId: 0,
    startPc: 0,
    endPc: 1000,
    leaves: [{ ...prefix, reachable: true }],
    handlerStateIn: empty,
    successorEdgeIds: ['prefix'],
  })
  model.structuredControl.edges.push({
    id: 'prefix',
    functionId: 0,
    sourcePc: 0,
    targetPc: 1000,
    kind: 'fallthrough',
    handlerStateBefore: empty,
    handlerStateAfter: empty,
  })
  model.functions.functions.push({
    id: 1,
    startPc: 2000,
    regCount: 1,
    paramCount: 0,
    captureCount: 1,
    hasRest: false,
  })
  model.storage.functions.push({ id: 1, registerCount: 1, captureCount: 1 })
  model.instructionsByFunction.set(1, [
    { pc: 2000, nextPc: 2001, operation: { kind: 'return', source: 0 } },
  ])
  model.controlByFunction.set(1, { mode: 'state-machine' })
  model.code.instructionCount += 2
  model.instructionCount += 2
  expect(() => validateVmSwitchModel(model)).not.toThrow()
  expect(() => regionProof(model, 0, 1000)).toThrowError(
    /captured completion registers/,
  )
  expect(() => emitVmSwitchProgram(model)).toThrowError(
    /captured completion registers/,
  )
})
test('explicit state-machine selection remains independent of regional proof', () => {
  const model = exceptionRegionModel()
  model.controlByFunction.set(0, { mode: 'state-machine' })
  const output = emitVmSwitchProgram(model).output
  expect(output).toContain('__recovered_dispatch: while (true)')
  expect(output).toContain('const __recovered_handlers = []')
  expect(() => parse(output)).not.toThrow()
})

test('generic normal return continuation must be literal', () =>
  refusal((model) => {
    operationAt(model, 22).value = { kind: 'register', index: 2 }
  }, /return continuation at 22/))
test('generic terminal throw pad must read its protected payload', () =>
  refusal((model) => {
    operationAt(model, 200).source = 2
  }, /throw pad payload/))
test('generic finalizer resume must read its continuation', () =>
  refusal((model) => {
    operationAt(model, 130).source = 5
  }, /finalizer resume at 130/))
test('generic finalizer exception must propagate instead of reentering catch', () =>
  refusal((model) => {
    const edge = edgeAt(model, 101, 'throw')
    edge.kind = 'handler'
    edge.targetPc = 80
  }, /finalizer propagation at 101/))
test('generic grouped leaf adjacency is proved before rendering', () =>
  refusal((model) => {
    blockAt(model, 12).leaves[0].nextPc = 14
  }, /block inventory at 12/))
test('generic supplied duplicate successors cannot change the route census', () =>
  refusal((model) => {
    blockAt(model, 2).successorEdgeIds.push(
      blockAt(model, 2).successorEdgeIds[0],
    )
  }, /edge inventory at 2/))

// Off-target control: the catch body's throw at PC 81 becomes a call that
// completes normally to 90 and whose exceptional edge carries no throw value.
function catchCallModel(throwRegister) {
  const model = exceptionRegionModel()
  const item = model.instructionsByFunction.get(0).find(({ pc }) => pc === 81)
  item.operation = {
    kind: 'call',
    mode: 'apply',
    destination: 8,
    callee: 7,
    receiver: { kind: 'register', index: 1 },
    arguments: { kind: 'fixed', registers: [3] },
  }
  item.nextPc = 90
  const block = blockAt(model, 81)
  block.leaves = [{ ...item, reachable: true }]
  const exceptional = edgeAt(model, 81, 'finally')
  exceptional.payload = { ...exceptional.payload, throwRegister }
  const normal = {
    ...exceptional,
    id: 'generic:call@81',
    kind: 'call',
    targetPc: 90,
    route: 'direct',
    payload: null,
    handlerStateAfter: exceptional.handlerStateBefore,
  }
  model.structuredControl.edges.push(normal)
  block.successorEdgeIds = [...block.successorEdgeIds, normal.id]
  return model
}

test('a call in the catch body routes its exceptional edge without a throw value', () => {
  const model = catchCallModel(null),
    before = snapshot(model)
  expect(regionProof(model).owned).toHaveLength(
    model.controlByFunction.get(0).blocks.length,
  )
  const { output } = emitVmSwitchProgram(model)
  const ast = parse(output)
  traverse(ast, {})
  expectConsistentState(ast, output)
  expect(output).not.toMatch(/__recovered_(?:pc|dispatch|handlers)/)
  expect(output.match(/globalThis\["SHARED"\]/g)).toHaveLength(1)
  expect(output).toContain(
    'Reflect.apply(__recovered_r_0_7, __recovered_r_0_1, [__recovered_r_0_3])',
  )
  expect(output).toContain('__recovered_r_0_5 = __recovered_r_0_8;')
  expect(output).toContain('return __recovered_r_0_5;')
  expect(snapshot(model)).toBe(before)
})
test('a catch-body call whose exceptional edge claims a throw value is refused', () => {
  const model = catchCallModel(3),
    before = snapshot(model)
  expect(() => regionProof(model)).toThrowError(/throw payload at 81/)
  expect(() => emitVmSwitchProgram(model)).toThrowError(/throw payload at 81/)
  expect(snapshot(model)).toBe(before)
})
