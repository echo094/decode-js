import { diagnoseMacroRuntime } from './observe-macro-runtime.js'
import { diagnoseAntiRuntime } from './analyze-anti-runtime.js'
import { diagnoseSpecializedRuntime } from './observe-specialized-runtime.js'
import { diagnoseNormalizeAntiWordcode } from './normalize-anti-wordcode.js'
import { normalizeExpandedSpecializedDispatcher } from './normalize-specialized-wordcode.js'
import {
  ObservedExpansionDecline,
  composePcMaps,
  expandObservedWordStream,
} from './expand-observed-word-stream.js'
import { diagnoseMacroWordStream } from './read-wordcode.js'

function requireObservation(diagnosis) {
  if (!diagnosis.ok) {
    throw new ObservedExpansionDecline(
      diagnosis.diagnostic.code,
      diagnosis.diagnostic.message,
    )
  }
  return diagnosis.result
}

function recognize(
  source,
  container,
  { originPcMap = null, suspects = [] } = {},
) {
  const antiDiagnosis = diagnoseAntiRuntime(source, {
    allowSpecializedTail: true,
  })
  const anti = antiDiagnosis.ok ? antiDiagnosis.result : null
  const specializedDiagnosis = diagnoseSpecializedRuntime(source, {
    allowAntiPrefix: Boolean(anti),
    allowMacroTail: true,
  })
  const specialized = specializedDiagnosis.ok
    ? specializedDiagnosis.result
    : null
  const runtime = requireObservation(
    diagnoseMacroRuntime(source, {
      antiObservation: anti,
      specializedObservation: specialized,
    }),
  )
  const stream = requireObservation(
    diagnoseMacroWordStream(container, runtime, specialized, anti),
  )
  const normalized = structuredClone(container)
  const expansion = expandObservedWordStream(stream, {
    includePcMap: true,
    originPcMap,
  })
  const pcMap = composePcMaps(originPcMap, expansion.pcMap)
  normalized.roles.words.values = expansion.words
  let output
  if (anti) {
    output = requireObservation(
      diagnoseNormalizeAntiWordcode(source, normalized, {
        allowSpecializedTail: true,
        originPcMap: pcMap,
        suspects,
      }),
    )
  } else {
    output = normalizeExpandedSpecializedDispatcher(
      source,
      normalized,
      pcMap,
      suspects,
    )
  }
  return {
    ...output,
    schemaVersion: 'jsconfuser-vm-macro-wordcode-normalization.v1',
    originalWordCount: stream.wordCount,
    expandedWordCount: normalized.roles.words.values.length,
    macroInstructionCount: stream.instructions.filter(
      ({ name }) => name === 'MACRO',
    ).length,
  }
}

export function diagnoseNormalizeMacroWordcode(source, container, options) {
  try {
    return {
      ok: true,
      result: recognize(source, container, options),
      diagnostic: null,
    }
  } catch (error) {
    if (error instanceof ObservedExpansionDecline) {
      return {
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      }
    }
    return {
      ok: false,
      result: null,
      diagnostic: {
        code: 'macro-normalization-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
