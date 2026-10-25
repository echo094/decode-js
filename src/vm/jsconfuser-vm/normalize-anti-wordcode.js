import { diagnoseAntiRuntime } from './analyze-anti-runtime.js'
import { diagnoseAntiRegisterFlow } from './analyze-anti-register-flow.js'
import { selectContinuationLoads } from './finally-continuations.js'
import { diagnoseNormalizeConcealedConstants } from './normalize-concealed-constants.js'
import { diagnoseNormalizeDispatcherWordcode } from './normalize-dispatcher-wordcode.js'
import { diagnoseAntiWordStream, diagnoseWordcode } from './read-wordcode.js'
import { validateReferences } from './validate-references.js'
import { diagnoseFunctionPartition } from './partition-functions.js'
import { composePcMaps } from './expand-observed-word-stream.js'

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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

function requireObservation(diagnosis) {
  if (!diagnosis.ok) {
    decline(diagnosis.diagnostic.code, diagnosis.diagnostic.message)
  }
  return diagnosis.result
}

export function padAntiInstruction(instruction, realStep, opcodes) {
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

function compactWords(
  stream,
  flow,
  container,
  padded,
  source,
  decodedTargetOriginMap,
  suspects,
) {
  const decoys = new Set(flow.decoys)
  const initialWordcode = requireObservation(diagnoseWordcode(padded))
  const concealed = initialWordcode.instructions.some((instruction) =>
    instruction.operands.some(
      (operand) => operand.kind === 'constant-ref' && operand.concealKey !== 0,
    ),
  )
    ? requireObservation(
        diagnoseNormalizeConcealedConstants(source, padded, initialWordcode),
      )
    : { container: padded, wordcode: initialWordcode }
  const controlContainer = concealed.container
  const paddedWordcode = concealed.wordcode
  const references = validateReferences(controlContainer, paddedWordcode)
  const functions =
    references &&
    diagnoseFunctionPartition(controlContainer, paddedWordcode, references, {
      sharedParentSuspects: true,
    }).result
  if (!functions)
    decline('anti-control-proof', 'Padded stream has no function partition')
  const byPc = new Map(
    paddedWordcode.instructions.map((item) => [item.pc, item]),
  )
  const ownerByPc = new Map(
    functions.ownership.map(({ pc, functionId }) => [pc, functionId]),
  )
  const labelLoads = selectContinuationLoads(
    paddedWordcode.instructions
      .filter(({ pc }) => !suspects.has(pc))
      .map((instruction) => ({
        key: instruction.pc,
        functionId: ownerByPc.get(instruction.pc),
        name: instruction.name,
        words: instruction.words,
      })),
  )
  // A JUMP_REG is a finalizer resume when it reads its function's continuation register and a
  // label load of that function writes it; any other JUMP_REG is the dispatcher's.
  let requiresDispatcher = false
  for (const fn of functions.functions) {
    const instructions = fn.instructionPcs.map((pc) => byPc.get(pc))
    const continuations = new Set(
      instructions
        .filter(({ name }) => name === 'FINALLY_SETUP')
        .map(({ words }) => words[2]),
    )
    for (const jump of instructions.filter(({ name }) => name === 'JUMP_REG')) {
      if (
        !continuations.has(jump.words[1]) ||
        !instructions.some(
          (item) => labelLoads.has(item.pc) && item.words[1] === jump.words[1],
        )
      )
        requiresDispatcher = true
    }
  }
  const byOpcode = new Map(flow.realSteps.map((step) => [step.opcode, step]))
  const opcodes = container.roles.op.values
  const seedPcs = new Set()
  const indexByPc = new Map(
    stream.instructions.map((instruction, index) => [instruction.pc, index]),
  )
  // A deferred seed stays as code: erase only the seeds every model agrees on.
  const seedCounts = flow.seedCountChoices.map(
    ({ startPc, counts, deferredSeed }) => ({
      startPc,
      count: deferredSeed === null ? Math.max(...counts) : Math.min(...counts),
    }),
  )
  const seedFunctionStarts = new Set(seedCounts.map(({ startPc }) => startPc))
  if (seedCounts.every(({ count }) => Number.isInteger(count))) {
    for (const { startPc, count } of seedCounts) {
      const index = indexByPc.get(startPc)
      for (let offset = 0; offset < count; offset += 1) {
        const seed = stream.instructions[index + offset]
        if (seed?.name !== 'LOAD_CONST') {
          decline('anti-seed-proof', 'Fake seed prefix is not canonical')
        }
        seedPcs.add(seed.pc)
      }
    }
    for (const instruction of stream.instructions) {
      if (instruction.name === 'SYNTHETIC') continue
      for (const offset of DIRECT_TARGET_OFFSETS[instruction.name] ?? []) {
        const target = instruction.words[offset]
        if (seedPcs.has(target) && !seedFunctionStarts.has(target)) {
          decline('anti-seed-proof', 'Direct target enters a fake seed prefix')
        }
      }
    }
    for (const pc of labelLoads) {
      const target = byPc.get(pc).words[2]
      if (seedPcs.has(target) && !seedFunctionStarts.has(target)) {
        decline('anti-seed-proof', 'Continuation enters a fake seed prefix')
      }
    }
  }
  const pcMap = new Map()
  let nextPc = 0
  // A decoy suspect is removed with no map entry, so an address naming it declines.
  for (const instruction of stream.instructions) {
    if (decoys.has(instruction.pc)) continue
    pcMap.set(instruction.pc, nextPc)
    if (seedPcs.has(instruction.pc)) continue
    nextPc +=
      instruction.name === 'SYNTHETIC'
        ? 1 +
          instruction.steps[byOpcode.get(instruction.opcode.value).index].words
            .length
        : instruction.width
  }
  pcMap.set(stream.wordCount, nextPc)
  const remap = (target) => {
    if (!pcMap.has(target)) {
      decline(
        'anti-control-proof',
        `Target ${target} has no compact PC boundary`,
      )
    }
    return pcMap.get(target)
  }
  const words = stream.instructions.flatMap((instruction) => {
    if (seedPcs.has(instruction.pc) || decoys.has(instruction.pc)) return []
    if (instruction.name === 'SYNTHETIC') {
      const real = byOpcode.get(instruction.opcode.value)
      return [opcodes[real.name], ...instruction.steps[real.index].words]
    }
    const raw = instruction.words.slice()
    for (const offset of DIRECT_TARGET_OFFSETS[instruction.name] ?? []) {
      raw[offset] = remap(raw[offset])
    }
    if (labelLoads.has(instruction.pc)) raw[2] = remap(raw[2])
    return raw
  })
  const decodedTargetMap = new Map()
  const origins =
    decodedTargetOriginMap ?? new Map([...pcMap].map(([pc]) => [pc, pc]))
  for (const [origin, expanded] of origins) {
    if (decoys.has(expanded)) continue
    if (!pcMap.has(expanded)) {
      decline('anti-control-proof', 'Dispatcher target map lost a boundary')
    }
    if (seedPcs.has(expanded) && !seedFunctionStarts.has(expanded)) continue
    decodedTargetMap.set(origin, pcMap.get(expanded))
  }
  return { words, decodedTargetMap, requiresDispatcher }
}

// originPcMap (origin PC -> input PC) comes from the stages that moved code before this one
// (PATCH removal, macro or specialized expansion), composed by the caller; the fused operands
// stay in origin space, and this stage translates them itself.
function recognize(
  source,
  container,
  { allowSpecializedTail = false, originPcMap = null, suspects = [] } = {},
) {
  const runtime = requireObservation(
    diagnoseAntiRuntime(source, { allowSpecializedTail }),
  )
  const decodedTargetOriginMap = originPcMap
  // PATCH suspects arrive as origin PCs; read them in this input's space.
  const toInput = (pc) =>
    decodedTargetOriginMap ? decodedTargetOriginMap.get(pc) : pc
  const inputSuspects = new Set(suspects.map(toInput))
  const stream = requireObservation(diagnoseAntiWordStream(container, runtime))
  const flow = requireObservation(
    diagnoseAntiRegisterFlow(container, runtime, {
      originPcMap,
      suspects: inputSuspects,
    }),
  )
  const byOpcode = new Map(flow.realSteps.map((step) => [step.opcode, step]))
  const opcodes = container.roles.op.values
  const normalizedWords = stream.instructions.flatMap((instruction) =>
    instruction.name === 'SYNTHETIC'
      ? padAntiInstruction(
          instruction,
          byOpcode.get(instruction.opcode.value),
          opcodes,
        )
      : instruction.words,
  )
  const padded = structuredClone(container)
  padded.roles.words.values = normalizedWords
  let compact = structuredClone(container)
  const compaction = compactWords(
    stream,
    flow,
    container,
    padded,
    source,
    decodedTargetOriginMap,
    inputSuspects,
  )
  compact.roles.words.values = compaction.words
  let compactWordcode = requireObservation(diagnoseWordcode(compact))
  let records = {}
  if (compaction.requiresDispatcher) {
    if (
      compactWordcode.instructions.some((instruction) =>
        instruction.operands.some(
          (operand) =>
            operand.kind === 'constant-ref' && operand.concealKey !== 0,
        ),
      )
    ) {
      const concealed = requireObservation(
        diagnoseNormalizeConcealedConstants(source, compact, compactWordcode),
      )
      compact = concealed.container
      compactWordcode = concealed.wordcode
    }
    const references = validateReferences(compact, compactWordcode)
    if (!references)
      decline('anti-control-proof', 'Compact stream has no references')
    const options = {
      decodedTargetMap: compaction.decodedTargetMap,
      suspects: suspects.filter((pc) => !flow.decoys.includes(toInput(pc))),
    }
    const functions = requireObservation(
      diagnoseFunctionPartition(compact, compactWordcode, references, {
        sharedParentSuspects: true,
      }),
    )
    const dispatcher = requireObservation(
      diagnoseNormalizeDispatcherWordcode(
        compact,
        compactWordcode,
        functions,
        options,
      ),
    )
    records = dispatcher
    compact = records.container
    compactWordcode = records.wordcode
  }
  // Origin PCs (or the caller's origin space) -> output, through the inner dispatcher when
  // it ran.
  const { pcMap: dispatcherPcMap, ...inner } = records
  return deepFreeze({
    ...inner,
    schemaVersion: 'jsconfuser-vm-anti-wordcode-normalization.v1',
    container: compact,
    wordcode: compactWordcode,
    originPcMap: dispatcherPcMap
      ? composePcMaps(compaction.decodedTargetMap, dispatcherPcMap)
      : compaction.decodedTargetMap,
    // Undecided PATCH suspects (decoys settled here leave) and deferred seeds, as origin PCs.
    suspects: suspects.filter((pc) => !flow.decoys.includes(toInput(pc))),
    deferredSeeds: flow.seedCountChoices
      .map(({ deferredSeed }) => deferredSeed)
      .filter((pc) => pc !== null)
      .map((pc) =>
        decodedTargetOriginMap
          ? [...decodedTargetOriginMap].find(([, input]) => input === pc)[0]
          : pc,
      ),
    originalWordCount: stream.wordCount,
    syntheticInstructionCount: stream.instructions.filter(
      ({ name }) => name === 'SYNTHETIC',
    ).length,
  })
}

export function diagnoseNormalizeAntiWordcode(source, container, options) {
  try {
    return deepFreeze({
      ok: true,
      result: recognize(source, container, options),
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof NormalizationDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'anti-normalization-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
