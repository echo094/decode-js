import { selectContinuationLoads } from '../wordcode/finally-continuations.js'
import {
  decline,
  accepted,
  refused,
  decodedSuspects,
  diagnoseDispatcherWordcode,
  unwrap,
} from './analyze-dispatcher-wordcode.js'
import { diagnoseWordcode } from '../wordcode/read-wordcode.js'
import { diagnoseReferences } from '../wordcode/validate-references.js'
import {
  diagnoseFunctionPartition,
  functionIndexAt,
} from '../wordcode/partition-functions.js'
import { LABEL_WORD_OFFSETS } from '../wordcode/wordcode-operands.js'

// The observed routes by start PC, the PCs the routes consume, and the PCs removed: each hoist,
// each dispatcher and each decode closure.
function planRoutes(observation, functions) {
  const routeByStart = new Map()
  const consumed = new Set()
  const removed = new Set()
  for (const plan of observation.plans) {
    removed.add(plan.hoistPc)
    for (const pc of plan.dispatcherPcs) removed.add(pc)
    const closure = functions.functions.find(
      (item) => item.id === plan.closureId,
    )
    if (!closure)
      decline('dispatcher-closure', 'Decode closure owner is missing')
    for (const pc of closure.instructionPcs) removed.add(pc)
    for (const route of plan.routes) {
      if (routeByStart.has(route.startPc)) {
        decline('dispatcher-shape', 'Dispatcher routes share a start PC')
      }
      routeByStart.set(route.startPc, route)
      for (const pc of route.oldPcs) consumed.add(pc)
    }
  }
  for (const pc of consumed) {
    if (removed.has(pc))
      decline('dispatcher-shape', 'A route overlaps removed code')
  }
  const hoists = new Set(observation.plans.map(({ hoistPc }) => hoistPc))
  return { routeByStart, consumed, removed, hoists }
}

// The written parts at their new PCs and each old PC's new one (`pcMap`): a route's start writes
// its jump, consumed and removed code nothing (a removed hoist keeps its PC), any other
// instruction itself.
function rewriteParts(instructions, routes, opcodes) {
  const { routeByStart, consumed, removed, hoists } = routes
  const pcMap = new Map()
  const parts = []
  let nextPc = 0
  for (const instruction of instructions) {
    const route = routeByStart.get(instruction.pc)
    if (route) {
      pcMap.set(instruction.pc, nextPc)
      const words =
        route.name === 'JUMP'
          ? [opcodes.JUMP, route.target]
          : [opcodes[route.name], route.condition, route.target]
      parts.push({
        originPc: instruction.pc,
        pc: nextPc,
        name: route.name,
        words,
      })
      nextPc += words.length
    } else if (consumed.has(instruction.pc)) {
      continue
    } else if (removed.has(instruction.pc)) {
      if (hoists.has(instruction.pc)) pcMap.set(instruction.pc, nextPc)
    } else {
      pcMap.set(instruction.pc, nextPc)
      parts.push({
        originPc: instruction.pc,
        pc: nextPc,
        name: instruction.name,
        words: instruction.words.slice(),
      })
      nextPc += instruction.width
    }
  }
  return { parts, pcMap, nextPc }
}

function remapTarget(pcMap, target) {
  if (!pcMap.has(target)) {
    decline(
      'dispatcher-target-boundary',
      `Target ${target} is removed by normalization`,
    )
  }
  return pcMap.get(target)
}

// The parts' words, every label and each continuation load's target at its new PC.
function remapWords(parts, pcMap, functions, partitionOptions) {
  // A PATCH suspect is read past: a suspect load keeps its words until its owner settles it.
  const suspects = decodedSuspects(
    partitionOptions?.suspects ?? [],
    partitionOptions?.decodedTargetMap,
  )
  const continuationLoads = selectContinuationLoads(
    parts.map((part) => ({
      pc: part.originPc,
      key: part.pc,
      functionId: functionIndexAt(functions, part.originPc),
      name: part.name,
      words: part.words,
    })),
    suspects,
  )
  return parts.flatMap((part) => {
    const raw = part.words.slice()
    for (const offset of LABEL_WORD_OFFSETS[part.name] ?? []) {
      raw[offset] = remapTarget(pcMap, raw[offset])
    }
    if (continuationLoads.has(part.pc)) raw[2] = remapTarget(pcMap, raw[2])
    return raw
  })
}

// The normalized container's records, read again.
function rereadRecords(normalized, functions, pcMap) {
  const wordcode = unwrap(diagnoseWordcode(normalized))
  const references = unwrap(diagnoseReferences(normalized, wordcode))
  const sharedParentSuspects = new Set(
    functions.sharedParentStarts.map((pc) => remapTarget(pcMap, pc)),
  )
  const nextFunctions = unwrap(
    diagnoseFunctionPartition(normalized, wordcode, references, {
      sharedParentSuspects,
    }),
  )
  return { wordcode, references, functions: nextFunctions }
}

function recognize(container, wordcode, functions, partitionOptions) {
  const observation = unwrap(
    diagnoseDispatcherWordcode(
      container,
      wordcode,
      functions,
      partitionOptions?.decodedTargetMap,
      partitionOptions?.suspects,
    ),
  )
  const { parts, pcMap, nextPc } = rewriteParts(
    wordcode.instructions,
    planRoutes(observation, functions),
    container.roles.op.values,
  )
  pcMap.set(wordcode.wordCount, nextPc)
  const words = remapWords(parts, pcMap, functions, partitionOptions)
  if (words.length !== nextPc) {
    decline(
      'dispatcher-width',
      'Normalized word stream did not consume its PC map',
    )
  }
  const normalized = structuredClone(container)
  normalized.roles.words.values = words
  const records = rereadRecords(normalized, functions, pcMap)
  return {
    schemaVersion: 'jsconfuser-vm-dispatcher-normalization.v1',
    container: normalized,
    wordcode: records.wordcode,
    references: records.references,
    functions: records.functions,
    pcMap,
    originalWordCount: wordcode.wordCount,
    normalizedWordCount: words.length,
    routeCount: observation.plans.reduce(
      (count, plan) => count + plan.routes.length,
      0,
    ),
    decoderClosureCount: observation.plans.length,
    // Labels the rewritten conditional routes reach by fallthrough, as the encoder wrote them.
    skipLabels: observation.plans.flatMap((plan) =>
      plan.routes
        .filter(({ skipOrigin }) => skipOrigin !== undefined)
        .map(({ skipOrigin }) => skipOrigin),
    ),
  }
}

export function diagnoseNormalizeDispatcherWordcode(
  container,
  wordcode,
  functions,
  partitionOptions,
) {
  try {
    return accepted(
      recognize(container, wordcode, functions, partitionOptions),
      { fallback: 'dispatcher-normalization-error' },
    )
  } catch (error) {
    return refused(error, { fallback: 'dispatcher-normalization-error' })
  }
}
