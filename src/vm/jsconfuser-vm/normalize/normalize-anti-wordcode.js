import { declines, deepFreeze } from '../../decline.js'
import { diagnoseAntiRuntime } from '../observe/observe-anti-runtime.js'
import { diagnoseAntiRegisterFlow } from './analyze-anti-register-flow.js'
import { selectContinuationLoads } from '../wordcode/finally-continuations.js'
import {
  diagnoseNormalizeConcealedConstants,
  hasConcealedConstant,
} from './normalize-concealed-constants.js'
import { diagnoseNormalizeDispatcherWordcode } from './normalize-dispatcher-wordcode.js'
import {
  diagnoseAntiWordStream,
  diagnoseWordcode,
} from '../wordcode/read-wordcode.js'
import { validateReferences } from '../wordcode/validate-references.js'
import { diagnoseFunctionPartition } from '../wordcode/partition-functions.js'
import { composePcMaps } from '../wordcode/expand-observed-word-stream.js'
import { LABEL_WORD_OFFSETS } from '../wordcode/wordcode-operands.js'

const { decline, unwrap, accepted, refused } = declines('anti-normalization')

function padAntiInstruction(instruction, realStep, opcodes) {
  const step = instruction.steps[realStep.index]
  const opcode = opcodes[step.name]
  const words = [opcode, ...step.words]
  let remaining = instruction.width - words.length
  if (remaining < 4) {
    decline('anti-padding', 'Synthetic instruction has insufficient fake width')
  }
  const fakeRegister = instruction.steps.find(
    (_, index) => index !== realStep.index,
  )?.words[0]
  if (remaining % 2 === 1) {
    words.push(opcodes.MOVE, fakeRegister, fakeRegister)
    remaining -= 3
  }
  while (remaining > 0) {
    words.push(opcodes.LOAD_THIS, fakeRegister)
    remaining -= 2
  }
  return words
}

const realStepsByOpcode = (flow) =>
  new Map(flow.realSteps.map((step) => [step.opcode, step]))

// The width-preserving analysis stream: each fused header holds its real step, padded with
// harmless writes to an isolated fake register. Never output or executed.
function padStream(container, stream, flow) {
  const steps = realStepsByOpcode(flow)
  const opcodes = container.roles.op.values
  const words = stream.instructions.flatMap((instruction) =>
    instruction.name === 'SYNTHETIC'
      ? padAntiInstruction(
          instruction,
          steps.get(instruction.opcode.value),
          opcodes,
        )
      : instruction.words,
  )
  const padded = structuredClone(container)
  padded.roles.words.values = words
  return padded
}

// The container and wordcode with keyed constants restored, when any constant is keyed.
function canonicalConstants(source, container, wordcode) {
  return hasConcealedConstant(wordcode)
    ? unwrap(diagnoseNormalizeConcealedConstants(source, container, wordcode))
    : { container, wordcode }
}

// References, functions and the retained finalizer continuation loads of the padded stream.
function analyzePadded(source, padded, suspects) {
  const { container, wordcode } = canonicalConstants(
    source,
    padded,
    unwrap(diagnoseWordcode(padded)),
  )
  const references = validateReferences(container, wordcode)
  const functions =
    references &&
    diagnoseFunctionPartition(container, wordcode, references, {
      sharedParentSuspects: true,
    }).result
  if (!functions)
    decline('anti-control-proof', 'Padded stream has no function partition')
  const byPc = new Map(wordcode.instructions.map((item) => [item.pc, item]))
  const ownerByPc = new Map(
    functions.ownership.map(({ pc, functionId }) => [pc, functionId]),
  )
  const labelLoads = selectContinuationLoads(
    wordcode.instructions
      .filter(({ pc }) => !suspects.has(pc))
      .map((instruction) => ({
        key: instruction.pc,
        functionId: ownerByPc.get(instruction.pc),
        name: instruction.name,
        words: instruction.words,
      })),
  )
  return { byPc, functions, labelLoads }
}

// A JUMP_REG is a finalizer resume when it reads its function's continuation register and a
// label load of that function writes it; any other JUMP_REG is the dispatcher's.
function needsDispatcher({ byPc, functions, labelLoads }) {
  return functions.functions.some((fn) => {
    const instructions = fn.instructionPcs.map((pc) => byPc.get(pc))
    const continuations = new Set(
      instructions
        .filter(({ name }) => name === 'FINALLY_SETUP')
        .map(({ words }) => words[2]),
    )
    return instructions
      .filter(({ name }) => name === 'JUMP_REG')
      .some(
        (jump) =>
          !continuations.has(jump.words[1]) ||
          !instructions.some(
            (item) =>
              labelLoads.has(item.pc) && item.words[1] === jump.words[1],
          ),
      )
  })
}

// A seed other than its function's start is inside a removable prefix.
const entersPrefix = (seeds, pc) => seeds.pcs.has(pc) && !seeds.starts.has(pc)

// The fake entry seeds to remove. A deferred seed stays as code: erase only the seeds every model
// agrees on.
function fakeSeeds(stream, flow, { byPc, labelLoads }) {
  const counts = flow.seedCountChoices.map(
    ({ startPc, counts, deferredSeed }) => ({
      startPc,
      count: deferredSeed === null ? Math.max(...counts) : Math.min(...counts),
    }),
  )
  const seeds = {
    pcs: new Set(),
    starts: new Set(counts.map(({ startPc }) => startPc)),
  }
  if (!counts.every(({ count }) => Number.isInteger(count))) return seeds
  const indexByPc = new Map(
    stream.instructions.map((instruction, index) => [instruction.pc, index]),
  )
  for (const { startPc, count } of counts) {
    const index = indexByPc.get(startPc)
    for (let offset = 0; offset < count; offset += 1) {
      const seed = stream.instructions[index + offset]
      if (seed?.name !== 'LOAD_CONST')
        decline('anti-seed-proof', 'Fake seed prefix is not canonical')
      seeds.pcs.add(seed.pc)
    }
  }
  checkSeedEntries(stream, seeds, byPc, labelLoads)
  return seeds
}

// No direct target and no continuation enters the middle of a seed prefix.
function checkSeedEntries(stream, seeds, byPc, labelLoads) {
  for (const instruction of stream.instructions) {
    if (instruction.name === 'SYNTHETIC') continue
    if (
      (LABEL_WORD_OFFSETS[instruction.name] ?? []).some((offset) =>
        entersPrefix(seeds, instruction.words[offset]),
      )
    )
      decline('anti-seed-proof', 'Direct target enters a fake seed prefix')
  }
  for (const pc of labelLoads)
    if (entersPrefix(seeds, byPc.get(pc).words[2]))
      decline('anti-seed-proof', 'Continuation enters a fake seed prefix')
}

// A fused instruction's real step: its opcode and that step's words.
function realStepWords(instruction, steps, opcodes) {
  const real = steps.get(instruction.opcode.value)
  return [opcodes[real.name], ...instruction.steps[real.index].words]
}

// The compact stream: seeds and decoys removed, each fused instruction its real step, direct
// control and selected continuation addresses remapped. A decoy suspect is removed with no map
// entry, so an address naming it declines.
function compactStream(stream, flow, opcodes, seeds, labelLoads) {
  const steps = realStepsByOpcode(flow)
  const decoys = new Set(flow.decoys)
  const pcMap = new Map()
  let nextPc = 0
  for (const instruction of stream.instructions) {
    if (decoys.has(instruction.pc)) continue
    pcMap.set(instruction.pc, nextPc)
    if (seeds.pcs.has(instruction.pc)) continue
    nextPc +=
      instruction.name === 'SYNTHETIC'
        ? realStepWords(instruction, steps, opcodes).length
        : instruction.width
  }
  pcMap.set(stream.wordCount, nextPc)
  const remap = (target) => {
    if (!pcMap.has(target))
      decline(
        'anti-control-proof',
        `Target ${target} has no compact PC boundary`,
      )
    return pcMap.get(target)
  }
  const words = stream.instructions
    .filter(({ pc }) => !seeds.pcs.has(pc) && !decoys.has(pc))
    .flatMap((instruction) =>
      instruction.name === 'SYNTHETIC'
        ? realStepWords(instruction, steps, opcodes)
        : relabel(instruction, remap, labelLoads),
    )
  return { words, pcMap }
}

function relabel(instruction, remap, labelLoads) {
  const raw = instruction.words.slice()
  for (const offset of LABEL_WORD_OFFSETS[instruction.name] ?? [])
    raw[offset] = remap(raw[offset])
  if (labelLoads.has(instruction.pc)) raw[2] = remap(raw[2])
  return raw
}

// Dispatcher endpoints decode to origin PCs: the compact PC of each, through the earlier map.
function translateTargets(pcMap, originPcMap, flow, seeds) {
  const decoys = new Set(flow.decoys)
  const decodedTargetMap = new Map()
  const origins = originPcMap ?? new Map([...pcMap].map(([pc]) => [pc, pc]))
  for (const [origin, expanded] of origins) {
    if (decoys.has(expanded)) continue
    if (!pcMap.has(expanded))
      decline('anti-control-proof', 'Dispatcher target map lost a boundary')
    if (entersPrefix(seeds, expanded)) continue
    decodedTargetMap.set(origin, pcMap.get(expanded))
  }
  return decodedTargetMap
}

// The dispatcher inverse over the compact stream, with keyed constants restored first.
function recoverDispatcher(
  source,
  compact,
  wordcode,
  decodedTargetMap,
  suspects,
) {
  const canonical = canonicalConstants(source, compact, wordcode)
  const references = validateReferences(canonical.container, canonical.wordcode)
  if (!references)
    decline('anti-control-proof', 'Compact stream has no references')
  const functions = unwrap(
    diagnoseFunctionPartition(
      canonical.container,
      canonical.wordcode,
      references,
      { sharedParentSuspects: true },
    ),
  )
  return unwrap(
    diagnoseNormalizeDispatcherWordcode(
      canonical.container,
      canonical.wordcode,
      functions,
      { decodedTargetMap, suspects },
    ),
  )
}

// Deferred seeds, as origin PCs.
function deferredSeedOrigins(flow, originPcMap) {
  return flow.seedCountChoices
    .map(({ deferredSeed }) => deferredSeed)
    .filter((pc) => pc !== null)
    .map((pc) =>
      originPcMap ? [...originPcMap].find(([, input]) => input === pc)[0] : pc,
    )
}

// originPcMap (origin PC -> input PC) comes from the stages that moved code before this one
// (PATCH removal, macro or specialized expansion), composed by the caller; the fused operands
// stay in origin space, and this stage translates them itself.
function recognize(
  source,
  container,
  { allowSpecializedTail = false, originPcMap = null, suspects = [] } = {},
) {
  const runtime = unwrap(diagnoseAntiRuntime(source, { allowSpecializedTail }))
  // PATCH suspects arrive as origin PCs; read them in this input's space.
  const toInput = (pc) => (originPcMap ? originPcMap.get(pc) : pc)
  const inputSuspects = new Set(suspects.map(toInput))
  const stream = unwrap(diagnoseAntiWordStream(container, runtime))
  const flow = unwrap(
    diagnoseAntiRegisterFlow(container, runtime, {
      originPcMap,
      suspects: inputSuspects,
    }),
  )
  const analysis = analyzePadded(
    source,
    padStream(container, stream, flow),
    inputSuspects,
  )
  const seeds = fakeSeeds(stream, flow, analysis)
  const { words, pcMap } = compactStream(
    stream,
    flow,
    container.roles.op.values,
    seeds,
    analysis.labelLoads,
  )
  const decodedTargetMap = translateTargets(pcMap, originPcMap, flow, seeds)
  const compact = structuredClone(container)
  compact.roles.words.values = words
  const wordcode = unwrap(diagnoseWordcode(compact))
  // Undecided PATCH suspects (decoys settled here leave), as origin PCs.
  const remaining = suspects.filter((pc) => !flow.decoys.includes(toInput(pc)))
  const dispatcher = needsDispatcher(analysis)
    ? recoverDispatcher(source, compact, wordcode, decodedTargetMap, remaining)
    : null
  // Origin PCs (or the caller's origin space) -> output, through the inner dispatcher when
  // it ran.
  const { pcMap: dispatcherPcMap, ...inner } = dispatcher ?? {}
  return deepFreeze({
    ...inner,
    schemaVersion: 'jsconfuser-vm-anti-wordcode-normalization.v1',
    container: dispatcher?.container ?? compact,
    wordcode: dispatcher?.wordcode ?? wordcode,
    originPcMap: dispatcherPcMap
      ? composePcMaps(decodedTargetMap, dispatcherPcMap)
      : decodedTargetMap,
    suspects: remaining,
    deferredSeeds: deferredSeedOrigins(flow, originPcMap),
    originalWordCount: stream.wordCount,
    syntheticInstructionCount: stream.instructions.filter(
      ({ name }) => name === 'SYNTHETIC',
    ).length,
  })
}

export function diagnoseNormalizeAntiWordcode(source, container, options) {
  try {
    return accepted(recognize(source, container, options), {
      fallback: 'anti-normalization-error',
      freeze: true,
    })
  } catch (error) {
    return refused(error, {
      fallback: 'anti-normalization-error',
      freeze: true,
    })
  }
}
