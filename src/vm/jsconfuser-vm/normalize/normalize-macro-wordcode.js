import { diagnoseMacroRuntime } from '../observe/observe-macro-runtime.js'
import { diagnoseAntiRuntime } from '../observe/observe-anti-runtime.js'
import { diagnoseSpecializedRuntime } from '../observe/observe-specialized-runtime.js'
import { diagnoseNormalizeAntiWordcode } from './normalize-anti-wordcode.js'
import { normalizeExpandedSpecializedDispatcher } from './normalize-specialized-wordcode.js'
import {
  acceptExpansion,
  refuseExpansion,
  unwrapExpansion,
  composePcMaps,
  expandObservedWordStream,
} from '../wordcode/expand-observed-word-stream.js'
import { diagnoseMacroWordStream } from '../wordcode/read-wordcode.js'

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
  const runtime = unwrapExpansion(
    diagnoseMacroRuntime(source, {
      antiObservation: anti,
      specializedObservation: specialized,
    }),
  )
  const stream = unwrapExpansion(
    diagnoseMacroWordStream(container, runtime, specialized, anti),
  )
  const normalized = structuredClone(container)
  const expansion = expandObservedWordStream(stream, {
    includePcMap: true,
    originPcMap,
    suspects,
  })
  const pcMap = composePcMaps(originPcMap, expansion.pcMap)
  normalized.roles.words.values = expansion.words
  let output
  if (anti) {
    output = unwrapExpansion(
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
    return acceptExpansion(recognize(source, container, options), {
      fallback: 'macro-normalization-error',
    })
  } catch (error) {
    return refuseExpansion(error, {
      fallback: 'macro-normalization-error',
    })
  }
}
