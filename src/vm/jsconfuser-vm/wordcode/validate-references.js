import { declines, deepFreeze } from '../../decline.js'
import { indexWordcode } from './wordcode-index.js'

const { decline, accepted, refused } = declines('references')

const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'

const CANONICAL_SLOTS = Object.freeze({
  PC: 0,
  CALLER: 1,
  RET_DST: 2,
  THIS: 3,
  CLOSURE: 4,
  HANDLERS: 5,
  FRAME_SIZE: 6,
  REG_BASE: 7,
})

function containerData(container) {
  return {
    pool: container.roles.pool.values,
    words: container.roles.words.values,
    scalars: Object.fromEntries(
      Object.entries(container.roles.scalars).map(([name, role]) => [
        name,
        role.value,
      ]),
    ),
  }
}

function validateFrameSlots(input, wordcodeData) {
  const { MAIN_START_PC: mainStartPc, MAIN_REG_COUNT: mainRegCount } =
    input.scalars
  const headerSize = input.scalars.HEADER_SIZE
  const frameStart = input.scalars.FRAME_START
  const slots = CANONICAL_SLOTS
  const boundarySet = new Set(wordcodeData.boundaries)
  const rootFrameSize = headerSize + mainRegCount
  const rootRegisterBase = frameStart + headerSize
  const rootFrameEnd = frameStart + rootFrameSize
  return {
    boundarySet,
    frame: {
      frameStart,
      headerSize,
      slots: { ...slots },
      mainStartPc,
      mainRegCount,
      root: {
        frameBase: frameStart,
        frameSize: rootFrameSize,
        registerBase: rootRegisterBase,
        registerWindow: { start: rootRegisterBase, end: rootFrameEnd },
        frameEnd: rootFrameEnd,
      },
    },
  }
}

function descriptorRecord(instruction) {
  const metadata = instruction.functionMeta
  const captures = instruction.captures
  return {
    creationPc: instruction.pc,
    startPc: metadata.startPc,
    paramCount: metadata.paramCount,
    regCount: metadata.regCount,
    captureCount: metadata.captureCount,
    hasRest: metadata.hasRest,
    captures: captures.map(({ kind, index, isLocal }) => ({
      kind,
      index,
      isLocal,
    })),
  }
}

function validateDescriptors(wordcodeData, frameData) {
  const closureInstructions = wordcodeData.instructions.filter(
    ({ name }) => name === 'MAKE_CLOSURE',
  )
  const descriptors = []
  let maxRegisterCount = frameData.frame.mainRegCount
  let maxCaptureCount = 0
  for (const instruction of closureInstructions) {
    const metadata = instruction.functionMeta
    if (!frameData.boundarySet.has(metadata.startPc)) {
      decline(
        'invalid-label-reference',
        `MAKE_CLOSURE@${instruction.pc} has an invalid entry PC`,
      )
    }
    const captures = instruction.captures.map(({ kind, index, isLocal }) => ({
      kind,
      index,
      isLocal,
    }))
    const record = {
      ...descriptorRecord({ ...instruction, functionMeta: metadata, captures }),
      captures,
      frameSize: frameData.frame.headerSize + metadata.regCount,
      registerBaseOffset: frameData.frame.headerSize,
    }
    descriptors.push(record)
    maxRegisterCount = Math.max(maxRegisterCount, metadata.regCount)
    maxCaptureCount = Math.max(maxCaptureCount, metadata.captureCount)
  }
  for (const descriptor of descriptors) {
    for (const capture of descriptor.captures) {
      if (capture.kind === 'local' && capture.index >= maxRegisterCount) {
        decline(
          'invalid-register-reference',
          `MAKE_CLOSURE@${descriptor.creationPc} captures r${capture.index} outside the known frame bounds`,
        )
      }
      if (capture.kind === 'upvalue' && capture.index >= maxCaptureCount) {
        decline(
          'invalid-descriptor',
          `MAKE_CLOSURE@${descriptor.creationPc} captures upvalue ${capture.index} outside the known descriptor bounds`,
        )
      }
    }
  }
  return { descriptors, maxRegisterCount, maxCaptureCount }
}

function labelRole(name, index) {
  if (name === 'JUMP') return 'target'
  if (name === 'JUMP_IF_FALSE' || name === 'JUMP_IF_TRUE') return 'target'
  if (name === 'FOR_IN_NEXT') return 'exit'
  if (name === 'TRY_SETUP') return 'handler'
  if (name === 'FINALLY_SETUP') return index === 0 ? 'finally' : 'throwPad'
  if (name === 'MAKE_CLOSURE') return 'functionEntry'
  return 'label'
}

// The direct label operands of each operation, by operand index.
const DIRECT_LABEL_INDEXES = {
  JUMP: [0],
  JUMP_IF_FALSE: [1],
  JUMP_IF_TRUE: [1],
  FOR_IN_NEXT: [2],
  TRY_SETUP: [0],
  FINALLY_SETUP: [0, 3],
  MAKE_CLOSURE: [1],
}

// A constant operand's reference: an unconcealed pair inside the pool, a string for a global name.
function constantReference(instruction, operand, operandIndex, pool) {
  if (operand.index >= pool.length || operand.concealKey !== 0) {
    decline(
      'invalid-constant-reference',
      `${instruction.name}@${instruction.pc} has an invalid constant pair`,
    )
  }
  if (
    (instruction.name === 'LOAD_GLOBAL' ||
      instruction.name === 'STORE_GLOBAL' ||
      instruction.name === 'TYPEOF_SAFE') &&
    typeof pool[operand.index] !== 'string'
  ) {
    decline(
      'invalid-constant-reference',
      `${instruction.name}@${instruction.pc} requires a string constant name`,
    )
  }
  return {
    pc: instruction.pc,
    instruction: instruction.name,
    operand: operandIndex,
    index: operand.index,
    concealKey: operand.concealKey,
  }
}

// An instruction's direct label references, each to an instruction boundary.
function labelReferencesOf(instruction, frameData) {
  return (DIRECT_LABEL_INDEXES[instruction.name] ?? []).map((operandIndex) => {
    const target = instruction.operands[operandIndex].pc
    if (!frameData.boundarySet.has(target)) {
      decline(
        'invalid-label-reference',
        `${instruction.name}@${instruction.pc} targets non-boundary pc ${target}`,
      )
    }
    return {
      pc: instruction.pc,
      instruction: instruction.name,
      operand: operandIndex,
      role: labelRole(instruction.name, operandIndex),
      target,
    }
  })
}

function collectReferences(
  containerData,
  wordcodeData,
  frameData,
  descriptors,
) {
  const constantReferences = []
  const registerReferences = []
  const labelReferences = []
  const captureLimit = descriptors.maxCaptureCount
  const { pool } = containerData
  for (const instruction of wordcodeData.instructions) {
    instruction.operands.forEach((operand, operandIndex) => {
      if (operand.kind === 'register') {
        // Bounded by the owning descriptor in E, on reachable code only: C has no owners and no
        // reachability, and it reads streams that still hold selfModifying's suspects (registers
        // 0..24, whatever the frame).
        registerReferences.push({
          pc: instruction.pc,
          instruction: instruction.name,
          operand: operandIndex,
          index: operand.index,
        })
      } else if (operand.kind === 'constant-ref') {
        constantReferences.push(
          constantReference(instruction, operand, operandIndex, pool),
        )
      } else if (
        operand.kind === 'upvalue-index' &&
        operand.index >= captureLimit
      ) {
        decline(
          'invalid-descriptor',
          `${instruction.name}@${instruction.pc} references an unknown upvalue bound`,
        )
      }
      // Capture pairs (`local`, `upvalue`) are checked from functionMeta below; their owner
      // function is deliberately left to partitionFunctions.
    })
    labelReferences.push(...labelReferencesOf(instruction, frameData))
  }
  return { constantReferences, registerReferences, labelReferences }
}

function makeResult(
  containerData,
  wordcodeData,
  frameData,
  descriptorData,
  refs,
) {
  const frame = {
    ...frameData.frame,
    descriptors: descriptorData.descriptors,
  }
  return deepFreeze({
    schemaVersion: REFERENCE_SCHEMA,
    encoding: 'numeric-u32',
    wordCount: wordcodeData.words.length,
    instructionCount: wordcodeData.instructions.length,
    constants: {
      poolSize: containerData.pool.length,
      values: containerData.pool.slice(),
      references: refs.constantReferences,
    },
    registers: {
      rootCount: frameData.frame.mainRegCount,
      maxCount: descriptorData.maxRegisterCount,
      maxCaptureCount: descriptorData.maxCaptureCount,
      references: refs.registerReferences,
    },
    labels: {
      boundaries:
        frameData.frame.mainStartPc === 0
          ? [...frameData.boundarySet].sort((left, right) => left - right)
          : [...frameData.boundarySet],
      references: refs.labelReferences,
    },
    frame,
  })
}

function recognize(container, wordcode) {
  const input = containerData(container)
  const wordcodeData = indexWordcode(wordcode)
  const frameData = validateFrameSlots(input, wordcodeData)
  const descriptorData = validateDescriptors(wordcodeData, frameData)
  const refs = collectReferences(input, wordcodeData, frameData, descriptorData)
  return makeResult(input, wordcodeData, frameData, descriptorData, refs)
}

export function diagnoseReferences(container, wordcode) {
  try {
    return accepted(recognize(container, wordcode), {
      fallback: 'reference-validator-error',
      freeze: true,
    })
  } catch (error) {
    return refused(error, {
      fallback: 'reference-validator-error',
      freeze: true,
    })
  }
}

export function validateReferences(container, wordcode) {
  return diagnoseReferences(container, wordcode).result
}
