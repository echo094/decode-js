import {
  REGISTER_DESTINATIONS,
  decline,
  sameArray,
} from './build-cfg-wordcode.js'
import { registerIndices } from './build-cfg-preflight.js'

export function destinationRegister(instruction) {
  return REGISTER_DESTINATIONS.has(instruction.name)
    ? instruction.words[1]
    : null
}

function labelTargetFor(instruction, operand, referencesData) {
  const reference = referencesData.labelByLocation.get(
    `${instruction.pc}:${operand}`,
  )
  return reference.target
}

// A register outside the descriptor breaks only code that runs, and unreachable code never decides
// behaviour, so the bound reads the instructions the stack solve reached, before data flow reads
// their registers.
export function validateRegisterRanges(fn, reachablePcs, wordcodeData) {
  for (const pc of reachablePcs) {
    const instruction = wordcodeData.byPc.get(pc)
    for (const register of registerIndices(instruction)) {
      if (register >= fn.regCount) {
        decline(
          'register-range',
          `Function ${fn.id} uses register ${register} outside its descriptor`,
        )
      }
    }
  }
}

export function makeHandlerRecords(
  wordcodeData,
  functionsData,
  referencesData,
) {
  const records = new Map()
  for (const fn of functionsData.functions) {
    for (const pc of fn.instructionPcs) {
      const instruction = wordcodeData.byPc.get(pc)
      if (instruction.name === 'TRY_SETUP') {
        const handlerPc = labelTargetFor(instruction, 0, referencesData)
        const exceptionReg = instruction.words[2]
        records.set(`try@${pc}`, {
          id: `try@${pc}`,
          type: 'handler',
          ownerFunction: fn.id,
          setupPc: pc,
          handlerPc,
          exceptionReg,
        })
      } else if (instruction.name === 'FINALLY_SETUP') {
        const finallyPc = labelTargetFor(instruction, 0, referencesData)
        const throwPadPc = labelTargetFor(instruction, 3, referencesData)
        records.set(`finally@${pc}`, {
          id: `finally@${pc}`,
          type: 'finally',
          ownerFunction: fn.id,
          setupPc: pc,
          finallyPc,
          continuationReg: instruction.words[2],
          payloadReg: instruction.words[3],
          throwPadPc,
        })
      }
    }
  }
  return records
}

export function recordView(record) {
  if (record.type === 'handler') {
    return {
      type: record.type,
      setupPc: record.setupPc,
      handlerPc: record.handlerPc,
      exceptionReg: record.exceptionReg,
    }
  }
  return {
    type: record.type,
    setupPc: record.setupPc,
    finallyPc: record.finallyPc,
    continuationReg: record.continuationReg,
    payloadReg: record.payloadReg,
    throwPadPc: record.throwPadPc,
  }
}

export function stateView(stack, records) {
  return {
    stack: stack.map((id) => recordView(records.get(id))),
    finallyStack: stack
      .filter((id) => records.get(id).type === 'finally')
      .map((id) => recordView(records.get(id))),
  }
}

function sameStack(left, right) {
  return sameArray(left, right)
}

function emptyEdge(kind, sourcePc, targetPc, options = {}) {
  return {
    kind,
    sourcePc,
    targetPc,
    condition: options.condition ?? null,
    continuationPc: options.continuationPc ?? null,
    payload: options.payload ?? null,
    callSitePc: options.callSitePc ?? null,
    route: options.route ?? 'direct',
    mode: options.mode ?? 'direct',
    extraWrites: options.extraWrites ?? [],
  }
}

function setupPayload(record, sourceRegister = null) {
  if (record.type === 'handler') {
    return {
      throwRegister: sourceRegister,
      exceptionRegister: record.exceptionReg,
    }
  }
  return {
    throwRegister: sourceRegister,
    finallyPc: record.finallyPc,
    continuationRegister: record.continuationReg,
    payloadRegister: record.payloadReg,
    throwPadPc: record.throwPadPc,
  }
}

function directEdge(instruction, target, records, options = {}) {
  const finallyRecord = [...records.values()].find(
    (record) =>
      record.type === 'finally' &&
      record.ownerFunction === options.functionId &&
      record.finallyPc === target,
  )
  const kind =
    finallyRecord && instruction.name === 'JUMP'
      ? 'finally'
      : (options.kind ?? 'branch')
  return emptyEdge(kind, instruction.pc, target, {
    ...options,
    functionId: undefined,
    route: kind === 'finally' ? 'normal' : (options.route ?? 'direct'),
    payload:
      kind === 'finally'
        ? setupPayload(finallyRecord)
        : (options.payload ?? null),
  })
}

function routeAbrupt(instruction, stack, records, isCall = false) {
  const sourceRegister =
    instruction.name === 'THROW' || instruction.name === 'RETURN'
      ? instruction.words[1]
      : null
  if (instruction.name === 'RETURN') {
    let finallyIndex = -1
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (records.get(stack[index]).type === 'finally') {
        finallyIndex = index
        break
      }
    }
    if (finallyIndex < 0) {
      return {
        edge: emptyEdge('return', instruction.pc, null, {
          route: 'propagate',
          payload: { returnRegister: sourceRegister },
        }),
        after: [],
        extraWrites: [],
      }
    }
    const record = records.get(stack[finallyIndex])
    return {
      edge: emptyEdge('finally', instruction.pc, record.finallyPc, {
        route: 'exceptional',
        payload: setupPayload(record, sourceRegister),
        extraWrites: [
          {
            register: record.continuationReg,
            kind: 'unknown',
            origin: `return@${instruction.pc}`,
          },
          {
            register: record.payloadReg,
            kind: 'unknown',
            origin: `return@${instruction.pc}`,
          },
        ],
      }),
      after: stack.slice(0, finallyIndex),
      extraWrites: [
        {
          register: record.continuationReg,
          kind: 'unknown',
          origin: `return@${instruction.pc}`,
        },
        {
          register: record.payloadReg,
          kind: 'unknown',
          origin: `return@${instruction.pc}`,
        },
      ],
    }
  }

  const top = stack.length ? records.get(stack[stack.length - 1]) : null
  if (!top) {
    return {
      edge: emptyEdge('throw', instruction.pc, null, {
        route: 'propagate',
        callSitePc: isCall ? instruction.pc : null,
        payload: isCall
          ? { exceptionalCompletion: true }
          : { throwRegister: sourceRegister },
      }),
      after: [],
      extraWrites: [],
    }
  }
  if (top.type === 'handler') {
    const extraWrites = [
      {
        register: top.exceptionReg,
        kind: 'unknown',
        origin: `exception@${instruction.pc}`,
      },
    ]
    return {
      edge: emptyEdge('handler', instruction.pc, top.handlerPc, {
        route: 'exceptional',
        callSitePc: isCall ? instruction.pc : null,
        payload: setupPayload(top, sourceRegister),
        extraWrites,
      }),
      after: stack.slice(0, -1),
      extraWrites,
    }
  }
  const extraWrites = [
    {
      register: top.continuationReg,
      kind: 'singleton',
      value: top.throwPadPc,
      origin: `exception@${instruction.pc}`,
    },
    {
      register: top.payloadReg,
      kind: 'unknown',
      origin: `exception@${instruction.pc}`,
    },
  ]
  return {
    edge: emptyEdge('finally', instruction.pc, top.finallyPc, {
      route: 'exceptional',
      callSitePc: isCall ? instruction.pc : null,
      payload: setupPayload(top, sourceRegister),
      extraWrites,
    }),
    after: stack.slice(0, -1),
    extraWrites,
  }
}

// Ordinary instructions whose runtime handler only moves values between registers, the
// constant pool, capture cells and fresh arrays or closures, so they cannot complete abruptly.
// Every other ordinary instruction can throw natively: property reads, writes and deletes,
// global reads and writes, `in`/`instanceof`, object-literal keys, for-in enumeration, and
// every operator that coerces through valueOf/toString. An opcode missing from this set,
// including one a later encoder adds, counts as throwing, which only adds a route.
const NON_THROWING = new Set([
  'LOAD_CONST',
  'LOAD_INT',
  'LOAD_THIS',
  'LOAD_UPVALUE',
  'STORE_UPVALUE',
  'MOVE',
  'MAKE_CLOSURE',
  'BUILD_ARRAY',
  'TYPEOF',
  'TYPEOF_SAFE',
  'VOID',
  'UNARY_NOT',
  'DEBUGGER',
])

// A native throw from an ordinary instruction. Inside a protected range it reaches the
// innermost handler or finalizer exactly as a call's exception does, so it takes the same
// route, with the register state at that instruction. Outside protection the exception only propagates, which changes no control flow inside
// this function, so no edge is modeled. Calls and THROW keep their own edges everywhere.
function nativeThrowRoute(instruction, stack, records) {
  if (!stack.length || NON_THROWING.has(instruction.name)) return null
  return routeAbrupt(instruction, stack, records, false)
}

function outgoing(
  fn,
  instruction,
  stack,
  jumpTargets,
  records,
  functionsData,
  referencesData,
) {
  const next = instruction.nextPc < fn.endPc ? instruction.nextPc : null
  const out = []
  const addFallthrough = (target = next, after = stack) => {
    if (target !== null) {
      out.push({
        edge: emptyEdge('fallthrough', instruction.pc, target),
        after,
        extraWrites: [],
      })
    } else if (after.length) {
      decline(
        'unbalanced-handler-stack',
        `Function ${fn.id} ends with active handler state at ${instruction.pc}`,
      )
    }
  }

  if (
    instruction.name === 'TRY_SETUP' ||
    instruction.name === 'FINALLY_SETUP'
  ) {
    // A try statement is one unit: once its setup arms a record, the runtime delivers any
    // failure of a later dispatch step to it, including failures of the VM's own machinery
    // that no program operation models. The setup itself therefore reaches the armed
    // handler, so a try body that cannot throw as a program operation keeps its handler.
    const armed = [
      ...stack,
      `${instruction.name === 'TRY_SETUP' ? 'try' : 'finally'}@${instruction.pc}`,
    ]
    addFallthrough(next, armed)
    out.push(routeAbrupt(instruction, armed, records, false))
  } else if (instruction.name === 'TRY_END') {
    if (!stack.length)
      decline(
        'handler-stack-underflow',
        `TRY_END@${instruction.pc} has an empty handler stack`,
      )
    addFallthrough(next, stack.slice(0, -1))
  } else if (instruction.name === 'JUMP') {
    const target = labelTargetFor(instruction, 0, referencesData)
    out.push({
      edge: directEdge(instruction, target, records, { functionId: fn.id }),
      after: stack,
      extraWrites: [],
    })
  } else if (
    instruction.name === 'JUMP_IF_FALSE' ||
    instruction.name === 'JUMP_IF_TRUE'
  ) {
    const target = labelTargetFor(instruction, 1, referencesData)
    out.push({
      edge: emptyEdge('conditional', instruction.pc, target, {
        condition: {
          register: instruction.words[1],
          truthy: instruction.name === 'JUMP_IF_TRUE',
        },
        route: 'direct',
      }),
      after: stack,
      extraWrites: [],
    })
    addFallthrough(next, stack)
  } else if (instruction.name === 'FOR_IN_NEXT') {
    const target = labelTargetFor(instruction, 2, referencesData)
    out.push({
      edge: emptyEdge('branch', instruction.pc, target, {
        condition: {
          kind: 'iterator',
          register: instruction.words[2],
          available: false,
        },
      }),
      after: stack,
      extraWrites: [],
    })
    addFallthrough(next, stack)
  } else if (instruction.name === 'JUMP_REG') {
    for (const target of jumpTargets.get(instruction.pc) ?? []) {
      if (functionsData.ownerByPc.get(target) !== fn.id)
        decline(
          'cross-function-target',
          `Function ${fn.id}: JUMP_REG@${instruction.pc} leaves its owner`,
        )
      out.push({
        edge: emptyEdge('branch', instruction.pc, target, { mode: 'indirect' }),
        after: stack,
        extraWrites: [],
      })
    }
  } else if (
    instruction.name === 'CALL' ||
    instruction.name === 'CALL_METHOD' ||
    instruction.name === 'NEW'
  ) {
    if (next === null)
      decline(
        'missing-call-continuation',
        `Function ${fn.id}: call@${instruction.pc} has no continuation boundary`,
      )
    out.push({
      edge: emptyEdge('call', instruction.pc, next, {
        continuationPc: next,
        callSitePc: instruction.pc,
        route: 'normal',
        payload: { callSitePc: instruction.pc },
      }),
      after: stack,
      extraWrites: [],
    })
    const exceptional = routeAbrupt(instruction, stack, records, true)
    out.push(exceptional)
  } else if (instruction.name === 'THROW') {
    out.push(routeAbrupt(instruction, stack, records, false))
  } else if (instruction.name === 'RETURN') {
    out.push(routeAbrupt(instruction, stack, records, false))
  } else {
    addFallthrough(next, stack)
    const thrown = nativeThrowRoute(instruction, stack, records)
    if (thrown) out.push(thrown)
  }
  return out
}

export function solveStacks(
  fn,
  jumpTargets,
  records,
  functionsData,
  referencesData,
  wordcodeData,
) {
  const inStates = new Map([[fn.startPc, []]])
  const queue = [fn.startPc]
  const edges = []
  const incoming = new Map()
  const transitions = []
  const addState = (target, state, edge) => {
    if (target === null) return
    const key = `${edge.sourcePc}:${edge.kind}:${edge.targetPc}:${edge.callSitePc ?? ''}`
    const incomingAtTarget = incoming.get(target) ?? new Set()
    incomingAtTarget.add(key)
    incoming.set(target, incomingAtTarget)
    if (inStates.has(target)) {
      if (!sameStack(inStates.get(target), state)) {
        decline(
          'handler-stack-merge-disagreement',
          `Function ${fn.id}: incompatible handler state at ${target}`,
        )
      }
      return
    }
    inStates.set(target, state)
    queue.push(target)
  }

  while (queue.length) {
    const pc = queue.shift()
    const instruction = wordcodeData.byPc.get(pc)
    const before = inStates.get(pc)
    const generated = outgoing(
      fn,
      instruction,
      before,
      jumpTargets,
      records,
      functionsData,
      referencesData,
    )
    transitions.push({
      pc,
      name: instruction.name,
      handlerStateIn: stateView(before, records),
      outgoing: generated.map(({ edge, after }) => ({
        kind: edge.kind,
        targetPc: edge.targetPc,
        handlerStateAfter: stateView(after, records),
      })),
    })
    for (const item of generated) {
      const edge = {
        ...item.edge,
        handlerStateBefore: stateView(before, records),
        handlerStateAfter: stateView(item.after, records),
      }
      edges.push(edge)
      addState(edge.targetPc, item.after, edge)
    }
  }

  for (const record of records.values()) {
    if (record.ownerFunction === fn.id && !inStates.has(record.setupPc)) {
      decline(
        'unbalanced-handler-stack',
        `Function ${fn.id}: setup ${record.setupPc} is unreachable`,
      )
    }
  }
  return { inStates, edges, transitions, incoming }
}
