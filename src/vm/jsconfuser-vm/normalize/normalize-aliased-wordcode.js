import { declines } from '../../decline.js'
import { diagnoseAliasedRuntime } from '../observe/observe-aliased-runtime.js'
import {
  diagnoseAliasedWordStream,
  diagnoseAntiWordStream,
  diagnoseMacroWordStream,
  diagnoseSpecializedWordStream,
  diagnoseWordcode,
} from '../wordcode/read-wordcode.js'
import { diagnoseMacroRuntime } from '../observe/observe-macro-runtime.js'
import { diagnoseAntiRuntime } from '../observe/observe-anti-runtime.js'
import { diagnoseSpecializedRuntime } from '../observe/observe-specialized-runtime.js'
import { diagnoseNormalizeAntiWordcode } from './normalize-anti-wordcode.js'
import { normalizeExpandedSpecializedDispatcher } from './normalize-specialized-wordcode.js'
import {
  composePcMaps,
  expandObservedWordStream,
} from '../wordcode/expand-observed-word-stream.js'
import { LABEL_WORD_OFFSETS } from '../wordcode/wordcode-operands.js'

const { decline, unwrap, accepted, refused } = declines('aliased-normalization')

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
      decline(
        'origin-target-boundary',
        `Alias target ${target} has no origin instruction boundary`,
      )
    }
    return originPcMap.get(target)
  }
  for (const item of projected.filter(({ alias }) => alias)) {
    for (const offset of LABEL_WORD_OFFSETS[item.name] ?? [])
      item.words[offset] = fromOrigin(item.words[offset])
    if (originContinuationLoads?.get(item.pc)?.includes(0))
      item.words[2] = fromOrigin(item.words[2])
  }
}

// The earlier opcode stages a mixed runtime proves before its aliases, `{ anti, specialized, macro }`
// (each null when unproved, all null when the runtime is not mixed).
function observePrefix(source, mixed) {
  if (!mixed) return { anti: null, specialized: null, macro: null }
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
  const macroDiagnosis = diagnoseMacroRuntime(source, {
    antiObservation: anti,
    specializedObservation: specialized,
    allowAliasTail: true,
  })
  const macro = macroDiagnosis.ok ? macroDiagnosis.result : null
  if (!anti && !specialized && !macro) {
    decline('alias-prefix-unproved', 'No earlier opcode prefix was proved')
  }
  return { anti, specialized, macro }
}

// Each instruction's words with every alias written as its original operation.
function projectAliases(stream, byOpcode, anti) {
  return stream.instructions.map((instruction) => {
    const kept = { pc: instruction.pc, name: instruction.name, alias: false }
    if (instruction.name !== 'SYNTHETIC')
      return { ...kept, words: instruction.words }
    const alias = byOpcode.get(instruction.opcode.value)
    if (!alias && anti) return { ...kept, words: instruction.words }
    if (!alias)
      decline(
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
}

// The projected container with the proved prefix's opcodes expanded and normalized by their own
// stage: anti, or the specialized dispatcher (macros included).
function expandPrefix(source, normalized, prefix, { originPcMap, suspects }) {
  const { anti, specialized, macro } = prefix
  const projectedStream = unwrap(
    macro
      ? diagnoseMacroWordStream(normalized, macro, specialized, anti)
      : specialized
        ? diagnoseSpecializedWordStream(normalized, specialized, anti)
        : diagnoseAntiWordStream(normalized, anti),
  )
  const expansion = expandObservedWordStream(projectedStream, {
    includePcMap: true,
    originPcMap,
    suspects,
  })
  const pcMap = composePcMaps(originPcMap, expansion.pcMap)
  const expanded = structuredClone(normalized)
  expanded.roles.words.values = expansion.words
  return anti
    ? unwrap(
        diagnoseNormalizeAntiWordcode(source, expanded, {
          allowSpecializedTail: true,
          originPcMap: pcMap,
          suspects,
        }),
      )
    : normalizeExpandedSpecializedDispatcher(source, expanded, pcMap, suspects)
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
  const prefix = observePrefix(source, allowObservedPrefix)
  const observations = {
    antiObservation: prefix.anti,
    specializedObservation: prefix.specialized,
    macroObservation: prefix.macro,
  }
  const runtime = unwrap(diagnoseAliasedRuntime(source, observations))
  const stream = unwrap(
    diagnoseAliasedWordStream(container, runtime, observations),
  )
  const byOpcode = new Map(
    runtime.aliases.map((entry) => [entry.opcode, entry]),
  )
  const projected = projectAliases(stream, byOpcode, prefix.anti)
  if (originPcMap)
    translateAliasAddresses(projected, originPcMap, originContinuationLoads)
  const normalized = structuredClone(container)
  normalized.roles.words.values = projected.flatMap(({ words }) => words)
  // Projection keeps every width, so without a later expansion the incoming map still holds.
  let output =
    prefix.anti || prefix.specialized || prefix.macro
      ? expandPrefix(source, normalized, prefix, { originPcMap, suspects })
      : { container: normalized, originPcMap }
  if (!output.wordcode)
    output = {
      ...output,
      wordcode: unwrap(diagnoseWordcode(output.container)),
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
    return accepted(recognize(source, container, options), {
      fallback: 'alias-normalization-error',
      owners: ['aliased-normalization', 'observed-expansion'],
    })
  } catch (error) {
    return refused(error, {
      fallback: 'alias-normalization-error',
      owners: ['aliased-normalization', 'observed-expansion'],
    })
  }
}
