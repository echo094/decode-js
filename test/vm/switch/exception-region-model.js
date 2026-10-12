import { proveCatchFinallyRegion } from '../../../src/vm/switch/vm-switch-exception-region.js'

// Independently supplied source-switch graph: grouped blocks, a diamond with a
// shared join, branching catch/finalizer bodies, and explicit exceptional routes.
export function exceptionRegionModel() {
  const empty = { stack: [], finallyStack: [] }
  const finalRecord = {
    type: 'finally',
    setupPc: 0,
    finallyPc: 100,
    continuationReg: 4,
    payloadReg: 5,
    throwPadPc: 200,
  }
  const outer = { stack: [finalRecord], finallyStack: [finalRecord] }
  const inner = {
    stack: [
      finalRecord,
      { type: 'handler', setupPc: 1, handlerPc: 80, exceptionReg: 3 },
    ],
    finallyStack: [finalRecord],
  }
  const finallyPayload = {
    continuationRegister: 4,
    payloadRegister: 5,
    finallyPc: 100,
    throwPadPc: 200,
    throwRegister: null,
  }
  const assign = (destination, value) => ({
    kind: 'assign',
    destination,
    value: { kind: 'literal', value },
  })
  const copy = (destination, index) => ({
    kind: 'assign',
    destination,
    value: { kind: 'register', index },
  })
  const branch = (target) => ({
    kind: 'branch',
    condition: 0,
    when: 'true',
    target,
  })
  const rows = [
    [
      0,
      1,
      {
        kind: 'finally-setup',
        target: 100,
        continuation: 4,
        payload: 5,
        throwPad: 200,
      },
      empty,
    ],
    [1, 2, { kind: 'catch-setup', target: 80, exceptionRegister: 3 }, outer],
    [2, 3, branch(10), inner],
    [3, 4, assign(1, 'left'), inner],
    [4, 5, { kind: 'jump', target: 12 }, inner],
    [10, 11, assign(1, 'right'), inner],
    [11, 12, { kind: 'jump', target: 12 }, inner],
    [12, 13, assign(2, 'shared'), inner],
    [13, 14, { kind: 'global-write', name: 'SHARED', source: 2 }, inner],
    [14, 15, branch(20), inner],
    [15, 16, { kind: 'throw', source: 2 }, inner],
    [20, 21, { kind: 'handler-pop' }, inner],
    [21, 22, copy(5, 2), outer],
    [22, 23, assign(4, 201), outer],
    [23, 24, { kind: 'handler-pop' }, outer],
    [24, 25, { kind: 'jump', target: 100 }, empty],
    [80, 81, branch(90), outer],
    [81, 82, { kind: 'throw', source: 3 }, outer],
    [90, 91, assign(8, 'caught'), outer],
    [91, 92, copy(5, 8), outer],
    [92, 93, assign(4, 202), outer],
    [93, 94, { kind: 'handler-pop' }, outer],
    [94, 95, { kind: 'jump', target: 100 }, empty],
    [100, 101, branch(110), empty],
    [
      101,
      102,
      {
        kind: 'call',
        mode: 'apply',
        destination: 8,
        callee: 7,
        receiver: { kind: 'null' },
        arguments: { kind: 'fixed', registers: [] },
      },
      empty,
    ],
    [102, 103, { kind: 'jump', target: 130 }, empty],
    [110, 111, assign(9, 'final-right'), empty],
    [111, 112, { kind: 'global-write', name: 'FINAL', source: 9 }, empty],
    [112, 113, { kind: 'jump', target: 130 }, empty],
    [130, 131, { kind: 'indirect-jump', source: 4 }, empty],
    [200, 201, { kind: 'throw', source: 5 }, empty],
    [201, 202, { kind: 'return', source: 5 }, empty],
    [202, 203, { kind: 'return', source: 5 }, empty],
  ]
  const cases = rows.map(([pc, nextPc, operation]) => ({
    pc,
    nextPc,
    operation,
  }))
  const states = new Map(rows.map(([pc, , , state]) => [pc, state]))
  const edges = []
  const add = (pc, kind, targetPc, extra = {}) => {
    const edge = {
      id: `generic:${edges.length}`,
      functionId: 0,
      sourcePc: pc,
      kind,
      targetPc,
      handlerStateBefore: states.get(pc),
      handlerStateAfter: targetPc === null ? empty : states.get(targetPc),
      mode: 'direct',
      route: 'direct',
      payload: null,
      ...extra,
    }
    edges.push(edge)
  }
  for (const item of cases) {
    const { pc, nextPc, operation: op } = item
    if (op.kind === 'branch') {
      add(pc, 'conditional', op.target)
      add(pc, 'fallthrough', nextPc)
    } else if (op.kind === 'jump') {
      if (op.target === 100)
        add(pc, 'finally', 100, { route: 'normal', payload: finallyPayload })
      else add(pc, 'branch', op.target)
    } else if (op.kind === 'throw') {
      if (pc === 15)
        add(pc, 'handler', 80, {
          route: 'exceptional',
          payload: { exceptionRegister: 3, throwRegister: 2 },
        })
      else if (pc === 81)
        add(pc, 'finally', 100, {
          route: 'exceptional',
          payload: { ...finallyPayload, throwRegister: 3 },
        })
      else add(pc, 'throw', null, { route: 'propagate' })
    } else if (op.kind === 'return') add(pc, 'return', null)
    else if (op.kind === 'indirect-jump')
      for (const target of [200, 201, 202])
        add(pc, 'branch', target, { mode: 'indirect' })
    else if (op.kind === 'call') {
      add(pc, 'call', nextPc)
      add(pc, 'throw', null, { route: 'propagate' })
    } else add(pc, 'fallthrough', nextPc)
  }
  // The producer groups a harmless assignment and a write. Its block has one
  // external edge; internal instruction adjacency remains explicit in the leaves.
  const internal = edges.find((edge) => edge.sourcePc === 12)
  edges.splice(edges.indexOf(internal), 1)
  const blocks = cases
    .filter(({ pc }) => pc !== 13)
    .map((item) => ({
      id: `0:b@${item.pc}`,
      functionId: 0,
      startPc: item.pc,
      endPc: item.pc === 12 ? 14 : item.nextPc,
      leaves: (item.pc === 12
        ? [item, cases.find(({ pc }) => pc === 13)]
        : [item]
      ).map((leaf) => ({ ...leaf, reachable: true })),
      handlerStateIn: states.get(item.pc),
      successorEdgeIds: edges
        .filter((edge) => edge.sourcePc === (item.pc === 12 ? 13 : item.pc))
        .map(({ id }) => id),
    }))
  return {
    schemaVersion: 'decode-js-vm-switch.v1',
    code: { kind: 'source-switch', instructionCount: cases.length },
    instructionCount: cases.length,
    storage: {
      kind: 'register-machine',
      functions: [{ id: 0, registerCount: 10, captureCount: 0 }],
    },
    functions: {
      functions: [
        {
          id: 0,
          startPc: 0,
          regCount: 10,
          paramCount: 0,
          captureCount: 0,
          hasRest: false,
        },
      ],
    },
    instructionsByFunction: new Map([[0, cases]]),
    controlByFunction: new Map([
      [0, { mode: 'structured', blocks, control: { regions: [] } }],
    ]),
    structuredControl: { edges },
  }
}

export const snapshot = (model) =>
  JSON.stringify(model, (_, value) =>
    value instanceof Map
      ? [...value]
      : value instanceof Set
        ? [...value]
        : value,
  )
export function regionProof(model, functionId = 0, setupPc = 0) {
  const blocks = model.controlByFunction.get(functionId).blocks
  return proveCatchFinallyRegion(
    {
      functionId,
      instructions: model.instructionsByFunction.get(functionId),
      blocks,
      edgeById: new Map(
        model.structuredControl.edges.map((edge) => [edge.id, edge]),
      ),
    },
    blocks.find(({ startPc }) => startPc === setupPc),
  )
}
