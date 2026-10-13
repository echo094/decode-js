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
  expandObservedWordStream,
} from './expand-observed-word-stream.js'

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

function recognize(source, container, { allowObservedPrefix = false } = {}) {
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
  const words = stream.instructions.flatMap((instruction) => {
    if (instruction.name !== 'SYNTHETIC') return instruction.words
    const alias = byOpcode.get(instruction.opcode.value)
    if (!alias && anti) return instruction.words
    if (!alias)
      throw new AliasNormalizationDecline(
        'alias-opcode-mismatch',
        'Alias word stream has no matching runtime case',
      )
    return [alias.originalOpcode, ...instruction.canonicalOperands]
  })
  const normalized = structuredClone(container)
  normalized.roles.words.values = words
  let output = { container: normalized }
  if (anti || specialized || macro) {
    const projectedStream = requireObservation(
      macro
        ? diagnoseMacroWordStream(normalized, macro, specialized, anti)
        : specialized
          ? diagnoseSpecializedWordStream(normalized, specialized, anti)
          : diagnoseAntiWordStream(normalized, anti),
    )
    const expansion = expandObservedWordStream(projectedStream, anti, {
      includePcMap: true,
      ownerWideContinuations: Boolean(anti || specialized),
    })
    const expanded = structuredClone(normalized)
    expanded.roles.words.values = expansion.words
    output = anti
      ? requireObservation(
          diagnoseNormalizeAntiWordcode(source, expanded, {
            allowSpecializedTail: true,
            preExpandedPcMap: expansion.pcMap,
          }),
        )
      : normalizeExpandedSpecializedDispatcher(
          source,
          expanded,
          expansion.pcMap,
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
