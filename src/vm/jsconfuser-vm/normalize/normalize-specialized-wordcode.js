import { diagnoseSpecializedRuntime } from '../observe/observe-specialized-runtime.js'
import { diagnoseAntiRuntime } from '../observe/observe-anti-runtime.js'
import { diagnoseNormalizeAntiWordcode } from './normalize-anti-wordcode.js'
import {
  diagnoseNormalizeConcealedConstants,
  hasConcealedConstant,
} from './normalize-concealed-constants.js'
import { diagnoseNormalizeDispatcherWordcode } from './normalize-dispatcher-wordcode.js'
import { diagnoseFunctionPartition } from '../wordcode/partition-functions.js'
import { validateReferences } from '../wordcode/validate-references.js'
import {
  diagnoseAntiWordStream,
  diagnoseSpecializedWordStream,
  diagnoseWordcode,
} from '../wordcode/read-wordcode.js'
import {
  declineExpansion,
  acceptExpansion,
  refuseExpansion,
  unwrapExpansion,
  composePcMaps,
  expandObservedWordStream,
} from '../wordcode/expand-observed-word-stream.js'

export function normalizeExpandedSpecializedDispatcher(
  source,
  normalized,
  pcMap,
  suspects = [],
) {
  let wordcode = unwrapExpansion(diagnoseWordcode(normalized))
  let output = { container: normalized, wordcode, originPcMap: pcMap }
  if (wordcode.instructions.some(({ name }) => name === 'JUMP_REG')) {
    let prepared = normalized
    if (hasConcealedConstant(wordcode)) {
      const concealed = unwrapExpansion(
        diagnoseNormalizeConcealedConstants(source, prepared, wordcode),
      )
      prepared = concealed.container
      wordcode = concealed.wordcode
    }
    const references = validateReferences(prepared, wordcode)
    if (!references) {
      declineExpansion(
        'specialized-references',
        'Expanded stream has no valid references',
      )
    }
    const options = {
      decodedTargetMap: pcMap,
      suspects,
    }
    const functions = unwrapExpansion(
      diagnoseFunctionPartition(prepared, wordcode, references, {
        sharedParentSuspects: true,
      }),
    )
    const dispatcher = diagnoseNormalizeDispatcherWordcode(
      prepared,
      wordcode,
      functions,
      options,
    )
    if (dispatcher.ok) {
      const { pcMap: dispatcherPcMap, ...result } = dispatcher.result
      output = {
        ...result,
        originPcMap: composePcMaps(pcMap, dispatcherPcMap),
      }
    } else if (dispatcher.diagnostic.code !== 'no-dispatcher')
      unwrapExpansion(dispatcher)
  }
  return output
}

function recognize(
  source,
  container,
  { originPcMap = null, suspects = [] } = {},
) {
  const runtime = unwrapExpansion(diagnoseSpecializedRuntime(source))
  const stream = unwrapExpansion(
    diagnoseSpecializedWordStream(container, runtime),
  )
  const normalized = structuredClone(container)
  const expansion = expandObservedWordStream(stream, {
    includePcMap: true,
    originPcMap,
    suspects,
  })
  normalized.roles.words.values = expansion.words
  const output = normalizeExpandedSpecializedDispatcher(
    source,
    normalized,
    composePcMaps(originPcMap, expansion.pcMap),
    suspects,
  )
  return {
    ...output,
    schemaVersion: 'jsconfuser-vm-specialized-wordcode-normalization.v1',
    originalWordCount: stream.wordCount,
    expandedWordCount: normalized.roles.words.values.length,
    specializedInstructionCount: stream.instructions.filter(
      ({ name }) => name === 'SPECIALIZED',
    ).length,
  }
}

function recognizeAntiSpecialized(
  source,
  container,
  { originPcMap = null, suspects = [] } = {},
) {
  const anti = unwrapExpansion(
    diagnoseAntiRuntime(source, { allowSpecializedTail: true }),
  )
  const specialized = unwrapExpansion(
    diagnoseSpecializedRuntime(source, { allowAntiPrefix: true }),
  )
  const stream = unwrapExpansion(
    diagnoseSpecializedWordStream(container, specialized, anti),
  )
  const expanded = structuredClone(container)
  const expansion = expandObservedWordStream(stream, {
    includePcMap: true,
    originPcMap,
    suspects,
  })
  expanded.roles.words.values = expansion.words
  unwrapExpansion(diagnoseAntiWordStream(expanded, anti))
  const normalized = unwrapExpansion(
    diagnoseNormalizeAntiWordcode(source, expanded, {
      allowSpecializedTail: true,
      originPcMap: composePcMaps(originPcMap, expansion.pcMap),
      suspects,
    }),
  )
  return {
    ...normalized,
    schemaVersion: 'jsconfuser-vm-anti-specialized-wordcode-normalization.v1',
    originalWordCount: stream.wordCount,
    specializedInstructionCount: stream.instructions.filter(
      ({ name }) => name === 'SPECIALIZED',
    ).length,
    syntheticInstructionCount: normalized.syntheticInstructionCount,
  }
}

export function diagnoseNormalizeAntiSpecializedWordcode(
  source,
  container,
  options,
) {
  try {
    return acceptExpansion(
      recognizeAntiSpecialized(source, container, options),
      { fallback: 'anti-specialized-normalization-error' },
    )
  } catch (error) {
    return refuseExpansion(error, {
      fallback: 'anti-specialized-normalization-error',
    })
  }
}

export function diagnoseNormalizeSpecializedWordcode(
  source,
  container,
  options,
) {
  try {
    return acceptExpansion(recognize(source, container, options), {
      fallback: 'specialized-normalization-error',
    })
  } catch (error) {
    return refuseExpansion(error, {
      fallback: 'specialized-normalization-error',
    })
  }
}
