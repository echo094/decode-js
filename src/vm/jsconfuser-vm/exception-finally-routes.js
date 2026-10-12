import {
  cloneData,
  decline,
  recordId,
  stateView,
} from './exception-finally-input.js'

function directBranchBypassesFinally(instruction, target, stack, records) {
  if (
    !['JUMP', 'JUMP_IF_FALSE', 'JUMP_IF_TRUE', 'FOR_IN_NEXT'].includes(
      instruction.name,
    )
  ) {
    return
  }
  for (const id of stack) {
    const record = records.get(id)
    if (
      record?.type === 'finally' &&
      !(target > record.setupPc && target < record.finallyPc)
    ) {
      decline(
        'invalid-handler-routing',
        `${instruction.name}@${instruction.pc} bypasses ${record.id}`,
      )
    }
  }
}

export function solveFunction(
  fn,
  efn,
  wordcodeData,
  functionData,
  recordData,
  indirectEntries,
) {
  const records = recordData.recordsByFunction.get(fn.id)
  const stackIds = (state) =>
    state.stack.map((record) => recordId(record.type, record.setupPc))
  const inStates = new Map([[fn.startPc, []]])
  const incoming = new Map()
  const edgesBySource = new Map()
  for (const edge of efn.edges) {
    inStates.set(edge.sourcePc, stackIds(edge.handlerStateBefore))
    const edges = edgesBySource.get(edge.sourcePc) ?? []
    edges.push(edge)
    edgesBySource.set(edge.sourcePc, edges)
    if (edge.targetPc !== null) {
      const after = stackIds(edge.handlerStateAfter)
      inStates.set(edge.targetPc, after)
      const entries = incoming.get(edge.targetPc) ?? new Map()
      entries.set(
        `${edge.sourcePc}:${edge.kind}:${edge.targetPc}:${edge.callSitePc ?? ''}`,
        after,
      )
      incoming.set(edge.targetPc, entries)
    }
  }
  const indirectByPc = new Map(
    indirectEntries.map((entry) => [entry.pc, entry]),
  )
  const transitions = []
  for (const [pc, before] of inStates) {
    const instruction = wordcodeData.byPc.get(pc)
    const outgoing = edgesBySource.get(pc) ?? []
    if (instruction.name === 'JUMP') {
      const target = instruction.words[1]
      const finalizer = [...records.values()].find(
        (record) => record.type === 'finally' && record.finallyPc === target,
      )
      if (finalizer && before.includes(finalizer.id)) {
        decline(
          'invalid-handler-routing',
          `JUMP@${pc} re-enters active ${finalizer.id}`,
        )
      }
      if (!finalizer)
        directBranchBypassesFinally(instruction, target, before, records)
    } else if (
      instruction.name === 'JUMP_IF_FALSE' ||
      instruction.name === 'JUMP_IF_TRUE' ||
      instruction.name === 'FOR_IN_NEXT'
    ) {
      directBranchBypassesFinally(
        instruction,
        instruction.words[instruction.name === 'FOR_IN_NEXT' ? 3 : 2],
        before,
        records,
      )
    } else if (instruction.name === 'JUMP_REG') {
      const finalizer = [...records.values()].find(
        (record) =>
          record.type === 'finally' &&
          pc >= record.finallyPc &&
          pc < record.throwPadPc,
      )
      if (finalizer && instruction.words[1] !== finalizer.continuationReg) {
        decline(
          'invalid-handler-routing',
          `JUMP_REG@${pc} does not use ${finalizer.id} continuation register`,
        )
      }
      for (const target of indirectByPc.get(pc).targets) {
        if (finalizer && target < finalizer.finallyPc) {
          decline(
            'invalid-handler-routing',
            `JUMP_REG@${pc} leaves ${finalizer.id}`,
          )
        }
      }
    }
    transitions.push({
      pc,
      name: instruction.name,
      handlerStateBefore: stateView(before, records),
      outgoing: outgoing.map((edge) => {
        const route = cloneData(edge)
        delete route.sourcePc
        delete route.functionId
        delete route.handlerStateBefore
        return route
      }),
    })
  }
  return { inStates, incoming, transitions }
}

export function routeView(edge) {
  return {
    kind: edge.kind,
    sourcePc: edge.sourcePc,
    targetPc: edge.targetPc,
    route: edge.route,
    mode: edge.mode,
    callSitePc: edge.callSitePc,
    continuationPc: edge.continuationPc,
    payload: cloneData(edge.payload),
    handlerStateBefore: cloneData(edge.handlerStateBefore),
    handlerStateAfter: cloneData(edge.handlerStateAfter),
  }
}
