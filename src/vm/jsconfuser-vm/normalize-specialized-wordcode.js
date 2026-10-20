import { diagnoseSpecializedRuntime } from './observe-specialized-runtime.js'
import { diagnoseAntiRuntime } from './analyze-anti-runtime.js'
import { diagnoseNormalizeAntiWordcode } from './normalize-anti-wordcode.js'
import { diagnoseNormalizeConcealedConstants } from './normalize-concealed-constants.js'
import { diagnoseNormalizeDispatcherWordcode } from './normalize-dispatcher-wordcode.js'
import { diagnoseFunctionPartition } from './partition-functions.js'
import { validateReferences } from './validate-references.js'
import {
  diagnoseAntiWordStream,
  diagnoseSpecializedWordStream,
  diagnoseWordcode,
} from './read-wordcode.js'
import {
  ObservedExpansionDecline,
  composePcMaps,
  expandObservedWordStream,
} from './expand-observed-word-stream.js'

function requireObservation(diagnosis) {
  if (!diagnosis.ok) {
    throw new ObservedExpansionDecline(
      diagnosis.diagnostic.code,
      diagnosis.diagnostic.message,
    )
  }
  return diagnosis.result
}

export function normalizeExpandedSpecializedDispatcher(
  source,
  normalized,
  pcMap,
  suspects = [],
) {
  let wordcode = requireObservation(diagnoseWordcode(normalized))
  let output = { container: normalized, wordcode, originPcMap: pcMap }
  if (wordcode.instructions.some(({ name }) => name === 'JUMP_REG')) {
    let prepared = normalized
    if (
      wordcode.instructions.some((instruction) =>
        instruction.operands.some(
          (operand) =>
            operand.kind === 'constant-ref' && operand.concealKey !== 0,
        ),
      )
    ) {
      const concealed = requireObservation(
        diagnoseNormalizeConcealedConstants(source, prepared, wordcode),
      )
      prepared = concealed.container
      wordcode = concealed.wordcode
    }
    const references = validateReferences(prepared, wordcode)
    if (!references) {
      throw new ObservedExpansionDecline(
        'specialized-references',
        'Expanded stream has no valid references',
      )
    }
    const counts = new Map()
    for (const descriptor of references.frame.descriptors) {
      if (descriptor.paramCount !== 4 || descriptor.captureCount !== 0) continue
      counts.set(descriptor.startPc, (counts.get(descriptor.startPc) ?? 0) + 1)
    }
    const shared = [...counts]
      .filter(([, count]) => count > 1)
      .map(([pc]) => pc)
    if (shared.length > 1) {
      throw new ObservedExpansionDecline(
        'specialized-functions',
        'More than one shared string helper was observed',
      )
    }
    const options = {
      allowSharedParentStarts: new Set(shared),
      deferControlFlow: true,
      decodedTargetMap: pcMap,
      suspects,
    }
    const functions = requireObservation(
      diagnoseFunctionPartition(prepared, wordcode, references, options),
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
      requireObservation(dispatcher)
  }
  return output
}

function recognize(
  source,
  container,
  { originPcMap = null, suspects = [] } = {},
) {
  const runtime = requireObservation(diagnoseSpecializedRuntime(source))
  const stream = requireObservation(
    diagnoseSpecializedWordStream(container, runtime),
  )
  const normalized = structuredClone(container)
  const expansion = expandObservedWordStream(stream, {
    includePcMap: true,
    originPcMap,
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
  const anti = requireObservation(
    diagnoseAntiRuntime(source, { allowSpecializedTail: true }),
  )
  const specialized = requireObservation(
    diagnoseSpecializedRuntime(source, { allowAntiPrefix: true }),
  )
  const stream = requireObservation(
    diagnoseSpecializedWordStream(container, specialized, anti),
  )
  const expanded = structuredClone(container)
  const expansion = expandObservedWordStream(stream, {
    includePcMap: true,
    originPcMap,
  })
  expanded.roles.words.values = expansion.words
  requireObservation(diagnoseAntiWordStream(expanded, anti))
  const normalized = requireObservation(
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
    return {
      ok: true,
      result: recognizeAntiSpecialized(source, container, options),
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
        code: 'anti-specialized-normalization-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export function diagnoseNormalizeSpecializedWordcode(
  source,
  container,
  options,
) {
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
        code: 'specialized-normalization-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
