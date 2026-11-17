import { declines } from '../../decline.js'
import { diagnoseObservedWordcodeInstruction } from '../wordcode/read-wordcode.js'
import { selectContinuationLoads } from '../wordcode/finally-continuations.js'
import { LABEL_WORD_OFFSETS } from '../wordcode/wordcode-operands.js'

const { decline, accepted, refused } = declines('self-modifying-observation')

const SCHEMA = 'jsconfuser-vm-self-modifying-observation.v2'
const TERMINATORS = new Set(['JUMP', 'RETURN', 'THROW', 'JUMP_REG'])
// The operations that end a body selfModifying collects (its JUMP_OPS and RETURN).
const BODY_ENDS = new Set([
  'JUMP',
  'JUMP_IF_FALSE',
  'JUMP_IF_TRUE',
  'FOR_IN_NEXT',
  'TRY_SETUP',
  'FINALLY_SETUP',
  'RETURN',
])
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

// An added opcode ends control when its last canonical step does; fused anti steps never do.
function terminates(instruction) {
  if (TERMINATORS.has(instruction.name)) return true
  return (
    instruction.name !== 'SYNTHETIC' &&
    TERMINATORS.has(instruction.steps?.at(-1)?.name)
  )
}

// selfModifying's outer scan stands on an instruction unless a label opened a body around it: a body
// runs from its label to the next jump or RETURN, and JUMP_REG and THROW do not end one. Walk back:
// a body end comes first when the scan reached it, a body's opening when it did not. A body opens at
// a PC of `labels`, or at an instruction named in `openingNames`.
export function outerScanReaches(
  code,
  index,
  labels,
  openingNames = new Set(),
) {
  for (let at = index; at >= 0; at--) {
    if (BODY_ENDS.has(code[at].name)) return true
    if (labels.has(code[at].pc) || openingNames.has(code[at].name)) return false
  }
  return false
}

// The canonical steps an instruction runs: an added opcode's own steps, else itself.
export function stepsOf(instruction) {
  return instruction.steps && instruction.name !== 'SYNTHETIC'
    ? instruction.steps
    : [instruction]
}

// The sorted distinct function starts: PC 0 and every closure entry.
export function functionStarts(instructions) {
  return [
    ...new Set([
      0,
      ...instructions.flatMap((instruction) =>
        stepsOf(instruction)
          .filter(({ name }) => name === 'MAKE_CLOSURE')
          .map(({ words }) => words[2]),
      ),
    ]),
  ].sort((left, right) => left - right)
}

// The index of the function holding `pc`, over `functionStarts`.
export const functionOf = (starts) => (pc) =>
  starts.findLastIndex((start) => start <= pc)

// JUMP_REG is the only operation that takes the PC from data. The compiler's finalizer JUMP_REG
// reads its FINALLY_SETUP continuation register; true when every JUMP_REG is such a finalizer, so
// the continuation loads are all its targets and every label is visible.
export function finalizersOnly(items) {
  const continuations = new Set(
    items
      .filter(({ name }) => name === 'FINALLY_SETUP')
      .map(({ functionId, words }) => `${functionId}:${words[2]}`),
  )
  return items.every(
    ({ name, functionId, words }) =>
      name !== 'JUMP_REG' || continuations.has(`${functionId}:${words[1]}`),
  )
}

// After a canonical terminator, selfModifying may plant up to two decoy entries (a decoy PATCH or a
// filler shape) before the next block's label. The run ends at the first block start this stage
// can see (direct targets, closure entries, handler targets, finally continuation literals), at a
// real PATCH, or at any instruction no filler can be. While its budget lasts, selfModifying
// patches a block's whole body, so a block it reached starts with a PATCH or its own terminator.
// When every JUMP_REG is a finalizer, the visible starts are every label and a matched entry
// is a filler. Otherwise a JUMP_REG (the dispatcher's) hides labels only a later decoder recovers:
// a matched entry is a suspect, kept as code and settled by this rule once that decoder has run.
// selfModifying plants only where its outer scan stands, so a terminator inside a collected body
// anchors no run: what follows it is the body's own code.
function matchFillers(code) {
  const visible = new Set([0])
  for (const instruction of code)
    for (const step of stepsOf(instruction))
      for (const offset of LABEL_WORD_OFFSETS[step.name] ?? [])
        visible.add(step.words[offset])
  const functionId = functionOf(functionStarts(code))
  const items = code.flatMap((instruction) =>
    stepsOf(instruction).map((step) => ({
      key: step,
      functionId: functionId(instruction.pc),
      name: step.name,
      words: step.words,
    })),
  )
  for (const load of selectContinuationLoads(items)) visible.add(load.words[2])
  const runs = decoyRuns(code, visible)
  const matched = runs.flatMap(({ entries }) => entries)
  return finalizersOnly(items)
    ? { fillers: matched, suspects: [], suspectRuns: [] }
    : {
        fillers: [],
        suspects: matched,
        suspectRuns: runs.filter(({ entries }) => entries.length > 0),
      }
}

// The entries matched after each terminator the outer scan stands on; a PATCH opens a body too.
const PATCH_OPENS = new Set(['PATCH'])

function decoyRuns(code, visible) {
  const runs = []
  for (let index = 0; index < code.length; index++) {
    if (!TERMINATORS.has(code[index].name)) continue
    if (!outerScanReaches(code, index, visible, PATCH_OPENS)) continue
    runs.push({
      anchor: code[index].pc,
      entries: runAfter(code, index, visible),
    })
  }
  return runs
}

function runAfter(code, index, visible) {
  const run = []
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
  return run
}

// The execution-word sweep from PC 0 (steps 1 and 2): materializes real PATCH regions, skips
// decoys, and lowers the storage bound as headers name storage.
class PatchSweep {
  constructor(container, addedOpcodes) {
    this.container = container
    this.addedOpcodes = addedOpcodes
    this.original = container.roles.words.values
    this.patchOpcode = container.roles.op.values.PATCH
    this.words = this.original.slice()
    this.instructions = []
    this.patches = []
    this.decoys = []
    this.sources = []
    this.destinations = []
    this.storageStart = this.words.length
    this.unparsedPc = null
    this.storageFailure = null
  }

  // Each step returns the next PC, or null where the sweep stops.
  run() {
    let pc = 0
    while (pc !== null && pc < this.storageStart)
      pc =
        this.words[pc] === this.patchOpcode
          ? this.patchAt(pc)
          : this.instructionAt(pc)
    return this
  }

  instructionAt(pc) {
    const parsed = diagnoseObservedWordcodeInstruction(
      withWords(this.container, this.words),
      pc,
      this.addedOpcodes,
    )
    // Only storage fails to parse here; the end rule drops it.
    if (!parsed.ok) {
      this.unparsedPc = pc
      return null
    }
    // Code never overlaps storage: an instruction reaching past the bound is junk.
    if (parsed.result.nextPc > this.storageStart) return null
    this.instructions.push(parsed.result)
    return parsed.result.nextPc
  }

  patchAt(pc) {
    if (pc + 5 > this.words.length)
      decline('truncated-patch', `PATCH at ${pc} has no full header`)
    const header = this.words.slice(pc, pc + 5)
    if (
      !header.every(
        (word) => Number.isInteger(word) && word >= 0 && word <= 0xffffffff,
      )
    )
      decline('invalid-patch-word', `PATCH at ${pc} has a non-u32 word`)
    const [, destPc, sourceStart, sourceEnd] = header
    const width = sourceEnd - sourceStart
    if (
      destPc !== pc + 5 ||
      width <= 0 ||
      sourceStart < destPc + width ||
      sourceEnd > this.words.length
    )
      return this.decoyAt(pc, header)
    return this.realPatchAt(pc, header)
  }

  decoyAt(pc, [, destPc, sourceStart, sourceEnd]) {
    this.decoys.push({ pc, destPc, sourceStart, sourceEnd })
    // Decoys address only storage, including addresses behind the sweep.
    this.storageStart = Math.min(this.storageStart, destPc, sourceStart)
    this.instructions.push({ pc, name: 'DECOY', nextPc: pc + 5, width: 5 })
    return pc + 5
  }

  realPatchAt(pc, [, destPc, sourceStart, sourceEnd, key]) {
    const width = sourceEnd - sourceStart
    const destination = { start: destPc, end: destPc + width }
    const source = { start: sourceStart, end: sourceEnd }
    const overlaps = [...this.sources, ...this.destinations].some(
      (interval) =>
        intersects(interval, destination) || intersects(interval, source),
    )
    const clear = decrypt(this.original, destPc, sourceStart, sourceEnd, key)
    const region = overlaps
      ? { unparsed: 'patch-overlap' }
      : this.parseRegion(clear, width)
    // A real region always decrypts to whole instructions and overlaps nothing; a header that
    // fails either is an arena decoy, so storage starts here.
    if (region.unparsed) {
      this.storageFailure = { code: region.unparsed, pc }
      this.storageStart = Math.min(this.storageStart, pc)
      return null
    }
    this.words.splice(destPc, width, ...clear)
    this.sources.push(source)
    this.destinations.push(destination)
    this.patches.push({
      pc,
      destPc,
      sourceStart,
      sourceEnd,
      width,
      instructions: region.parsed.map(({ name, pc: offset }) => ({
        pc: destPc + offset,
        name,
      })),
    })
    this.storageStart = Math.min(this.storageStart, sourceStart)
    this.instructions.push({ pc, name: 'PATCH', nextPc: destPc, width: 5 })
    return destPc
  }

  parseRegion(clear, width) {
    const clearContainer = withWords(this.container, clear)
    const parsed = []
    for (let offset = 0; offset < width; ) {
      const step = diagnoseObservedWordcodeInstruction(
        clearContainer,
        offset,
        this.addedOpcodes,
      )
      if (!step.ok) return { unparsed: 'patch-ciphertext' }
      parsed.push(step.result)
      offset = step.result.nextPc
    }
    return { parsed }
  }
}

// Step 3. An arena block's last word is a random canonical opcode reading its operand from the
// next item; a terminator whose operand no compiled instruction could hold is that word, not code.
function endOfCode({ instructions, storageStart, storageFailure }, container) {
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
  return instructions.slice(0, last + 1)
}

function observeRegions(container, addedOpcodes, requirePatch) {
  const original = container?.roles?.words?.values
  if (!Array.isArray(original) || original.length === 0)
    decline('invalid-container', 'Numeric word stream is missing')
  const sweep = new PatchSweep(container, addedOpcodes).run()
  const code = endOfCode(sweep, container)
  const end = code.at(-1).nextPc
  if (requirePatch && sweep.patches.length === 0) {
    // Without a PATCH, storage is undefined: an unparsed word proves nothing about absence.
    if (sweep.unparsedPc !== null)
      decline('unparsed-word', `Word at ${sweep.unparsedPc} does not parse`)
    decline('no-patch', 'No PATCH precedes storage')
  }
  const { fillers, suspects, suspectRuns } = matchFillers(code)
  return {
    schemaVersion: SCHEMA,
    patches: sweep.patches.filter((patch) => patch.pc < end),
    decoys: sweep.decoys.filter((decoy) => decoy.pc < end),
    fillers,
    suspects,
    suspectRuns,
    instructions: code,
    end,
    storageStart: sweep.storageStart,
    sourceIntervals: sweep.sources.sort((a, b) => a.start - b.start),
    destinationIntervals: sweep.destinations.sort((a, b) => a.start - b.start),
    patchedWords: sweep.words,
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
    return accepted(observeRegions(container, addedOpcodes, requirePatch), {
      fallback: 'observer-error',
    })
  } catch (error) {
    return refused(error, {
      fallback: 'observer-error',
    })
  }
}
