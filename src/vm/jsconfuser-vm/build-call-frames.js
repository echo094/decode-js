import { indexWordcode } from './wordcode-index.js'
import {
  CALL_NAMES,
  CFG_SCHEMA,
  CallFrameDecline,
  FUNCTION_SCHEMA,
  REFERENCE_SCHEMA,
  REGISTER_DESTINATION_NAMES,
  WORDCODE_SCHEMA,
  cloneData,
  deepFreeze,
  register,
  indexFunctions,
  indexReferences,
} from './call-frames-preflight.js'

function indexCfg(cfg) {
  return {
    edges: cfg.edges,
    cfgFunctionById: new Map(cfg.functions.map((fn) => [fn.id, fn])),
    callsByPc: new Map(cfg.callSites.map((site) => [site.pc, site])),
  }
}

function unknownCell() {
  return { unknown: true, targets: new Set() }
}

function knownClosureCell(functionId) {
  return { unknown: false, targets: new Set([functionId]) }
}

function cloneCell(cell) {
  return { unknown: cell.unknown, targets: new Set(cell.targets) }
}

function cloneState(state) {
  return state.map(cloneCell)
}

function statesEqual(left, right) {
  if (left.length !== right.length) return false
  return left.every((cell, index) => {
    const other = right[index]
    if (
      !other ||
      cell.unknown !== other.unknown ||
      cell.targets.size !== other.targets.size
    ) {
      return false
    }
    for (const target of cell.targets)
      if (!other.targets.has(target)) return false
    return true
  })
}

function mergeCell(left, right) {
  const targets = new Set([...left.targets, ...right.targets])
  const knownKindsDisagree =
    (left.targets.size === 0 && right.targets.size > 0) ||
    (right.targets.size === 0 && left.targets.size > 0)
  return {
    unknown: left.unknown || right.unknown || knownKindsDisagree,
    targets,
  }
}

function mergeState(left, right) {
  return left.map((cell, index) => mergeCell(cell, right[index]))
}

function initialState(regCount) {
  return Array.from({ length: regCount }, () => unknownCell())
}

function destinationRegister(instruction) {
  if (!REGISTER_DESTINATION_NAMES.has(instruction.name)) return null
  return instruction.words[1]
}

function callResultCell(state, instruction, returnSummaries) {
  if (instruction.name === 'NEW') return unknownCell()
  const calleeIndex = instruction.name === 'CALL_METHOD' ? 3 : 2
  const callee = state[calleeIndex] ?? unknownCell()
  if (callee.unknown || callee.targets.size === 0) return unknownCell()
  const targets = new Set()
  for (const functionId of callee.targets) {
    const summary = returnSummaries.get(functionId)
    if (!summary) return unknownCell()
    for (const target of summary.targets) targets.add(target)
    if (!summary.known) return { unknown: true, targets }
  }
  return { unknown: false, targets }
}

function transferState(state, instruction, closureSitesByPc, returnSummaries) {
  const next = cloneState(state)
  if (instruction.name === 'MAKE_CLOSURE') {
    const site = closureSitesByPc.get(instruction.pc)
    next[instruction.words[1]] = knownClosureCell(site.childFunctionId)
    return next
  }
  if (instruction.name === 'MOVE') {
    const destination = instruction.words[1]
    const source = instruction.words[2]
    next[destination] = cloneCell(state[source] ?? unknownCell())
    return next
  }
  if (CALL_NAMES.has(instruction.name)) {
    next[instruction.words[1]] = callResultCell(
      state,
      instruction,
      returnSummaries,
    )
    return next
  }
  const destination = destinationRegister(instruction)
  if (destination !== null) next[destination] = unknownCell()
  return next
}

function isExceptionalCallEdge(edge, sourceInstruction) {
  return (
    CALL_NAMES.has(sourceInstruction.name) &&
    edge.callSitePc === sourceInstruction.pc &&
    edge.route !== 'normal'
  )
}

function solveClosureProvenance(
  fn,
  cfgEdges,
  wordcodeData,
  closureSitesByPc,
  returnSummaries,
) {
  const inStates = new Map([[fn.startPc, initialState(fn.regCount)]])
  const queue = [fn.startPc]
  const edgesBySource = new Map()
  for (const edge of cfgEdges) {
    const list = edgesBySource.get(edge.sourcePc) ?? []
    list.push(edge)
    edgesBySource.set(edge.sourcePc, list)
  }
  while (queue.length > 0) {
    const pc = queue.shift()
    const instruction = wordcodeData.byPc.get(pc)
    const input = inStates.get(pc)
    const output = transferState(
      input,
      instruction,
      closureSitesByPc,
      returnSummaries,
    )
    for (const edge of edgesBySource.get(pc) ?? []) {
      if (edge.targetPc === null) continue
      const edgeState = isExceptionalCallEdge(edge, instruction)
        ? input
        : output
      const prior = inStates.get(edge.targetPc)
      const merged = prior
        ? mergeState(prior, edgeState)
        : cloneState(edgeState)
      if (!prior || !statesEqual(prior, merged)) {
        inStates.set(edge.targetPc, merged)
        queue.push(edge.targetPc)
      }
    }
  }
  return inStates
}

function summariesEqual(left, right) {
  if (left.known !== right.known || left.targets.size !== right.targets.size) {
    return false
  }
  for (const target of left.targets)
    if (!right.targets.has(target)) return false
  return true
}

function summaryForFunction(fn, provenance, wordcodeData) {
  const targets = new Set()
  let sawReachableReturn = false
  let known = true
  for (const pc of fn.instructionPcs) {
    const instruction = wordcodeData.byPc.get(pc)
    if (instruction.name !== 'RETURN' || !provenance.has(pc)) continue
    sawReachableReturn = true
    const cell = provenance.get(pc)[instruction.words[1]]
    if (!cell || cell.unknown) {
      known = false
      continue
    }
    for (const target of cell.targets) targets.add(target)
  }
  return {
    known: sawReachableReturn && known,
    targets,
  }
}

function solveAllClosureProvenance(functionsData, cfgData, wordcodeData) {
  let returnSummaries = new Map(
    functionsData.functions.map((fn) => [
      fn.id,
      { known: false, targets: new Set() },
    ]),
  )
  let solved = new Map()
  for (
    let iteration = 0;
    iteration <= functionsData.functions.length + 2;
    iteration += 1
  ) {
    const nextSolved = new Map()
    const nextSummaries = new Map()
    for (const fn of functionsData.functions) {
      const edges = cfgData.edges.filter((edge) => edge.functionId === fn.id)
      const provenance = solveClosureProvenance(
        fn,
        edges,
        wordcodeData,
        functionsData.closureSitesByPc,
        returnSummaries,
      )
      nextSolved.set(fn.id, provenance)
      nextSummaries.set(fn.id, summaryForFunction(fn, provenance, wordcodeData))
    }
    const stable = functionsData.functions.every((fn) =>
      summariesEqual(returnSummaries.get(fn.id), nextSummaries.get(fn.id)),
    )
    solved = nextSolved
    returnSummaries = nextSummaries
    if (stable) break
  }
  return { provenance: solved, returnSummaries }
}

function frameRecord(fn, referencesData) {
  const headerSize = referencesData.frame.headerSize
  const frameSize = headerSize + fn.regCount
  return {
    functionId: fn.id,
    kind: fn.kind,
    frameBase: fn.id === 0 ? referencesData.frame.frameStart : null,
    frameSize,
    registerBaseOffset: headerSize,
    registerWindow: {
      start: headerSize,
      end: headerSize + fn.regCount,
    },
    regCount: fn.regCount,
    paramCount: fn.paramCount,
    hasRest: fn.hasRest,
  }
}

function completionRoute(edge) {
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

function buildCallSite(fn, instruction, cfgData, provenance) {
  const parsed = instruction
  const state = provenance.get(instruction.pc)
  const calleeCell = state?.[parsed.callee.index]
  const calleeFunctions =
    calleeCell && !calleeCell.unknown
      ? [...calleeCell.targets].sort((left, right) => left - right)
      : []

  const exceptionalEdge = cfgData.edges.find(
    (edge) =>
      edge.sourcePc === instruction.pc &&
      edge.callSitePc === instruction.pc &&
      edge.route !== 'normal',
  )

  return {
    pc: instruction.pc,
    functionId: fn.id,
    kind: parsed.name,
    destination: cloneData(parsed.destination),
    callee: cloneData(parsed.callee),
    calleeFunctions,
    receiver: cloneData(parsed.receiver),
    constructorState: {
      isConstructor: parsed.name === 'NEW',
      mode: parsed.name === 'NEW' ? 'allocate-this' : 'ordinary',
    },
    arguments: cloneData(parsed.arguments),
    continuationPc: parsed.nextPc,
    returnDestination: cloneData(parsed.destination),
    exceptionalCompletion: {
      kind: exceptionalEdge.kind,
      targetPc: exceptionalEdge.targetPc,
      route: exceptionalEdge.route,
      mode: exceptionalEdge.mode,
      callSitePc: exceptionalEdge.callSitePc,
      payload: cloneData(exceptionalEdge.payload),
    },
    cfg: {
      normalTargetPc: parsed.nextPc,
      handlerStateBefore: cloneData(exceptionalEdge.handlerStateBefore),
      handlerStateAfter: cloneData(exceptionalEdge.handlerStateAfter),
    },
  }
}

function makeCallerDestination(callSite) {
  return {
    callerFunctionId: callSite.functionId,
    callSitePc: callSite.pc,
    destination: cloneData(callSite.returnDestination),
    continuationPc: callSite.continuationPc,
    constructorState: cloneData(callSite.constructorState),
  }
}

function recognize(wordcode, references, functions, cfg) {
  const wordcodeData = indexWordcode(wordcode)
  const referencesData = indexReferences(references)
  const functionsData = indexFunctions(functions)
  const cfgData = indexCfg(cfg)

  const solved = solveAllClosureProvenance(functionsData, cfgData, wordcodeData)
  const functionResults = []
  const allCallSites = []
  for (const fn of functionsData.functions) {
    const fnCfgEdges = cfgData.edges.filter((edge) => edge.functionId === fn.id)
    const provenance = solved.provenance.get(fn.id)
    const callSites = fn.instructionPcs
      .map((pc) => wordcodeData.byPc.get(pc))
      .filter((instruction) => CALL_NAMES.has(instruction.name))
      .map((instruction) => buildCallSite(fn, instruction, cfgData, provenance))
    allCallSites.push(...callSites)

    const routes = fnCfgEdges
      .filter(
        (edge) =>
          edge.kind === 'return' ||
          edge.kind === 'throw' ||
          edge.kind === 'handler' ||
          edge.kind === 'finally' ||
          (edge.callSitePc !== null && edge.route !== 'normal'),
      )
      .map(completionRoute)
    const returns = fn.instructionPcs
      .map((pc) => wordcodeData.byPc.get(pc))
      .filter(({ name }) => name === 'RETURN')
      .map((instruction) => ({
        pc: instruction.pc,
        sourceRegister: register(
          instruction.words[1],
          `RETURN@${instruction.pc} source`,
        ),
        reachable: provenance.has(instruction.pc),
        routes: routes.filter(({ sourcePc }) => sourcePc === instruction.pc),
      }))
    const throws = fn.instructionPcs
      .map((pc) => wordcodeData.byPc.get(pc))
      .filter(({ name }) => name === 'THROW')
      .map((instruction) => ({
        pc: instruction.pc,
        payloadRegister: register(
          instruction.words[1],
          `THROW@${instruction.pc} payload`,
        ),
        reachable: provenance.has(instruction.pc),
        routes: routes.filter(({ sourcePc }) => sourcePc === instruction.pc),
      }))
    functionResults.push({
      id: fn.id,
      kind: fn.kind,
      startPc: fn.startPc,
      endPc: fn.endPc,
      parentFunctionId: fn.parentFunctionId,
      regCount: fn.regCount,
      paramCount: fn.paramCount,
      captureCount: fn.captureCount,
      hasRest: fn.hasRest,
      frame: frameRecord(fn, referencesData),
      callSites,
      returns,
      throws,
      completionRoutes: routes,
    })
  }

  const callerDestinationsByFunction = new Map()
  for (const callSite of allCallSites) {
    for (const functionId of callSite.calleeFunctions) {
      const list = callerDestinationsByFunction.get(functionId) ?? []
      list.push(makeCallerDestination(callSite))
      callerDestinationsByFunction.set(functionId, list)
    }
  }
  for (const fn of functionResults) {
    const callers = callerDestinationsByFunction.get(fn.id) ?? []
    for (const record of fn.returns)
      record.callerDestinations = cloneData(callers)
  }

  const frames = functionResults.map(({ frame }) => cloneData(frame))
  const frame = {
    frameStart: referencesData.frame.frameStart,
    headerSize: referencesData.frame.headerSize,
    slots: { ...referencesData.frame.slots },
    mainStartPc: referencesData.frame.mainStartPc,
    mainRegCount: referencesData.frame.mainRegCount,
    root: cloneData(referencesData.frame.root),
    descriptors: cloneData(referencesData.frame.descriptors),
  }
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-call-frames.v1',
    encoding: 'numeric-u32',
    wordCount: wordcodeData.words.length,
    instructionCount: wordcodeData.instructions.length,
    functionCount: functionResults.length,
    frame,
    frames,
    functions: functionResults,
    callSites: allCallSites,
    returns: functionResults.flatMap(({ returns: records }) => records),
    throws: functionResults.flatMap(({ throws: records }) => records),
    completionRoutes: functionResults.flatMap(
      ({ completionRoutes: routes }) => routes,
    ),
    source: {
      wordcodeSchema: WORDCODE_SCHEMA,
      referencesSchema: REFERENCE_SCHEMA,
      functionsSchema: FUNCTION_SCHEMA,
      cfgSchema: CFG_SCHEMA,
    },
  })
}

export function diagnoseCallFrames(wordcode, references, functions, cfg) {
  try {
    const result = recognize(wordcode, references, functions, cfg)
    return deepFreeze({ ok: true, result, diagnostic: null })
  } catch (error) {
    if (error instanceof CallFrameDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'call-frame-builder-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function buildCallFrames(wordcode, references, functions, cfg) {
  return diagnoseCallFrames(wordcode, references, functions, cfg).result
}

export default buildCallFrames
