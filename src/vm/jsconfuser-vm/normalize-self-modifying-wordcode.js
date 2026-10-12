import { diagnoseSelfModifyingRegions } from './observe-self-modifying.js'
import { diagnoseWordcode } from './read-wordcode.js'
import { validateReferences } from './validate-references.js'
import { partitionFunctions } from './partition-functions.js'
import { buildControlFlow } from './build-cfg.js'
import { diagnosePatchFamilies } from './observe-patch-families.js'
import { diagnoseNormalizeAntiWordcode } from './normalize-anti-wordcode.js'

const DIRECT_TARGET_OFFSETS = Object.freeze({
  JUMP: [1],
  JUMP_IF_FALSE: [2],
  JUMP_IF_TRUE: [2],
  FOR_IN_NEXT: [3],
  TRY_SETUP: [1],
  FINALLY_SETUP: [1, 4],
  MAKE_CLOSURE: [2],
})

class NormalizationDecline extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function decline(code, message) {
  throw new NormalizationDecline(code, message)
}

function remapWords(container, observation, families) {
  const instructions = observation.reachableInstructions
  const pcMap = new Map()
  let nextPc = 0
  for (const instruction of instructions) {
    pcMap.set(instruction.pc, nextPc)
    if (instruction.name !== 'PATCH')
      nextPc +=
        instruction.steps && instruction.name !== 'SYNTHETIC'
          ? instruction.steps.reduce((sum, step) => sum + step.words.length, 0)
          : instruction.width
  }
  const remap = (pc) => {
    if (!pcMap.has(pc)) {
      decline('self-modifying-target', `PC ${pc} is not recovered code`)
    }
    return pcMap.get(pc)
  }
  const continuationLoads = new Map()
  for (const jump of observation.indirectTargets) {
    for (const [target, origins] of Object.entries(jump.origins)) {
      remap(Number(target))
      for (const origin of origins) {
        if (origin.startsWith('exception@')) continue
        const pc = Number(origin)
        const prior = continuationLoads.get(pc)
        if (prior !== undefined && prior !== Number(target)) {
          decline(
            'self-modifying-target',
            `LOAD_INT@${pc} has conflicting targets`,
          )
        }
        continuationLoads.set(pc, Number(target))
      }
    }
  }
  const compact = []
  for (const instruction of instructions) {
    if (instruction.name === 'PATCH') continue
    const steps =
      instruction.name === 'SYNTHETIC'
        ? [instruction]
        : (instruction.steps ?? [instruction])
    for (const step of steps) {
      const raw = step.words.slice()
      for (const offset of DIRECT_TARGET_OFFSETS[step.name] ?? [])
        raw[offset] = remap(raw[offset])
      if (instruction.name === 'SYNTHETIC') {
        const definition = families.anti.syntheticCases.find(
          (entry) => entry.opcode === instruction.opcode.value,
        )
        for (const effect of definition.steps) {
          if (
            effect.name === 'JUMP_IF_FALSE' ||
            effect.name === 'JUMP_IF_TRUE'
          ) {
            const offset =
              1 + definition.canonicalToStored[effect.operandStart + 1]
            raw[offset] = remap(raw[offset])
          }
        }
      }
      if (
        step.name === 'LOAD_INT' &&
        continuationLoads.has(instruction.pc) &&
        raw[2] === continuationLoads.get(instruction.pc)
      )
        raw[2] = remap(raw[2])
      compact.push(...raw)
    }
  }
  const normalized = structuredClone(container)
  normalized.roles.words.values = compact
  return { container: normalized, pcMap }
}

export function diagnoseNormalizeSelfModifyingWordcode(
  container,
  { source = null } = {},
) {
  try {
    const runtime = source
      ? diagnosePatchFamilies(source)
      : { ok: true, result: {} }
    if (!runtime.ok)
      decline(runtime.diagnostic.code, runtime.diagnostic.message)
    const families = runtime.result
    const observed = diagnoseSelfModifyingRegions(container, families)
    if (!observed.ok) {
      decline(observed.diagnostic.code, observed.diagnostic.message)
    }
    const compacted = remapWords(container, observed.result, families)
    let normalized = compacted.container
    if (families.anti) {
      const anti = diagnoseNormalizeAntiWordcode(source, normalized, {
        allowSpecializedTail: true,
        preExpandedPcMap: compacted.pcMap,
      })
      if (!anti.ok) decline(anti.diagnostic.code, anti.diagnostic.message)
      normalized = anti.result.container
    }
    const wordcode = diagnoseWordcode(normalized)
    if (!wordcode.ok) {
      decline(wordcode.diagnostic.code, wordcode.diagnostic.message)
    }
    const references = validateReferences(normalized, wordcode.result)
    const functions =
      references && partitionFunctions(normalized, wordcode.result, references)
    const cfg =
      functions && buildControlFlow(wordcode.result, references, functions)
    if (!cfg) {
      decline('self-modifying-control', 'Compact control flow did not validate')
    }
    return {
      ok: true,
      result: {
        schemaVersion: 'jsconfuser-vm-self-modifying-normalization.v1',
        container: normalized,
        wordcode: wordcode.result,
        references,
        functions,
        cfg,
        originalWordCount: container.roles.words.values.length,
        wordCount: normalized.roles.words.values.length,
        patchCount: observed.result.patches.length,
        familyCounts: Object.fromEntries(
          ['ALIAS', 'MACRO', 'SPECIALIZED', 'SYNTHETIC'].map((name) => [
            name,
            observed.result.reachableInstructions.filter(
              (instruction) => instruction.name === name,
            ).length,
          ]),
        ),
      },
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof NormalizationDecline
            ? error.code
            : 'normalizer-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
