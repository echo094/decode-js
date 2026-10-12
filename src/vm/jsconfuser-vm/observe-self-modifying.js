import {
  diagnoseWordcode,
  diagnoseWordcodeInstruction,
} from './read-wordcode.js'
import { diagnoseReferences } from './validate-references.js'
import { diagnoseFunctionPartition } from './partition-functions.js'
import { diagnoseControlFlow } from './build-cfg.js'

const SCHEMA = 'jsconfuser-vm-self-modifying-observation.v1'

class ObservationDecline extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function decline(code, message) {
  throw new ObservationDecline(code, message)
}

function intersects(a, b) {
  return a.start < b.end && b.start < a.end
}

function contained(pc, interval) {
  return pc >= interval.start && pc < interval.end
}

function decrypt(words, destPc, sourceStart, sourceEnd, key) {
  let streamKey = (key ^ destPc) | 0
  return words.slice(sourceStart, sourceEnd).map((word) => {
    streamKey = (streamKey + 0x9e3779b9) | 0
    return (word ^ (streamKey ^ (streamKey >>> 13))) >>> 0
  })
}

function withWords(container, words) {
  return {
    ...container,
    roles: {
      ...container.roles,
      words: { ...container.roles.words, values: words },
    },
  }
}

function requireParsed(diagnosis, code) {
  if (!diagnosis.ok) {
    decline(code, diagnosis.diagnostic.message)
  }
  return diagnosis.result
}

function proveIndirectTargets(container, words, seen, indirect) {
  const opcodes = container.roles.op.values
  const masked = Array(words.length).fill(opcodes.DEBUGGER)
  for (const instruction of seen.values()) {
    const raw =
      instruction.name === 'PATCH'
        ? [
            opcodes.JUMP,
            instruction.nextPc,
            opcodes.DEBUGGER,
            opcodes.DEBUGGER,
            opcodes.DEBUGGER,
          ]
        : instruction.words
    masked.splice(instruction.pc, raw.length, ...raw)
  }
  const padded = withWords(container, masked)
  const wordcode = requireParsed(diagnoseWordcode(padded), 'indirect-proof')
  const references = requireParsed(
    diagnoseReferences(padded, wordcode),
    'indirect-proof',
  )
  const functions = requireParsed(
    diagnoseFunctionPartition(padded, wordcode, references),
    'indirect-proof',
  )
  const cfg = requireParsed(
    diagnoseControlFlow(wordcode, references, functions),
    'indirect-proof',
  )
  const jumpPcs = new Set(indirect)
  if (
    cfg.indirectTargets.length !== jumpPcs.size ||
    cfg.indirectTargets.some(
      (jump) => !jumpPcs.has(jump.pc) || jump.targets.length === 0,
    )
  ) {
    decline('indirect-proof', 'Reachable indirect jumps have no finite proof')
  }
  const setups = [...seen.values()].filter(
    (instruction) => instruction.name === 'FINALLY_SETUP',
  )
  const ownerByPc = new Map(
    functions.ownership.map(({ pc, functionId }) => [pc, functionId]),
  )
  for (const jump of cfg.indirectTargets) {
    const matching = setups.filter(
      (setup) =>
        ownerByPc.get(setup.pc) === jump.functionId &&
        setup.words[2] === jump.sourceRegister &&
        jump.pc >= setup.words[1] &&
        jump.pc < setup.words[4],
    )
    if (matching.length === 0) {
      decline('indirect-proof', `JUMP_REG@${jump.pc} has no finalizer`)
    }
    for (const target of jump.targets) {
      const origins = jump.origins[target]
      if (!Array.isArray(origins) || origins.length === 0) {
        decline('indirect-proof', `JUMP_REG@${jump.pc} has no target origin`)
      }
      for (const origin of origins) {
        if (origin.startsWith('exception@')) {
          const sourcePc = Number(origin.slice('exception@'.length))
          if (
            !seen.has(sourcePc) ||
            !matching.some((setup) => setup.words[4] === target)
          ) {
            decline('indirect-proof', `JUMP_REG@${jump.pc} has no throw pad`)
          }
          continue
        }
        const sourcePc = Number(origin)
        const load = seen.get(sourcePc)
        if (
          !load ||
          load.name !== 'LOAD_INT' ||
          load.words[1] !== jump.sourceRegister ||
          load.words[2] !== target ||
          !matching.some(
            (setup) => sourcePc > setup.pc && sourcePc < setup.words[4],
          )
        ) {
          decline('indirect-proof', `JUMP_REG@${jump.pc} has no label load`)
        }
      }
    }
  }
  return cfg.indirectTargets
}

// This observes the statically reachable portion of the original word stream.
// It never invokes the encoded program or parses encrypted trailing slices.
export function diagnoseSelfModifyingRegions(container) {
  try {
    const original = container?.roles?.words?.values
    if (!Array.isArray(original) || original.length === 0) {
      decline('invalid-container', 'Numeric word stream is missing')
    }
    const words = original.slice()
    const pending = [0]
    const seen = new Map()
    const occupied = []
    const patches = []
    const sources = []
    const destinations = []
    const indirect = []

    let indirectTargets = []
    while (true) {
      if (pending.length === 0) {
        if (indirect.length === 0) break
        indirectTargets = proveIndirectTargets(container, words, seen, indirect)
        const missing = indirectTargets
          .flatMap((jump) => jump.targets)
          .filter((target) => !seen.has(target))
        if (missing.length === 0) break
        pending.push(...missing)
      }
      const pc = pending.pop()
      if (!Number.isSafeInteger(pc) || pc < 0 || pc >= words.length) {
        decline('invalid-control-target', `Reachable PC ${pc} is out of bounds`)
      }
      if (seen.has(pc)) continue
      if (sources.some((region) => contained(pc, region))) {
        decline('source-reachable', `Control reaches encrypted source at ${pc}`)
      }
      if (occupied.some((instruction) => contained(pc, instruction))) {
        decline('nonboundary-target', `Control reaches an operand at ${pc}`)
      }

      if (words[pc] === container.roles.op.values.PATCH) {
        if (pc + 5 > words.length) {
          decline('truncated-patch', `PATCH at ${pc} has no full header`)
        }
        const [opcode, destPc, sourceStart, sourceEnd, key] = words.slice(
          pc,
          pc + 5,
        )
        if (
          ![opcode, destPc, sourceStart, sourceEnd, key].every(
            (word) => Number.isInteger(word) && word >= 0 && word <= 0xffffffff,
          )
        ) {
          decline('invalid-patch-word', `PATCH at ${pc} has a non-u32 word`)
        }
        if (destPc !== pc + 5) {
          decline('patch-destination', `PATCH at ${pc} is not inline`)
        }
        const width = sourceEnd - sourceStart
        const header = { start: pc, end: pc + 5 }
        const destination = { start: destPc, end: destPc + width }
        const source = { start: sourceStart, end: sourceEnd }
        if (
          width <= 0 ||
          sourceStart < destination.end ||
          sourceEnd > words.length ||
          destination.end > words.length
        ) {
          decline('patch-interval', `PATCH at ${pc} has invalid intervals`)
        }
        if (
          [...sources, ...destinations].some(
            (interval) =>
              intersects(interval, header) ||
              intersects(interval, destination) ||
              intersects(interval, source),
          ) ||
          occupied.some(
            (interval) =>
              intersects(interval, destination) || intersects(interval, source),
          )
        ) {
          decline('patch-overlap', `PATCH at ${pc} overlaps observed code`)
        }

        const clear = decrypt(original, destPc, sourceStart, sourceEnd, key)
        const parsed = requireParsed(
          diagnoseWordcode(withWords(container, clear)),
          'patch-ciphertext',
        )
        if (parsed.wordCount !== width) {
          decline('patch-width', `PATCH at ${pc} changed region width`)
        }
        words.splice(destPc, width, ...clear)
        sources.push(source)
        destinations.push(destination)
        patches.push({
          pc,
          destPc,
          sourceStart,
          sourceEnd,
          width,
          instructions: parsed.instructions.map(({ name, pc: offset }) => ({
            pc: destPc + offset,
            name,
          })),
        })
        seen.set(pc, { pc, name: 'PATCH', nextPc: destPc, width: 5 })
        occupied.push(header)
        pending.push(destPc)
        continue
      }

      const instruction = requireParsed(
        diagnoseWordcodeInstruction(withWords(container, words), pc),
        'reachable-wordcode',
      )
      const interval = { start: pc, end: instruction.nextPc }
      if (
        sources.some((source) => intersects(source, interval)) ||
        occupied.some((prior) => intersects(prior, interval))
      ) {
        decline(
          'nonboundary-target',
          `Instruction at ${pc} crosses an interval`,
        )
      }
      occupied.push(interval)
      seen.set(pc, instruction)

      const target = (offset) => pending.push(instruction.words[offset])
      switch (instruction.name) {
        case 'JUMP':
          target(1)
          break
        case 'RETURN':
        case 'THROW':
          break
        case 'JUMP_REG':
          indirect.push(pc)
          break
        case 'JUMP_IF_FALSE':
        case 'JUMP_IF_TRUE':
          target(2)
          pending.push(instruction.nextPc)
          break
        case 'FOR_IN_NEXT':
          target(3)
          pending.push(instruction.nextPc)
          break
        case 'TRY_SETUP':
          target(1)
          pending.push(instruction.nextPc)
          break
        case 'FINALLY_SETUP':
          target(1)
          target(4)
          pending.push(instruction.nextPc)
          break
        case 'MAKE_CLOSURE':
          target(2)
          pending.push(instruction.nextPc)
          break
        default:
          pending.push(instruction.nextPc)
      }
    }

    if (patches.length === 0) {
      decline('no-reachable-patch', 'No reachable PATCH was observed')
    }
    return {
      ok: true,
      result: {
        schemaVersion: SCHEMA,
        complete: true,
        patches: patches.sort((a, b) => a.pc - b.pc),
        reachableInstructions: [...seen.values()].sort((a, b) => a.pc - b.pc),
        sourceIntervals: sources.sort((a, b) => a.start - b.start),
        destinationIntervals: destinations.sort((a, b) => a.start - b.start),
        indirectTargets,
        unresolvedIndirectPcs: [],
        patchedWords: words,
      },
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof ObservationDecline ? error.code : 'observer-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
