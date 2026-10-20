import {
  cloneData,
  decline,
  recordId,
  stateView,
} from './exception-finally-input.js'

// The JUMP_REG that resumes after each finalizer, read from the graph: the walk from finallyPc
// over non-exceptional edges stops at a JUMP_REG, and steps over a nested finalizer it enters by
// that finalizer's own JUMP_REG targets, so each JUMP_REG belongs to the innermost finalizer
// reaching it, wherever the producer laid the finalizer out.
function finalizerJumpRegs(records, edgesBySource, wordcodeData) {
  const finalizers = [...records.values()].filter(
    (record) => record.type === 'finally',
  )
  const byFinallyPc = new Map(
    finalizers.map((record) => [record.finallyPc, record]),
  )
  const memo = new Map()
  const jumpRegsOf = (record, active) => {
    if (memo.has(record.id)) return memo.get(record.id)
    if (active.has(record.id)) return []
    active.add(record.id)
    const found = []
    const seen = new Set()
    const work = [record.finallyPc]
    while (work.length) {
      const pc = work.pop()
      if (seen.has(pc)) continue
      seen.add(pc)
      const nested = byFinallyPc.get(pc)
      if (nested && nested !== record) {
        for (const jumpReg of jumpRegsOf(nested, active))
          for (const edge of edgesBySource.get(jumpReg) ?? [])
            if (edge.targetPc !== null) work.push(edge.targetPc)
        continue
      }
      if (wordcodeData.byPc.get(pc)?.name === 'JUMP_REG') {
        found.push(pc)
        continue
      }
      for (const edge of edgesBySource.get(pc) ?? [])
        if (edge.route !== 'exceptional' && edge.targetPc !== null)
          work.push(edge.targetPc)
    }
    active.delete(record.id)
    memo.set(record.id, found)
    return found
  }
  const finalizerByJumpReg = new Map()
  for (const record of finalizers)
    for (const pc of jumpRegsOf(record, new Set()))
      if (!finalizerByJumpReg.has(pc)) finalizerByJumpReg.set(pc, record)
  return finalizerByJumpReg
}

export function solveFunction(fn, efn, wordcodeData, functionData, recordData) {
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
  const finalizerByJumpReg = finalizerJumpRegs(
    records,
    edgesBySource,
    wordcodeData,
  )
  const transitions = []
  for (const [pc, before] of inStates) {
    const instruction = wordcodeData.byPc.get(pc)
    const outgoing = edgesBySource.get(pc) ?? []
    if (instruction.name === 'JUMP_REG') {
      const finalizer = finalizerByJumpReg.get(pc)
      if (finalizer && instruction.words[1] !== finalizer.continuationReg) {
        decline(
          'invalid-handler-routing',
          `JUMP_REG@${pc} does not use ${finalizer.id} continuation register`,
        )
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
  return { inStates, incoming, transitions, finalizerByJumpReg }
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
