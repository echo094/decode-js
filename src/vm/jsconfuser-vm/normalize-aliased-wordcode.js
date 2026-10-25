import { diagnoseAliasedRuntime } from './observe-aliased-runtime.js'
import {
  diagnoseAliasedWordStream,
  diagnoseAntiWordStream,
  diagnoseSpecializedWordStream,
  diagnoseMacroWordStream,
  diagnoseWordcode,
} from './read-wordcode.js'
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

const DIRECT_TARGET_OFFSETS = Object.freeze({
  JUMP: [1],
  JUMP_IF_FALSE: [2],
  JUMP_IF_TRUE: [2],
  FOR_IN_NEXT: [3],
  TRY_SETUP: [1],
  FINALLY_SETUP: [1, 4],
  MAKE_CLOSURE: [2],
})

// An alias keeps its operands in origin space when an earlier stage moved code. Translate the
// projected direct targets, and the continuation literals that stage proved (output PC -> step
// indexes; an alias has one step), through originPcMap.
function translateAliasAddresses(
  projected,
  originPcMap,
  originContinuationLoads,
) {
  const fromOrigin = (target) => {
    if (!originPcMap.has(target)) {
      throw new AliasNormalizationDecline(
        'origin-target-boundary',
        `Alias target ${target} has no origin instruction boundary`,
      )
    }
    return originPcMap.get(target)
  }
  for (const item of projected.filter(({ alias }) => alias)) {
    for (const offset of DIRECT_TARGET_OFFSETS[item.name] ?? [])
      item.words[offset] = fromOrigin(item.words[offset])
    if (originContinuationLoads?.get(item.pc)?.includes(0))
      item.words[2] = fromOrigin(item.words[2])
  }
}

class AliasNormalizationDecline extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function requireObservation(diagnosis) {
  if (!diagnosis.ok) {
    throw new AliasNormalizationDecline(
      diagnosis.diagnostic.code,
      diagnosis.diagnostic.message,
    )
  }
  return diagnosis.result
}

function recognize(
  source,
  container,
  {
    allowObservedPrefix = false,
    originPcMap = null,
    originContinuationLoads = null,
    suspects = [],
  } = {},
) {
  const mixed = allowObservedPrefix
  const antiDiagnosis = mixed
    ? diagnoseAntiRuntime(source, { allowSpecializedTail: true })
    : null
  const anti = antiDiagnosis?.ok ? antiDiagnosis.result : null
  const specializedDiagnosis = mixed
    ? diagnoseSpecializedRuntime(source, {
        allowAntiPrefix: Boolean(anti),
        allowMacroTail: true,
      })
    : null
  const specialized = specializedDiagnosis?.ok
    ? specializedDiagnosis.result
    : null
  const macroDiagnosis = mixed
    ? diagnoseMacroRuntime(source, {
        antiObservation: anti,
        specializedObservation: specialized,
        allowAliasTail: true,
      })
    : null
  const macro = macroDiagnosis?.ok ? macroDiagnosis.result : null
  if (mixed && !anti && !specialized && !macro) {
    throw new AliasNormalizationDecline(
      'alias-prefix-unproved',
      'No earlier opcode prefix was proved',
    )
  }
  const runtime = requireObservation(
    diagnoseAliasedRuntime(source, {
      antiObservation: anti,
      specializedObservation: specialized,
      macroObservation: macro,
    }),
  )
  const stream = requireObservation(
    diagnoseAliasedWordStream(container, runtime, {
      antiObservation: anti,
      specializedObservation: specialized,
      macroObservation: macro,
    }),
  )
  const byOpcode = new Map(
    runtime.aliases.map((entry) => [entry.opcode, entry]),
  )
  const projected = stream.instructions.map((instruction) => {
    const kept = { pc: instruction.pc, name: instruction.name, alias: false }
    if (instruction.name !== 'SYNTHETIC')
      return { ...kept, words: instruction.words }
    const alias = byOpcode.get(instruction.opcode.value)
    if (!alias && anti) return { ...kept, words: instruction.words }
    if (!alias)
      throw new AliasNormalizationDecline(
        'alias-opcode-mismatch',
        'Alias word stream has no matching runtime case',
      )
    return {
      pc: instruction.pc,
      name: alias.originalName,
      alias: true,
      words: [alias.originalOpcode, ...instruction.canonicalOperands],
    }
  })
  if (originPcMap)
    translateAliasAddresses(projected, originPcMap, originContinuationLoads)
  const words = projected.flatMap(({ words }) => words)
  const normalized = structuredClone(container)
  normalized.roles.words.values = words
  // Projection keeps every width, so without a later expansion the incoming map still holds.
  let output = { container: normalized, originPcMap }
  if (anti || specialized || macro) {
    const projectedStream = requireObservation(
      macro
        ? diagnoseMacroWordStream(normalized, macro, specialized, anti)
        : specialized
          ? diagnoseSpecializedWordStream(normalized, specialized, anti)
          : diagnoseAntiWordStream(normalized, anti),
    )
    const expansion = expandObservedWordStream(projectedStream, {
      includePcMap: true,
      originPcMap,
    })
    const pcMap = composePcMaps(originPcMap, expansion.pcMap)
    const expanded = structuredClone(normalized)
    expanded.roles.words.values = expansion.words
    output = anti
      ? requireObservation(
          diagnoseNormalizeAntiWordcode(source, expanded, {
            allowSpecializedTail: true,
            originPcMap: pcMap,
            suspects,
          }),
        )
      : normalizeExpandedSpecializedDispatcher(
          source,
          expanded,
          pcMap,
          suspects,
        )
  }
  if (!output.wordcode)
    output = {
      ...output,
      wordcode: requireObservation(diagnoseWordcode(output.container)),
    }
  return {
    ...output,
    schemaVersion: 'jsconfuser-vm-aliased-wordcode-normalization.v1',
    originalWordCount: stream.wordCount,
    aliasedInstructionCount: stream.instructions.filter(
      ({ name, opcode }) => name === 'SYNTHETIC' && byOpcode.has(opcode.value),
    ).length,
    macroInstructionCount: stream.instructions.filter(
      ({ name }) => name === 'MACRO',
    ).length,
  }
}

export function diagnoseNormalizeAliasedWordcode(source, container, options) {
  try {
    return {
      ok: true,
      result: recognize(source, container, options),
      diagnostic: null,
    }
  } catch (error) {
    if (
      error instanceof AliasNormalizationDecline ||
      error instanceof ObservedExpansionDecline
    ) {
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
        code: 'alias-normalization-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
