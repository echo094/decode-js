import { declines, deepFreeze } from '../../decline.js'
import { indexWordcode } from './wordcode-index.js'

const { decline, accepted, refused } = declines('partition')

const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'

function indexFrame(references) {
  const descriptors = [
    ...new Map(
      references.frame.descriptors.map((descriptor) => [
        descriptor.startPc,
        descriptor,
      ]),
    ).values(),
  ]
  return {
    frame: references.frame,
    descriptors,
    descriptorsByStart: new Map(
      descriptors.map((descriptor) => [descriptor.startPc, descriptor]),
    ),
    labelReferences: references.labels.references,
  }
}

function assignIntervals(wordcodeData, frameData) {
  const entries = [
    {
      startPc: frameData.frame.mainStartPc,
      kind: 'root',
      descriptor: null,
    },
    ...frameData.descriptors.map((descriptor) => ({
      startPc: descriptor.startPc,
      kind: 'closure',
      descriptor,
    })),
  ].sort((left, right) => left.startPc - right.startPc)

  if (entries[0].startPc !== frameData.frame.mainStartPc) {
    decline('invalid-function-boundary', 'Root function is not the first entry')
  }
  const seenStarts = new Set()
  const functions = []
  const ownerByPc = new Map()
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (seenStarts.has(entry.startPc)) {
      decline(
        'invalid-function-boundary',
        `Multiple function entries share pc ${entry.startPc}`,
      )
    }
    seenStarts.add(entry.startPc)
    const endPc = entries[index + 1]?.startPc ?? wordcodeData.words.length

    const intervalInstructions = wordcodeData.instructions.filter(
      ({ pc }) => pc >= entry.startPc && pc < endPc,
    )

    const functionRecord = {
      id: index,
      kind: entry.kind,
      startPc: entry.startPc,
      endPc,
      paramCount: entry.descriptor?.paramCount ?? 0,
      regCount: entry.descriptor?.regCount ?? frameData.frame.mainRegCount,
      captureCount: entry.descriptor?.captureCount ?? 0,
      hasRest: entry.descriptor?.hasRest ?? false,
      parentFunctionId: null,
      instructionPcs: intervalInstructions.map(({ pc }) => pc),
      instructionCount: intervalInstructions.length,
      descriptor: entry.descriptor
        ? {
            ...entry.descriptor,
            captures: entry.descriptor.captures.map((capture) => ({
              ...capture,
            })),
          }
        : null,
      closureSites: [],
    }
    for (const instruction of intervalInstructions) {
      ownerByPc.set(instruction.pc, index)
    }
    functions.push(functionRecord)
  }

  return { functions, ownerByPc, entries }
}

// A closure's parent: the one function that creates it, or the lowest of several when the closure
// is a suspect (recorded in `sharedParentStarts`).
function closureParent(functionRecord, parents, options, sharedParentStarts) {
  if (!parents || parents.size === 0) {
    decline(
      'invalid-function-boundary',
      `Function entry ${functionRecord.startPc} has no closure creation site`,
    )
  }
  if (parents.size > 1) {
    // A suspect (a closure some later decoder may remove, such as a shared string helper) is
    // published instead of declined: `true` admits every one, a Set only its own entries.
    const suspects = options?.sharedParentSuspects
    if (suspects !== true && !suspects?.has(functionRecord.startPc))
      decline(
        'invalid-function-boundary',
        `Function entry ${functionRecord.startPc} has ambiguous parents`,
      )
    sharedParentStarts.push(functionRecord.startPc)
  }
  return Math.min(...parents)
}

function attachClosures(wordcodeData, frameData, partition, options) {
  const functionByStart = new Map(
    partition.functions.map((functionRecord) => [
      functionRecord.startPc,
      functionRecord,
    ]),
  )
  const descriptorsWithSites = new Set()
  const parentSets = new Map()
  const sharedParentStarts = []
  for (const instruction of wordcodeData.instructions) {
    if (instruction.name !== 'MAKE_CLOSURE') continue
    const target = instruction.operands[1]?.pc
    const child = functionByStart.get(target)
    const parentId = partition.ownerByPc.get(instruction.pc)
    if (child.id === parentId)
      decline(
        'invalid-function-boundary',
        `MAKE_CLOSURE@${instruction.pc} does not enter a child function`,
      )

    const site = {
      creationPc: instruction.pc,
      parentFunctionId: parentId,
      childFunctionId: child.id,
      childStartPc: child.startPc,
      destinationRegister: instruction.operands[0]?.index,
    }
    partition.functions[parentId].closureSites.push(site)
    const parents = parentSets.get(child.id) ?? new Set()
    parents.add(parentId)
    parentSets.set(child.id, parents)
    descriptorsWithSites.add(child.id)
  }
  for (const functionRecord of partition.functions)
    if (functionRecord.kind === 'closure')
      functionRecord.parentFunctionId = closureParent(
        functionRecord,
        parentSets.get(functionRecord.id),
        options,
        sharedParentStarts,
      )
  partition.sharedParentStarts = sharedParentStarts
  return { functionByStart, descriptorsWithSites }
}

function validateDirectTargets(wordcodeData, labelReferences, partition) {
  const normalized = []
  for (const reference of labelReferences) {
    const sourceFunctionId = partition.ownerByPc.get(reference.pc)
    const targetFunctionId = partition.ownerByPc.get(reference.target)
    if (
      reference.role === 'functionEntry' &&
      (reference.instruction !== 'MAKE_CLOSURE' ||
        targetFunctionId === sourceFunctionId)
    ) {
      decline(
        'invalid-function-boundary',
        `MAKE_CLOSURE@${reference.pc} does not enter another function`,
      )
    }
    if (
      reference.role !== 'functionEntry' &&
      targetFunctionId !== sourceFunctionId
    ) {
      decline(
        'cross-function-target',
        `${reference.instruction}@${reference.pc} targets function ${targetFunctionId} from ${sourceFunctionId}`,
      )
    }
    normalized.push({
      pc: reference.pc,
      instruction: reference.instruction,
      operand: reference.operand,
      role: reference.role,
      target: reference.target,
      sourceFunctionId,
      targetFunctionId,
    })
  }
  return normalized
}

function makeResult(wordcodeData, frameData, partition, labels) {
  return deepFreeze({
    schemaVersion: FUNCTION_SCHEMA,
    encoding: 'numeric-u32',
    wordCount: wordcodeData.words.length,
    instructionCount: wordcodeData.instructions.length,
    entryPcs: partition.functions.map(({ startPc }) => startPc),
    sharedParentStarts: [...partition.sharedParentStarts],
    functions: partition.functions.map((functionRecord) => ({
      ...functionRecord,
      instructionPcs: [...functionRecord.instructionPcs],
      descriptor: functionRecord.descriptor
        ? {
            ...functionRecord.descriptor,
            captures: functionRecord.descriptor.captures.map((capture) => ({
              ...capture,
            })),
          }
        : null,
      closureSites: functionRecord.closureSites.map((site) => ({ ...site })),
    })),
    ownership: wordcodeData.instructions.map((instruction) => ({
      pc: instruction.pc,
      functionId: partition.ownerByPc.get(instruction.pc),
    })),
    labels,
    frame: {
      frameStart: frameData.frame.frameStart,
      headerSize: frameData.frame.headerSize,
      slots: { ...frameData.frame.slots },
      root: {
        functionId: partition.functions[0].id,
        startPc: frameData.frame.mainStartPc,
        regCount: frameData.frame.mainRegCount,
      },
    },
  })
}

function recognize(container, wordcode, references, options) {
  const wordcodeData = indexWordcode(wordcode)
  const frameData = indexFrame(references)
  const partition = assignIntervals(wordcodeData, frameData)
  attachClosures(wordcodeData, frameData, partition, options)
  const labels = validateDirectTargets(
    wordcodeData,
    frameData.labelReferences,
    partition,
  )
  return makeResult(wordcodeData, frameData, partition, labels)
}

// The index of the function whose code holds `pc`, or -1.
export function functionIndexAt(functions, pc) {
  return functions.functions.findIndex(
    (fn) => pc >= fn.startPc && pc < fn.endPc,
  )
}

export function diagnoseFunctionPartition(
  container,
  wordcode,
  references,
  options,
) {
  try {
    return accepted(recognize(container, wordcode, references, options), {
      fallback: 'function-partition-error',
      freeze: true,
    })
  } catch (error) {
    return refused(error, {
      fallback: 'function-partition-error',
      freeze: true,
    })
  }
}

export function partitionFunctions(container, wordcode, references) {
  return diagnoseFunctionPartition(container, wordcode, references).result
}
