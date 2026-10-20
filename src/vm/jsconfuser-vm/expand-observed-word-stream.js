import { selectContinuationLoads } from './finally-continuations.js'

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

// Composes an origin map (Packet A PC -> input PC) with a stage's own map (input PC -> output PC).
export function composePcMaps(originPcMap, pcMap) {
  if (!originPcMap) return pcMap
  return new Map(
    [...originPcMap]
      .filter(([, input]) => pcMap.has(input))
      .map(([origin, input]) => [origin, pcMap.get(input)]),
  )
}

// Words inside an added opcode (macro and specialized steps) still hold Packet A addresses when
// an earlier stage has moved code; originPcMap maps them to input PCs. Anti's synthetic words are
// copied unchanged: anti reads its own fake operands through the map its caller composes.
export function expandObservedWordStream(
  stream,
  { includePcMap = false, originPcMap = null } = {},
) {
  const fromOrigin = (target) => {
    if (!originPcMap) return target
    if (!originPcMap.has(target)) {
      throw new ObservedExpansionDecline(
        'origin-target-boundary',
        `Target ${target} has no origin instruction boundary`,
      )
    }
    return originPcMap.get(target)
  }
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
        encoded: ['MACRO', 'SPECIALIZED'].includes(instruction.name),
      })
      nextPc += step.words.length
    }
  }
  pcMap.set(stream.wordCount, nextPc)
  const functionStarts = [
    ...new Set([
      0,
      ...parts
        .filter(({ name }) => name === 'MAKE_CLOSURE')
        .map((part) =>
          part.encoded ? fromOrigin(part.words[2]) : part.words[2],
        ),
    ]),
  ].sort((left, right) => left - right)
  const remap = (target) => {
    if (!pcMap.has(target)) {
      throw new ObservedExpansionDecline(
        'macro-target-boundary',
        `Target ${target} has no original instruction boundary`,
      )
    }
    return pcMap.get(target)
  }
  const address = (part, target) =>
    remap(part.encoded ? fromOrigin(target) : target)
  const continuationLoads = selectContinuationLoads(
    parts.map((part) => ({
      key: part.pc,
      functionId: functionStarts.findLastIndex(
        (start) => start <= part.originPc,
      ),
      name: part.name,
      words: part.words,
    })),
  )
  const words = parts.flatMap((part) => {
    const raw = part.words.slice()
    for (const offset of DIRECT_TARGET_OFFSETS[part.name] ?? []) {
      raw[offset] = address(part, raw[offset])
    }
    if (continuationLoads.has(part.pc)) raw[2] = address(part, raw[2])
    return raw
  })
  if (words.length !== nextPc) {
    throw new ObservedExpansionDecline(
      'macro-expanded-width',
      'Expanded stream did not consume its PC map',
    )
  }
  return includePcMap ? { words, pcMap, parts } : words
}
