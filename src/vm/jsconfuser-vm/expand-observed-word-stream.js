const DIRECT_TARGET_OFFSETS = Object.freeze({
  JUMP: [1],
  JUMP_IF_FALSE: [2],
  JUMP_IF_TRUE: [2],
  FOR_IN_NEXT: [3],
  TRY_SETUP: [1],
  FINALLY_SETUP: [1, 4],
  MAKE_CLOSURE: [2],
})

export class ObservedExpansionDecline extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export function expandObservedWordStream(
  stream,
  antiObservation,
  { includePcMap = false, ownerWideContinuations = false } = {},
) {
  const pcMap = new Map()
  const parts = []
  let nextPc = 0
  for (const instruction of stream.instructions) {
    pcMap.set(instruction.pc, nextPc)
    const steps =
      instruction.name === 'MACRO' || instruction.name === 'SPECIALIZED'
        ? instruction.steps
        : [instruction]
    for (const step of steps) {
      parts.push({
        originPc: instruction.pc,
        pc: nextPc,
        name: step.name,
        words: step.words.slice(),
        original: instruction,
      })
      nextPc += step.words.length
    }
  }
  pcMap.set(stream.wordCount, nextPc)
  const functionStarts = ownerWideContinuations
    ? [
        ...new Set([
          0,
          ...parts
            .filter(({ name }) => name === 'MAKE_CLOSURE')
            .map(({ words }) => words[2]),
        ]),
      ].sort((left, right) => left - right)
    : []
  const remap = (target) => {
    if (!pcMap.has(target)) {
      throw new ObservedExpansionDecline(
        'macro-target-boundary',
        `Target ${target} has no original instruction boundary`,
      )
    }
    return pcMap.get(target)
  }
  const continuationLoads = new Set()
  for (const setup of parts.filter(({ name }) => name === 'FINALLY_SETUP')) {
    const continuation = setup.words[2]
    const throwPad = setup.words[4]
    const ownerIndex = functionStarts.findLastIndex(
      (start) => start <= setup.originPc,
    )
    const ownerStart = functionStarts[ownerIndex]
    const ownerEnd = functionStarts[ownerIndex + 1] ?? stream.wordCount
    for (const part of parts) {
      if (
        part.name === 'LOAD_INT' &&
        (ownerWideContinuations
          ? part.originPc >= ownerStart &&
            part.originPc < ownerEnd &&
            part.words[2] >= ownerStart &&
            part.words[2] < ownerEnd
          : part.originPc > setup.originPc && part.originPc < throwPad) &&
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
    if (part.name === 'SYNTHETIC') {
      const definition = antiObservation?.syntheticCases.find(
        ({ opcode }) => opcode === part.original.opcode.value,
      )
      if (!definition) {
        throw new ObservedExpansionDecline(
          'macro-synthetic-proof',
          'Synthetic instruction has no proved handler',
        )
      }
      for (const step of definition.steps) {
        if (step.name !== 'JUMP_IF_FALSE' && step.name !== 'JUMP_IF_TRUE')
          continue
        const stored = definition.canonicalToStored[step.operandStart + 1]
        raw[stored + 1] = remap(raw[stored + 1])
      }
    }
    if (continuationLoads.has(part.pc)) raw[2] = remap(raw[2])
    return raw
  })
  if (words.length !== nextPc) {
    throw new ObservedExpansionDecline(
      'macro-expanded-width',
      'Expanded stream did not consume its PC map',
    )
  }
  return includePcMap ? { words, pcMap } : words
}
