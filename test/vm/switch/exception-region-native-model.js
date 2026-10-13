// Independent source-switch data: the root publishes a captured-cell function
// and a reader. The regional function has a shared join and shared return pad.
export function nativeExceptionRegionModel({ outsideCarrier = false } = {}) {
  const empty = { stack: [], finallyStack: [] }
  const finalRecord = {
    type: 'finally',
    setupPc: 100,
    finallyPc: 300,
    continuationReg: 4,
    payloadReg: 5,
    throwPadPc: 400,
  }
  const outer = { stack: [finalRecord], finallyStack: [finalRecord] }
  const inner = {
    stack: [
      finalRecord,
      { type: 'handler', setupPc: 101, handlerPc: 200, exceptionReg: 3 },
    ],
    finallyStack: [finalRecord],
  }
  const literal = (destination, value) => ({
    kind: 'assign',
    destination,
    value: { kind: 'literal', value },
  })
  const copy = (destination, index) => ({
    kind: 'assign',
    destination,
    value: { kind: 'register', index },
  })
  const read = (destination) => ({
    kind: 'upvalue-read',
    destination,
    index: 0,
  })
  const write = { kind: 'upvalue-write', index: 0, source: 13 }
  const plus = {
    kind: 'assign',
    destination: 13,
    value: { kind: 'binary', operator: '+', left: 13, right: 14 },
  }
  const property = (destination) => ({
    kind: 'property-read',
    destination,
    object: 6,
    key: 7,
  })
  const global = (destination, name) => ({
    kind: 'global-read',
    destination,
    name,
  })
  const call = (callee, registers, receiver = null) => ({
    kind: 'call',
    mode: 'apply',
    destination: 2,
    callee,
    receiver:
      receiver === null
        ? { kind: 'null' }
        : { kind: 'register', index: receiver },
    arguments: { kind: 'fixed', registers },
  })
  const closure = (destination, entry, index) => ({
    kind: 'closure',
    destination,
    entry,
    captures: [{ kind: 'local', index }],
  })
  const rows = [
    [
      100,
      101,
      {
        kind: 'finally-setup',
        target: 300,
        continuation: 4,
        payload: 5,
        throwPad: 400,
      },
      empty,
    ],
    [
      101,
      102,
      { kind: 'catch-setup', target: 200, exceptionRegister: 3 },
      outer,
    ],
    [102, 103, global(6, 'HOST'), inner],
    [
      103,
      104,
      { kind: 'branch', condition: 0, when: 'true', target: 120 },
      inner,
    ],
    [104, 105, literal(8, 'left'), inner],
    [105, 106, { kind: 'jump', target: 130 }, inner],
    [120, 121, literal(9, 'right'), inner],
    [121, 122, copy(8, 9), inner],
    [122, 123, { kind: 'jump', target: 130 }, inner],
    [130, 131, literal(7, 'join'), inner],
    [131, 132, property(11), inner],
    [132, 133, call(11, [8], 6), inner],
    [133, 134, literal(7, 'body'), inner],
    [134, 135, property(11), inner],
    [135, 136, literal(7, 'method'), inner],
    [136, 137, property(11), inner],
    [137, 138, literal(7, 'argument'), inner],
    [138, 139, property(12), inner],
    [139, 140, call(11, [12], 6), inner],
    [140, 141, read(13), inner],
    [141, 142, literal(14, 1), inner],
    [142, 143, { ...plus }, inner],
    [143, 144, { ...write }, inner],
    [144, 145, global(15, 'TRY_INCREMENT'), inner],
    [145, 146, call(15, [13]), inner],
    [146, 147, { kind: 'handler-pop' }, inner],
    [147, 148, copy(5, 13), outer],
    [148, 149, literal(4, 401), outer],
    [149, 150, { kind: 'handler-pop' }, outer],
    [150, 151, { kind: 'jump', target: 300 }, empty],
    [200, 201, copy(10, 3), outer],
    [201, 202, literal(7, 'catch'), outer],
    [202, 203, property(11), outer],
    [203, 204, call(11, [10], 6), outer],
    [204, 205, read(13), outer],
    [205, 206, literal(14, 1), outer],
    [206, 207, { ...plus }, outer],
    [207, 208, { ...write }, outer],
    [208, 209, global(15, 'CATCH_INCREMENT'), outer],
    [209, 210, call(15, [13]), outer],
    [210, 211, copy(5, 13), outer],
    [211, 212, literal(4, 401), outer],
    [212, 213, { kind: 'handler-pop' }, outer],
    [213, 214, { kind: 'jump', target: 300 }, empty],
    [300, 301, read(13), empty],
    [301, 302, literal(14, 10), empty],
    [302, 303, { ...plus }, empty],
    [303, 304, { ...write }, empty],
    [304, 305, global(15, 'FINALIZE'), empty],
    [305, 306, call(15, [13]), empty],
    [306, 307, { kind: 'indirect-jump', source: 4 }, empty],
    [400, 401, { kind: 'throw', source: 5 }, empty],
    [401, 402, { kind: 'return', source: 5 }, empty],
  ]
  if (outsideCarrier) rows.unshift([90, 100, closure(15, 500, 5), empty])
  const rootRows = [
    [0, 1, literal(0, 0), empty],
    [1, 2, closure(1, outsideCarrier ? 90 : 100, 0), empty],
    [2, 3, { kind: 'global-write', name: 'REGION', source: 1 }, empty],
    [3, 4, closure(2, 500, 0), empty],
    [4, 5, { kind: 'global-write', name: 'GET_CAPTURE', source: 2 }, empty],
    [5, 6, { kind: 'return', source: 0 }, empty],
  ]
  const readerRows = [
    [500, 501, read(0), empty],
    [501, 502, { kind: 'return', source: 0 }, empty],
  ]
  const byFunction = new Map([
    [0, rootRows],
    [1, rows],
    [2, readerRows],
  ])
  const edges = []
  const instructionsByFunction = new Map(),
    controlByFunction = new Map()
  const finalPayload = {
    continuationRegister: 4,
    payloadRegister: 5,
    finallyPc: 300,
    throwPadPc: 400,
    throwRegister: null,
  }
  for (const [functionId, records] of byFunction) {
    const states = new Map(records.map(([pc, , , state]) => [pc, state]))
    const add = (pc, kind, targetPc, extra = {}) =>
      edges.push({
        id: `native:${functionId}:${edges.length}`,
        functionId,
        sourcePc: pc,
        kind,
        targetPc,
        handlerStateBefore: states.get(pc),
        handlerStateAfter: targetPc === null ? empty : states.get(targetPc),
        mode: 'direct',
        route: 'direct',
        payload: null,
        ...extra,
      })
    const cases = records.map(([pc, nextPc, operation]) => ({
      pc,
      nextPc,
      operation,
    }))
    for (const { pc, nextPc, operation: op } of cases) {
      if (op.kind === 'branch') {
        add(pc, 'conditional', op.target)
        add(pc, 'fallthrough', nextPc)
      } else if (op.kind === 'jump') {
        if (op.target === 300)
          add(pc, 'finally', 300, { route: 'normal', payload: finalPayload })
        else add(pc, 'branch', op.target)
      } else if (op.kind === 'return' || op.kind === 'throw')
        add(pc, op.kind, null)
      else if (op.kind === 'indirect-jump') {
        for (const target of [400, 401])
          add(pc, 'branch', target, { mode: 'indirect' })
      } else {
        add(pc, op.kind === 'call' ? 'call' : 'fallthrough', nextPc)
        if (functionId === 1 && ['property-read', 'call'].includes(op.kind)) {
          if (states.get(pc) === inner)
            add(pc, 'handler', 200, {
              route: 'exceptional',
              payload: { exceptionRegister: 3, throwRegister: null },
            })
          else if (states.get(pc) === outer)
            add(pc, 'finally', 300, {
              route: 'exceptional',
              payload: finalPayload,
            })
          else add(pc, 'throw', null, { route: 'propagate' })
        }
      }
    }
    instructionsByFunction.set(functionId, cases)
    controlByFunction.set(functionId, {
      mode: 'structured',
      control: { regions: [] },
      blocks: cases.map((item) => ({
        id: `${functionId}:b@${item.pc}`,
        functionId,
        startPc: item.pc,
        endPc: item.nextPc,
        leaves: [{ ...item, reachable: true }],
        handlerStateIn: states.get(item.pc),
        successorEdgeIds: edges
          .filter(
            (edge) =>
              edge.functionId === functionId && edge.sourcePc === item.pc,
          )
          .map(({ id }) => id),
      })),
    })
  }
  const functions = [
    {
      id: 0,
      startPc: 0,
      regCount: 3,
      paramCount: 0,
      captureCount: 0,
      hasRest: false,
    },
    {
      id: 1,
      startPc: outsideCarrier ? 90 : 100,
      regCount: 16,
      paramCount: 1,
      captureCount: 1,
      hasRest: false,
    },
    {
      id: 2,
      startPc: 500,
      regCount: 1,
      paramCount: 0,
      captureCount: 1,
      hasRest: false,
    },
  ]
  const instructionCount = [...instructionsByFunction.values()].reduce(
    (sum, items) => sum + items.length,
    0,
  )
  return {
    schemaVersion: 'decode-js-vm-switch.v1',
    code: { kind: 'source-switch', instructionCount },
    instructionCount,
    storage: {
      kind: 'register-machine',
      functions: functions.map(({ id, regCount, captureCount }) => ({
        id,
        registerCount: regCount,
        captureCount,
      })),
    },
    functions: { functions },
    instructionsByFunction,
    controlByFunction,
    structuredControl: { edges },
  }
}

export const nativeModelSnapshot = (model) =>
  JSON.stringify(model, (_, value) =>
    value instanceof Map ? [...value] : value,
  )
