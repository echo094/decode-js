import { diagnoseAntiRuntime } from './analyze-anti-runtime.js'
import { diagnoseSpecializedRuntime } from './observe-specialized-runtime.js'
import { diagnoseContainer } from './extract-container.js'
import { expandObservedWordStream } from './expand-observed-word-stream.js'
import { diagnoseAntiRegisterFlow } from './analyze-anti-register-flow.js'
import { diagnoseConcealedRuntime } from './observe-concealed-runtime.js'
import { diagnoseNormalizeConcealedConstants } from './normalize-concealed-constants.js'
import { diagnoseNormalizeDispatcherWordcode } from './normalize-dispatcher-wordcode.js'
import {
  diagnoseAntiWordStream,
  diagnoseSpecializedWordStream,
  diagnoseWordcode,
} from './read-wordcode.js'
import { validateReferences } from './validate-references.js'
import {
  diagnoseFunctionPartition,
  partitionFunctions,
} from './partition-functions.js'
import { buildControlFlow } from './build-cfg.js'

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

function canonicalWords(instruction, realStep, opcodes) {
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
) {
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
  let functions =
    references &&
    partitionFunctions(controlContainer, paddedWordcode, references)
  if (!functions && references) {
    const counts = new Map()
    for (const descriptor of references.frame.descriptors) {
      if (descriptor.paramCount !== 4 || descriptor.captureCount !== 0) continue
      counts.set(descriptor.startPc, (counts.get(descriptor.startPc) ?? 0) + 1)
    }
    const shared = [...counts]
      .filter(([, count]) => count > 1)
      .map(([pc]) => pc)
    if (shared.length === 1)
      functions = diagnoseFunctionPartition(
        controlContainer,
        paddedWordcode,
        references,
        { allowSharedParentStarts: new Set(shared) },
      ).result
  }
  const cfg =
    functions && buildControlFlow(paddedWordcode, references, functions)
  if (!functions)
    decline('anti-control-proof', 'Padded stream has no function partition')
  const byPc = new Map(
    paddedWordcode.instructions.map((item) => [item.pc, item]),
  )
  const labelLoads = new Set()
  for (const fn of functions.functions) {
    const instructions = fn.instructionPcs.map((pc) => byPc.get(pc))
    for (const setup of instructions.filter(
      ({ name }) => name === 'FINALLY_SETUP',
    )) {
      const continuation = setup.words[2]
      for (const instruction of instructions) {
        if (
          instruction.name !== 'LOAD_INT' ||
          instruction.words[1] !== continuation
        )
          continue
        if (
          byPc.has(instruction.words[2]) &&
          instruction.words[2] >= fn.startPc &&
          instruction.words[2] < fn.endPc
        )
          labelLoads.add(instruction.pc)
      }
    }
  }
  let requiresDispatcher = false
  if (cfg) {
    for (const jump of cfg.indirectTargets) {
      for (const origins of Object.values(jump.origins)) {
        for (const origin of origins) {
          if (origin.startsWith('exception@')) continue
          if (!labelLoads.has(Number(origin))) {
            requiresDispatcher = true
          }
        }
      }
    }
  } else {
    for (const fn of functions.functions) {
      const instructions = fn.instructionPcs.map((pc) => byPc.get(pc))
      const continuations = new Set(
        instructions
          .filter(({ name }) => name === 'FINALLY_SETUP')
          .map(({ words }) => words[2]),
      )
      for (const jump of instructions.filter(
        ({ name }) => name === 'JUMP_REG',
      )) {
        if (
          !continuations.has(jump.words[1]) ||
          !instructions.some(
            (item) =>
              labelLoads.has(item.pc) && item.words[1] === jump.words[1],
          )
        )
          requiresDispatcher = true
      }
    }
  }
  const byOpcode = new Map(flow.realSteps.map((step) => [step.opcode, step]))
  const opcodes = container.roles.op.values
  const seedPcs = new Set()
  const indexByPc = new Map(
    stream.instructions.map((instruction, index) => [instruction.pc, index]),
  )
  const seedCounts = flow.seedCountChoices.map(({ startPc, counts }) => ({
    startPc,
    count: Math.max(...counts),
  }))
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
  for (const instruction of stream.instructions) {
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
    if (seedPcs.has(instruction.pc)) return []
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
    if (!pcMap.has(expanded)) {
      decline('anti-control-proof', 'Dispatcher target map lost a boundary')
    }
    if (seedPcs.has(expanded) && !seedFunctionStarts.has(expanded)) continue
    decodedTargetMap.set(origin, pcMap.get(expanded))
  }
  return { words, decodedTargetMap, requiresDispatcher }
}

function recognize(
  source,
  container,
  { allowSpecializedTail = false, preExpandedPcMap = null } = {},
) {
  const runtime = requireObservation(
    diagnoseAntiRuntime(source, { allowSpecializedTail }),
  )
  let decodedTargetOriginMap = preExpandedPcMap
  if (allowSpecializedTail && !preExpandedPcMap) {
    const specialized = requireObservation(
      diagnoseSpecializedRuntime(source, { allowAntiPrefix: true }),
    )
    const original = requireObservation(diagnoseContainer(source))
    const specializedStream = requireObservation(
      diagnoseSpecializedWordStream(original, specialized, runtime),
    )
    const expansion = expandObservedWordStream(specializedStream, runtime, {
      includePcMap: true,
      ownerWideContinuations: true,
    })
    decodedTargetOriginMap = expansion.pcMap
  }
  const stream = requireObservation(diagnoseAntiWordStream(container, runtime))
  if (
    stream.instructions.some(
      (instruction) =>
        instruction.operands?.some(
          (operand) =>
            operand.kind === 'constant-ref' && operand.concealKey !== 0,
        ) ||
        instruction.steps?.some(
          (step) =>
            ['LOAD_CONST', 'LOAD_GLOBAL', 'TYPEOF_SAFE'].includes(step.name) &&
            step.words[2] !== 0,
        ),
    )
  ) {
    requireObservation(diagnoseConcealedRuntime(source, container))
  }
  const flow = requireObservation(diagnoseAntiRegisterFlow(container, runtime))
  const byOpcode = new Map(flow.realSteps.map((step) => [step.opcode, step]))
  const opcodes = container.roles.op.values
  const normalizedWords = stream.instructions.flatMap((instruction) =>
    instruction.name === 'SYNTHETIC'
      ? canonicalWords(
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
    const counts = new Map()
    for (const descriptor of references.frame.descriptors) {
      if (descriptor.paramCount !== 4 || descriptor.captureCount !== 0) continue
      counts.set(descriptor.startPc, (counts.get(descriptor.startPc) ?? 0) + 1)
    }
    const shared = [...counts]
      .filter(([, count]) => count > 1)
      .map(([pc]) => pc)
    if (shared.length > 1)
      decline('anti-control-proof', 'More than one shared string helper')
    const options = {
      allowSharedParentStarts: new Set(shared),
      deferControlFlow: true,
      decodedTargetMap: compaction.decodedTargetMap,
    }
    const functions = requireObservation(
      diagnoseFunctionPartition(compact, compactWordcode, references, options),
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
  return deepFreeze({
    ...records,
    schemaVersion: 'jsconfuser-vm-anti-wordcode-normalization.v1',
    container: compact,
    wordcode: compactWordcode,
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
