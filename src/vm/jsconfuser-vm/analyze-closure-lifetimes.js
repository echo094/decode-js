import { indexWordcode } from './wordcode-index.js'
import {
  CALL_FRAME_SCHEMA,
  CFG_SCHEMA,
  CLOSURE_SCHEMA,
  ClosureLifetimeDecline,
  FUNCTION_SCHEMA,
  REFERENCE_SCHEMA,
  WORDCODE_SCHEMA,
  cloneData,
  deepFreeze,
  register,
  sortedNumbers,
  sortedStrings,
} from './closure-lifetimes-contract.js'

import {
  indexCallFrames,
  indexCfg,
  indexFunctions,
} from './closure-lifetimes-ownership.js'
import {
  analyzeProvenance,
  buildCapturePairs,
  collectUses,
  resolveBindings,
  terminalEvents,
} from './closure-lifetimes-flow.js'

export function sameAbstractValue(left, right) {
  if (
    !left ||
    !right ||
    left.precise !== right.precise ||
    left.sites.size !== right.sites.size
  )
    return false
  return [...left.sites].every((siteId) => right.sites.has(siteId))
}

export function sameEnvironment(left, right, regCount) {
  for (let index = 0; index < regCount; index += 1) {
    if (!sameAbstractValue(left.get(index), right.get(index))) return false
  }
  return true
}

function applyProvenance(captureResult, bindingData, useResult) {
  const closureById = new Map(
    captureResult.closureSites.map((site) => [site.id, site]),
  )
  for (const event of useResult.events.values()) {
    const site = closureById.get(event.siteId)

    site.escapeEvents.push({
      kind: event.kind,
      functionId: event.functionId,
      pc: event.pc,
      provenEscape: event.provenEscape,
      targetFunctions: sortedNumbers(event.targetFunctions),
    })
  }
  const sitesByChild = new Map()
  for (const site of captureResult.closureSites) {
    if (!sitesByChild.has(site.childFunctionId))
      sitesByChild.set(site.childFunctionId, [])
    sitesByChild.get(site.childFunctionId).push(site)
  }
  for (const use of useResult.uses) {
    const closureSites = sitesByChild.get(use.functionId) ?? []
    const hasClosedPath = closureSites.some((site) =>
      site.escapeEvents.some(
        ({ kind, provenEscape }) =>
          provenEscape && ['return', 'global-store'].includes(kind),
      ),
    )
    const hasOpenPath = closureSites.some(
      (site) =>
        site.parentFunctionId === use.functionId ||
        site.escapeEvents.some(({ kind }) => kind === 'internal-call-argument'),
    )
    const possibleStates = new Set()
    if (hasOpenPath) possibleStates.add('open')
    if (hasClosedPath) possibleStates.add('closed')
    if (possibleStates.size === 0) {
      possibleStates.add(
        use.functionId ===
          bindingData.bindings.get(use.bindingId).ownerFunctionId
          ? 'open'
          : 'closed',
      )
    }
    use.possibleStates = sortedStrings(possibleStates)
    use.state =
      use.possibleStates.length === 1 ? use.possibleStates[0] : 'open-or-closed'
  }
  const terminationEvents = []
  for (const binding of bindingData.bindings.values()) {
    binding.closeEvents.forEach((event) => {
      terminationEvents.push({ bindingId: binding.id, ...event })
    })
  }
  return { terminationEvents }
}

function buildResult(wordcodeData, functionData, cfgData, callFrameData) {
  const bindingData = resolveBindings(functionData)
  const captureResult = buildCapturePairs(functionData, bindingData, cfgData)
  const uses = collectUses(wordcodeData, functionData, cfgData, bindingData)
  terminalEvents(cfgData, bindingData)
  const provenance = analyzeProvenance(
    wordcodeData,
    functionData,
    cfgData,
    callFrameData,
  )
  const useResult = { ...provenance, uses }
  const { terminationEvents } = applyProvenance(
    captureResult,
    bindingData,
    useResult,
  )
  const bindings = [...bindingData.bindings.values()].map((binding) => ({
    id: binding.id,
    ownerFunctionId: binding.ownerFunctionId,
    register: register(binding.ownerRegister),
    capturePairIds: [...binding.capturePairIds],
    useIds: [...binding.useIds],
    lifecycle: cloneData(binding.lifecycle),
  }))
  const functionSummary = functionData.functions.map((fn) => ({
    id: fn.id,
    kind: fn.kind,
    startPc: fn.startPc,
    endPc: fn.endPc,
    parentFunctionId: fn.parentFunctionId,
    captureCount: fn.captureCount,
    capturePairIds: captureResult.capturePairs
      .filter(({ childFunctionId }) => childFunctionId === fn.id)
      .map(({ id }) => id),
    useIds: uses
      .filter(({ functionId }) => functionId === fn.id)
      .map(({ id }) => id),
    closeBindingIds: bindings
      .filter(({ ownerFunctionId }) => ownerFunctionId === fn.id)
      .map(({ id }) => id),
  }))
  return {
    schemaVersion: CLOSURE_SCHEMA,
    encoding: 'numeric-u32',
    wordCount: wordcodeData.words.length,
    instructionCount: wordcodeData.instructions.length,
    functionCount: functionData.functions.length,
    capturePairCount: captureResult.capturePairs.length,
    bindingCount: bindings.length,
    closureSiteCount: captureResult.closureSites.length,
    functions: functionSummary,
    capturePairs: captureResult.capturePairs,
    bindings,
    uses,
    closureSites: captureResult.closureSites,
    terminationEvents,
    source: {
      wordcodeSchema: WORDCODE_SCHEMA,
      referencesSchema: REFERENCE_SCHEMA,
      functionsSchema: FUNCTION_SCHEMA,
      cfgSchema: CFG_SCHEMA,
      callFramesSchema: CALL_FRAME_SCHEMA,
    },
  }
}

function buildClosureLifetimeResult(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
) {
  const wordcodeData = indexWordcode(wordcode)
  const functionData = indexFunctions(functions)
  const cfgData = indexCfg(cfg)
  const callFrameData = indexCallFrames(callFrames)
  return deepFreeze(
    buildResult(wordcodeData, functionData, cfgData, callFrameData),
  )
}

export function diagnoseClosureLifetimes(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
) {
  try {
    return deepFreeze({
      ok: true,
      result: buildClosureLifetimeResult(
        wordcode,
        references,
        functions,
        cfg,
        callFrames,
      ),
      diagnostic: null,
    })
  } catch (error) {
    const diagnostic = {
      code:
        error instanceof ClosureLifetimeDecline
          ? error.code
          : 'closure-lifetime-error',
      message: error instanceof Error ? error.message : String(error),
    }
    return deepFreeze({ ok: false, result: null, diagnostic })
  }
}

export function analyzeClosureLifetimes(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
) {
  const diagnosis = diagnoseClosureLifetimes(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  return diagnosis.ok ? diagnosis.result : null
}

export default analyzeClosureLifetimes
