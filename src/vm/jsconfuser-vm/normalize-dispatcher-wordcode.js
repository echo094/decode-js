import {
  diagnoseDispatcherWordcode,
  DispatcherDecline,
} from './observe-dispatcher-wordcode.js'
import { diagnoseWordcode } from './read-wordcode.js'
import { diagnoseReferences } from './validate-references.js'
import { diagnoseFunctionPartition } from './partition-functions.js'
import { diagnoseControlFlow } from './build-cfg.js'

const DIRECT_TARGET_OFFSETS = Object.freeze({
  JUMP: [1],
  JUMP_IF_FALSE: [2],
  JUMP_IF_TRUE: [2],
  FOR_IN_NEXT: [3],
  TRY_SETUP: [1],
  FINALLY_SETUP: [1, 4],
  MAKE_CLOSURE: [2],
})

function decline(code, message) {
  throw new DispatcherDecline(code, message)
}

function requireObservation(diagnosis) {
  if (!diagnosis.ok) {
    decline(diagnosis.diagnostic.code, diagnosis.diagnostic.message)
  }
  return diagnosis.result
}

function recognize(container, wordcode, functions, partitionOptions) {
  const observation = requireObservation(
    diagnoseDispatcherWordcode(
      container,
      wordcode,
      functions,
      partitionOptions?.decodedTargetMap,
    ),
  )
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

  const opcodes = container.roles.op.values
  const pcMap = new Map()
  const parts = []
  let nextPc = 0
  for (const instruction of wordcode.instructions) {
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
      if (observation.plans.some((plan) => plan.hoistPc === instruction.pc)) {
        pcMap.set(instruction.pc, nextPc)
      }
      continue
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
  pcMap.set(wordcode.wordCount, nextPc)
  const remap = (target) => {
    if (!pcMap.has(target)) {
      decline(
        'dispatcher-target-boundary',
        `Target ${target} is removed by normalization`,
      )
    }
    return pcMap.get(target)
  }
  const continuationLoads = new Set()
  for (const setup of parts.filter((part) => part.name === 'FINALLY_SETUP')) {
    const continuation = setup.words[2]
    const owner = functions.functions.find(
      (fn) => setup.originPc >= fn.startPc && setup.originPc < fn.endPc,
    )
    for (const part of parts) {
      if (
        part.name === 'LOAD_INT' &&
        part.originPc >= owner.startPc &&
        part.originPc < owner.endPc &&
        part.words[1] === continuation &&
        pcMap.has(part.words[2])
      ) {
        continuationLoads.add(part.pc)
      }
    }
  }
  const words = parts.flatMap((part) => {
    const raw = part.words.slice()
    for (const offset of DIRECT_TARGET_OFFSETS[part.name] ?? []) {
      raw[offset] = remap(raw[offset])
    }
    if (continuationLoads.has(part.pc)) raw[2] = remap(raw[2])
    return raw
  })
  if (words.length !== nextPc) {
    decline(
      'dispatcher-width',
      'Normalized word stream did not consume its PC map',
    )
  }
  const normalized = structuredClone(container)
  normalized.roles.words.values = words
  const newWordcode = requireObservation(diagnoseWordcode(normalized))
  const references = requireObservation(
    diagnoseReferences(normalized, newWordcode),
  )
  const nextPartitionOptions = partitionOptions && {
    allowSharedParentStarts: new Set(
      [...partitionOptions.allowSharedParentStarts].map(remap),
    ),
  }
  const newFunctions = requireObservation(
    diagnoseFunctionPartition(
      normalized,
      newWordcode,
      references,
      nextPartitionOptions,
    ),
  )
  const cfg = partitionOptions?.deferControlFlow
    ? null
    : requireObservation(
        diagnoseControlFlow(newWordcode, references, newFunctions),
      )
  return {
    schemaVersion: 'jsconfuser-vm-dispatcher-normalization.v1',
    container: normalized,
    wordcode: newWordcode,
    references,
    functions: newFunctions,
    cfg,
    originalWordCount: wordcode.wordCount,
    normalizedWordCount: words.length,
    routeCount: observation.plans.reduce(
      (count, plan) => count + plan.routes.length,
      0,
    ),
    decoderClosureCount: observation.plans.length,
  }
}

export function diagnoseNormalizeDispatcherWordcode(
  container,
  wordcode,
  functions,
  partitionOptions,
) {
  try {
    return {
      ok: true,
      result: recognize(container, wordcode, functions, partitionOptions),
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof DispatcherDecline
            ? error.code
            : 'dispatcher-normalization-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
