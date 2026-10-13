import { indexWordcode } from './wordcode-index.js'
import {
  CALL_FRAME_SCHEMA,
  CFG_SCHEMA,
  COMPLETION_KINDS,
  EXCEPTION_FINALLY_SCHEMA,
  ExceptionFinallyDecline,
  FUNCTION_SCHEMA,
  REFERENCE_SCHEMA,
  WORDCODE_SCHEMA,
  cloneData,
  deepFreeze,
  register,
  sameValue,
  sortedNumbers,
  stateView,
  indexFunctions,
} from './exception-finally-input.js'
import {
  indexRecords,
  indexCallFrames,
  indexCfg,
} from './exception-finally-control.js'
import { routeView, solveFunction } from './exception-finally-routes.js'

function buildResult(
  wordcodeData,
  functionData,
  cfgData,
  solveResults,
  recordData,
  callFrames,
) {
  const functionResults = []
  const allInstructionStates = []
  const allEdgeStates = []
  const allMerges = []
  const allJumpRegChecks = []
  const allTransitions = []
  const allHandlers = []
  const allFinallys = []
  for (const fn of functionData.list) {
    const records = recordData.recordsByFunction.get(fn.id)
    const solved = solveResults.get(fn.id)
    const efn = cfgData.cfgFunctions.find(({ id }) => id === fn.id)
    const instructionStates = fn.instructionPcs.map((pc) => {
      const outgoing = efn.edges.filter((edge) => edge.sourcePc === pc)
      const afterStates = outgoing.map((edge) => edge.handlerStateAfter)
      const handlerStateAfter =
        afterStates.length > 0 &&
        afterStates.every((state) => sameValue(state, afterStates[0]))
          ? cloneData(afterStates[0])
          : null
      return {
        pc,
        reachable: solved.inStates.has(pc),
        handlerStateBefore: solved.inStates.has(pc)
          ? stateView(solved.inStates.get(pc), records)
          : null,
        handlerStateAfter,
      }
    })
    const edgeStates = efn.edges.map((edge) => routeView(edge))
    const merges = [...solved.incoming.entries()]
      .filter(([, incoming]) => incoming.size > 1)
      .map(([pc, incoming]) => ({
        pc,
        incomingCount: incoming.size,
        handlerState: stateView(solved.inStates.get(pc), records),
      }))
    const jumpRegChecks = (cfgData.indirectByFunction.get(fn.id) ?? []).map(
      (entry) => {
        const instruction = wordcodeData.byPc.get(entry.pc)
        const finalizer = [...records.values()].find(
          ({ type, finallyPc, throwPadPc }) =>
            type === 'finally' &&
            entry.pc >= finallyPc &&
            entry.pc < throwPadPc,
        )
        return {
          pc: entry.pc,
          sourceRegister: register(entry.sourceRegister),
          targets: sortedNumbers(entry.targets),
          finalizer: finalizer?.id ?? null,
          finite: true,
          sameFunction: entry.targets.every(
            (target) => functionData.ownerByPc.get(target) === fn.id,
          ),
          continuationRegister: finalizer
            ? register(finalizer.continuationReg)
            : null,
          instructionName: instruction.name,
        }
      },
    )
    const handlers = [...records.values()]
      .filter(({ type }) => type === 'handler')
      .map(cloneData)
    const finallys = [...records.values()]
      .filter(({ type }) => type === 'finally')
      .map(cloneData)
    allHandlers.push(...handlers)
    allFinallys.push(...finallys)
    allInstructionStates.push(
      ...instructionStates.map((item) => ({ functionId: fn.id, ...item })),
    )
    allEdgeStates.push(
      ...edgeStates.map((item) => ({ functionId: fn.id, ...item })),
    )
    allMerges.push(...merges.map((item) => ({ functionId: fn.id, ...item })))
    allJumpRegChecks.push(
      ...jumpRegChecks.map((item) => ({ functionId: fn.id, ...item })),
    )
    allTransitions.push(
      ...solved.transitions.map((item) => ({ functionId: fn.id, ...item })),
    )
    functionResults.push({
      id: fn.id,
      startPc: fn.startPc,
      endPc: fn.endPc,
      handlerRecords: handlers,
      finallyRecords: finallys,
      instructionStates,
      edgeStates,
      merges,
      jumpRegChecks,
      transitions: solved.transitions,
    })
  }
  const completionRoutes = allEdgeStates.filter(({ kind }) =>
    COMPLETION_KINDS.has(kind),
  )
  return {
    schemaVersion: EXCEPTION_FINALLY_SCHEMA,
    encoding: 'numeric-u32',
    wordCount: wordcodeData.words.length,
    instructionCount: wordcodeData.instructions.length,
    functionCount: functionData.list.length,
    functions: functionResults,
    handlerRecords: allHandlers,
    finallyRecords: allFinallys,
    instructionStates: allInstructionStates,
    edgeStates: allEdgeStates,
    merges: allMerges,
    jumpRegChecks: allJumpRegChecks,
    transitions: allTransitions,
    completionRoutes,
    callFrameRouteCount: callFrames.completionRoutes.length,
    source: {
      wordcodeSchema: WORDCODE_SCHEMA,
      referencesSchema: REFERENCE_SCHEMA,
      functionsSchema: FUNCTION_SCHEMA,
      cfgSchema: CFG_SCHEMA,
      callFramesSchema: CALL_FRAME_SCHEMA,
    },
  }
}

function analyze(wordcode, references, functions, cfg, callFrames) {
  const wordcodeData = indexWordcode(wordcode)
  const functionData = indexFunctions(functions)
  const recordData = indexRecords(cfg)
  const cfgData = indexCfg(cfg)
  const callFrameData = indexCallFrames(callFrames)
  const solveResults = new Map()
  for (const fn of functionData.list) {
    const efn = cfgData.cfgFunctions.find(({ id }) => id === fn.id)
    solveResults.set(
      fn.id,
      solveFunction(
        fn,
        efn,
        wordcodeData,
        functionData,
        recordData,
        cfgData.indirectByFunction.get(fn.id) ?? [],
      ),
    )
  }
  return deepFreeze(
    buildResult(
      wordcodeData,
      functionData,
      cfgData,
      solveResults,
      recordData,
      callFrameData,
    ),
  )
}

export function diagnoseExceptionFinally(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
) {
  try {
    return deepFreeze({
      ok: true,
      result: analyze(wordcode, references, functions, cfg, callFrames),
      diagnostic: null,
    })
  } catch (error) {
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof ExceptionFinallyDecline
            ? error.code
            : 'exception-finally-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function analyzeExceptionFinally(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
) {
  const diagnosis = diagnoseExceptionFinally(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  return diagnosis.ok ? diagnosis.result : null
}

export default analyzeExceptionFinally
