import { diagnoseObservedWordcodeInstruction } from './read-wordcode.js'
import { selectContinuationLoads } from './finally-continuations.js'

const SCHEMA = 'jsconfuser-vm-self-modifying-observation.v2'
const TERMINATORS = new Set(['JUMP', 'RETURN', 'THROW', 'JUMP_REG'])
const DIRECT_TARGET_OFFSETS = Object.freeze({
  JUMP: [1],
  JUMP_IF_FALSE: [2],
  JUMP_IF_TRUE: [2],
  FOR_IN_NEXT: [3],
  TRY_SETUP: [1],
  FINALLY_SETUP: [1, 4],
  MAKE_CLOSURE: [2],
})
// The encoder's decoy filler shapes: no constant reader, no transfer, no call.
const FILLER_SHAPES = new Set([
  'TRY_END',
  'LOAD_THIS',
  'MOVE',
  'LOAD_INT',
  'UNARY_NEG',
  'UNARY_NOT',
  'UNARY_BITNOT',
  'TYPEOF',
  'ADD',
  'SUB',
  'MUL',
  'DIV',
  'MOD',
  'BAND',
  'BOR',
  'BXOR',
  'SHL',
  'SHR',
  'USHR',
  'LT',
  'GT',
  'LTE',
  'GTE',
  'EQ',
  'NEQ',
  'GET_PROP',
])
const DECOY_RUN_MAX = 2

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

// An added opcode ends control when its last canonical step does; fused anti steps never do.
function terminates(instruction) {
  if (TERMINATORS.has(instruction.name)) return true
  return (
    instruction.name !== 'SYNTHETIC' &&
    TERMINATORS.has(instruction.steps?.at(-1)?.name)
  )
}

function stepsOf(instruction) {
  return instruction.steps && instruction.name !== 'SYNTHETIC'
    ? instruction.steps
    : [instruction]
}

// After a canonical terminator, selfModifying may plant up to two decoy entries (a decoy PATCH or a
// filler shape) before the next block's label. The run ends at the first block start this stage
// can see (direct targets, closure entries, handler targets, finally continuation literals), at a
// real PATCH, or at any instruction no filler can be. While its budget lasts, selfModifying
// patches a block's whole body, so a block it reached starts with a PATCH or its own terminator.
// JUMP_REG is the only operation that takes the PC from data. The compiler's finalizer JUMP_REG
// reads its FINALLY_SETUP continuation register, so the continuation loads are all its targets.
// When every JUMP_REG is such a finalizer, the visible starts are every label and a matched entry
// is a filler. Otherwise a JUMP_REG (the dispatcher's) hides labels only a later decoder recovers:
// a matched entry is a suspect, kept as code and settled by this rule once that decoder has run.
function matchFillers(code) {
  const visible = new Set([0])
  const starts = [0]
  for (const instruction of code) {
    for (const step of stepsOf(instruction)) {
      for (const offset of DIRECT_TARGET_OFFSETS[step.name] ?? [])
        visible.add(step.words[offset])
      if (step.name === 'MAKE_CLOSURE') starts.push(step.words[2])
    }
  }
  starts.sort((left, right) => left - right)
  const functionOf = (pc) => starts.findLastIndex((start) => start <= pc)
  const items = code.flatMap((instruction) =>
    stepsOf(instruction).map((step) => ({
      key: step,
      functionId: functionOf(instruction.pc),
      name: step.name,
      words: step.words,
    })),
  )
  for (const load of selectContinuationLoads(items)) visible.add(load.words[2])
  const continuations = new Set(
    items
      .filter(({ name }) => name === 'FINALLY_SETUP')
      .map(({ functionId, words }) => `${functionId}:${words[2]}`),
  )
  const complete = items.every(
    ({ name, functionId, words }) =>
      name !== 'JUMP_REG' || continuations.has(`${functionId}:${words[1]}`),
  )
  const runs = []
  for (let index = 0; index < code.length; index++) {
    if (!TERMINATORS.has(code[index].name)) continue
    const run = []
    runs.push(run)
    for (
      let next = index + 1, entries = 0;
      next < code.length && entries < DECOY_RUN_MAX;
      next++, entries++
    ) {
      const entry = code[next]
      if (visible.has(entry.pc) || entry.name === 'PATCH') break
      if (entry.name === 'DECOY') continue
      if (!FILLER_SHAPES.has(entry.name)) break
      run.push(entry.pc)
    }
  }
  const matched = runs.flat()
  return complete
    ? { fillers: matched, suspects: [], suspectRuns: [] }
    : {
        fillers: [],
        suspects: matched,
        suspectRuns: runs.filter((run) => run.length > 0),
      }
}

// selfModifying moves runs of code into encrypted trailing storage and leaves, at the execution
// site, a five-word PATCH followed by garbage of the run's width. Its decoys copy junk to junk
// inside that storage. Read the execution words in order from PC 0: a real PATCH targets its own
// next word and copies from storage after that destination, so materialize it and continue at the
// destination; skip any other PATCH as a decoy. Storage starts no later than the lowest address
// any PATCH header names, wherever the header sits. Code ends after the last terminator before
// that whose operand compiled code could hold: a function never falls off its end, and storage's
// only terminator-like word is an arena block's random last word, whose operand belongs to the
// next item. Nothing is interpreted beyond widths, terminators and those operands.
export function diagnoseSelfModifyingRegions(
  container,
  addedOpcodes = {},
  { requirePatch = true } = {},
) {
  try {
    const original = container?.roles?.words?.values
    if (!Array.isArray(original) || original.length === 0) {
      decline('invalid-container', 'Numeric word stream is missing')
    }
    const PATCH = container.roles.op.values.PATCH
    const words = original.slice()
    const instructions = []
    const patches = []
    const decoys = []
    const sources = []
    const destinations = []
    let storageStart = words.length
    let unparsedPc = null
    let storageFailure = null
    let pc = 0
    while (pc < storageStart) {
      if (words[pc] === PATCH) {
        if (pc + 5 > words.length) {
          decline('truncated-patch', `PATCH at ${pc} has no full header`)
        }
        const header = words.slice(pc, pc + 5)
        if (
          !header.every(
            (word) => Number.isInteger(word) && word >= 0 && word <= 0xffffffff,
          )
        ) {
          decline('invalid-patch-word', `PATCH at ${pc} has a non-u32 word`)
        }
        const [, destPc, sourceStart, sourceEnd, key] = header
        const width = sourceEnd - sourceStart
        if (
          destPc !== pc + 5 ||
          width <= 0 ||
          sourceStart < destPc + width ||
          sourceEnd > words.length
        ) {
          decoys.push({ pc, destPc, sourceStart, sourceEnd })
          // Decoys address only storage, including addresses behind the sweep.
          storageStart = Math.min(storageStart, destPc, sourceStart)
          instructions.push({ pc, name: 'DECOY', nextPc: pc + 5, width: 5 })
          pc += 5
          continue
        }
        const destination = { start: destPc, end: destPc + width }
        const source = { start: sourceStart, end: sourceEnd }
        const overlaps = [...sources, ...destinations].some(
          (interval) =>
            intersects(interval, destination) || intersects(interval, source),
        )
        const clear = decrypt(original, destPc, sourceStart, sourceEnd, key)
        const clearContainer = withWords(container, clear)
        const parsed = []
        let unparsed = overlaps ? 'patch-overlap' : null
        for (let offset = 0; offset < width && !unparsed; ) {
          const step = diagnoseObservedWordcodeInstruction(
            clearContainer,
            offset,
            addedOpcodes,
          )
          if (!step.ok) unparsed = 'patch-ciphertext'
          else {
            parsed.push(step.result)
            offset = step.result.nextPc
          }
        }
        // A real region always decrypts to whole instructions and overlaps nothing; a header
        // that fails either is an arena decoy, so storage starts here.
        if (unparsed) {
          storageFailure = { code: unparsed, pc }
          storageStart = Math.min(storageStart, pc)
          break
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
          instructions: parsed.map(({ name, pc: offset }) => ({
            pc: destPc + offset,
            name,
          })),
        })
        storageStart = Math.min(storageStart, sourceStart)
        instructions.push({ pc, name: 'PATCH', nextPc: destPc, width: 5 })
        pc = destPc
        continue
      }
      const parsed = diagnoseObservedWordcodeInstruction(
        withWords(container, words),
        pc,
        addedOpcodes,
      )
      // Only storage fails to parse here; the end rule below drops it.
      if (!parsed.ok) {
        unparsedPc = pc
        break
      }
      // Code never overlaps storage: an instruction reaching past the bound is junk.
      if (parsed.result.nextPc > storageStart) break
      instructions.push(parsed.result)
      pc = parsed.result.nextPc
    }
    // An arena block's last word is a random canonical opcode reading its operand from the next
    // item; a terminator whose operand no compiled instruction could hold is that word, not code.
    const starts = new Set(instructions.map(({ pc }) => pc))
    const frames = [
      [0, container.roles.scalars.MAIN_REG_COUNT?.value ?? Infinity],
    ]
    for (const instruction of instructions)
      for (const step of stepsOf(instruction))
        if (step.name === 'MAKE_CLOSURE')
          frames.push([step.words[2], step.words[4]])
    frames.sort((left, right) => left[0] - right[0])
    const frameOf = (pc) =>
      frames.findLast(([start]) => start <= pc)?.[1] ?? Infinity
    const possible = (instruction) => {
      if (!TERMINATORS.has(instruction.name)) return true
      if (instruction.name === 'JUMP') return starts.has(instruction.words[1])
      return instruction.words[1] < frameOf(instruction.pc)
    }
    const last = instructions.findLastIndex(
      (instruction) =>
        terminates(instruction) &&
        instruction.nextPc <= storageStart &&
        possible(instruction),
    )
    if (last < 0) {
      if (storageFailure)
        decline(
          storageFailure.code,
          `PATCH at ${storageFailure.pc} has no code region`,
        )
      decline('no-code-end', 'No terminator ends the code before storage')
    }
    const code = instructions.slice(0, last + 1)
    const end = code.at(-1).nextPc
    if (requirePatch && patches.length === 0) {
      // Without a PATCH, storage is undefined: an unparsed word proves nothing about absence.
      if (unparsedPc !== null)
        decline('unparsed-word', `Word at ${unparsedPc} does not parse`)
      decline('no-patch', 'No PATCH precedes storage')
    }
    const { fillers, suspects, suspectRuns } = matchFillers(code)
    return {
      ok: true,
      result: {
        schemaVersion: SCHEMA,
        patches: patches.filter((patch) => patch.pc < end),
        decoys: decoys.filter((decoy) => decoy.pc < end),
        fillers,
        suspects,
        suspectRuns,
        instructions: code,
        end,
        storageStart,
        sourceIntervals: sources.sort((a, b) => a.start - b.start),
        destinationIntervals: destinations.sort((a, b) => a.start - b.start),
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
