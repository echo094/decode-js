import { declines } from '../../decline.js'
import { selectContinuationLoads } from './finally-continuations.js'
import { LABEL_WORD_OFFSETS } from './wordcode-operands.js'

export const {
  decline: declineExpansion,
  unwrap: unwrapExpansion,
  accepted: acceptExpansion,
  refused: refuseExpansion,
} = declines('observed-expansion')

// Composes an origin map (origin PC -> input PC) with a stage's own map (input PC -> output PC).
export function composePcMaps(originPcMap, pcMap) {
  if (!originPcMap) return pcMap
  return new Map(
    [...originPcMap]
      .filter(([, input]) => pcMap.has(input))
      .map(([origin, input]) => [origin, pcMap.get(input)]),
  )
}

// Each instruction as its steps (a macro's or specialized instruction's own, any other itself) at
// new PCs, with each instruction's new PC (`pcMap`, the stream's end included).
function expandParts(stream) {
  const pcMap = new Map()
  const parts = []
  let nextPc = 0
  for (const instruction of stream.instructions) {
    pcMap.set(instruction.pc, nextPc)
    const encoded = ['MACRO', 'SPECIALIZED'].includes(instruction.name)
    for (const step of encoded ? instruction.steps : [instruction]) {
      parts.push({
        originPc: instruction.pc,
        pc: nextPc,
        name: step.name,
        words: step.words.slice(),
        encoded,
      })
      nextPc += step.words.length
    }
  }
  pcMap.set(stream.wordCount, nextPc)
  return { parts, pcMap, nextPc }
}

// Words inside an added opcode (macro and specialized steps) still hold origin addresses when an
// earlier stage has moved code; originPcMap maps them to input PCs. Anti's synthetic words are
// copied unchanged: anti reads its own fake operands through the map its caller composes.
// PATCH suspects arrive as origin PCs and are read past by the continuation rule.
export function expandObservedWordStream(
  stream,
  { includePcMap = false, originPcMap = null, suspects = [] } = {},
) {
  const fromOrigin = (target) => {
    if (!originPcMap) return target
    if (!originPcMap.has(target)) {
      declineExpansion(
        'origin-target-boundary',
        `Target ${target} has no origin instruction boundary`,
      )
    }
    return originPcMap.get(target)
  }
  const { parts, pcMap, nextPc } = expandParts(stream)
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
      declineExpansion(
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
      pc: part.originPc,
      key: part.pc,
      functionId: functionStarts.findLastIndex(
        (start) => start <= part.originPc,
      ),
      name: part.name,
      words: part.words,
    })),
    new Set(suspects.map((pc) => (originPcMap ? originPcMap.get(pc) : pc))),
  )
  const words = parts.flatMap((part) => {
    const raw = part.words.slice()
    for (const offset of LABEL_WORD_OFFSETS[part.name] ?? []) {
      raw[offset] = address(part, raw[offset])
    }
    if (continuationLoads.has(part.pc)) raw[2] = address(part, raw[2])
    return raw
  })
  if (words.length !== nextPc) {
    declineExpansion(
      'macro-expanded-width',
      'Expanded stream did not consume its PC map',
    )
  }
  return includePcMap ? { words, pcMap, parts } : words
}
