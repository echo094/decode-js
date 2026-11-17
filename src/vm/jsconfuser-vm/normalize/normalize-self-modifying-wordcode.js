import { declines } from '../../decline.js'
import {
  diagnoseSelfModifyingRegions,
  finalizersOnly,
  functionOf,
  functionStarts,
  outerScanReaches,
  stepsOf,
} from './analyze-self-modifying-regions.js'
import { LABEL_WORD_OFFSETS } from '../wordcode/wordcode-operands.js'
import { diagnoseWordcode } from '../wordcode/read-wordcode.js'
import { diagnosePatchAddedOpcodes } from '../observe/observe-patch-added-opcodes.js'
import { selectContinuationLoads } from '../wordcode/finally-continuations.js'

const { decline, accepted, refused } = declines('self-modifying-normalization')

const ADDED = new Set(['ALIAS', 'MACRO', 'SPECIALIZED', 'SYNTHETIC'])

// Removes what selfModifying added (PATCH headers, decoy PATCHes, decoy fillers and the storage
// after the code) and keeps every other word as the encoder left it. Only canonical instructions'
// addresses are relocated here; an added opcode keeps origin addresses, which its own stage
// translates through the published originPcMap (origin PC -> output PC) and
// originContinuationLoads. A suspect filler stays as code with a map entry, published by its origin
// PC; it is read past here, so a suspect LOAD_INT is never a continuation load and keeps its words.
function compact(container, observation) {
  const words = observation.patchedWords
  const pcMap = new Map()
  const kept = []
  let nextPc = 0
  const fillers = new Set(observation.fillers)
  const suspects = new Set(observation.suspects)
  // A block's label can sit on its PATCH header, which forwards to the block's first decrypted
  // instruction. Decoys and fillers sit after a terminator and before the next label, so no
  // address names one; they get no entry and a target naming one declines.
  for (const instruction of observation.instructions) {
    if (instruction.name === 'PATCH') pcMap.set(instruction.pc, nextPc)
    if (
      instruction.name === 'PATCH' ||
      instruction.name === 'DECOY' ||
      fillers.has(instruction.pc)
    )
      continue
    pcMap.set(instruction.pc, nextPc)
    kept.push(instruction)
    nextPc += instruction.nextPc - instruction.pc
  }
  pcMap.set(observation.end, nextPc)
  const remap = (target) => {
    if (!pcMap.has(target)) {
      decline('self-modifying-target', `PC ${target} is not recovered code`)
    }
    return pcMap.get(target)
  }
  const functionId = functionOf(functionStarts(kept))
  const selected = selectContinuationLoads(
    kept.flatMap((instruction) =>
      stepsOf(instruction).map((step, index) => ({
        pc: instruction.pc,
        key: { instruction, index },
        functionId: functionId(instruction.pc),
        name: step.name,
        words: step.words,
      })),
    ),
    suspects,
  )
  const continuationLoads = new Set()
  // Continuation loads inside added opcodes keep their origin values for the opcode's own stage;
  // publish them (output PC -> step indexes) so that stage translates this proof rather than
  // selecting again over a view where another added opcode can hide the FINALLY_SETUP.
  const originContinuationLoads = new Map()
  for (const { instruction, index } of selected) {
    if (!ADDED.has(instruction.name)) {
      continuationLoads.add(instruction.pc)
      continue
    }
    const pc = pcMap.get(instruction.pc)
    if (!originContinuationLoads.has(pc)) originContinuationLoads.set(pc, [])
    originContinuationLoads.get(pc).push(index)
  }
  const compactWords = kept.flatMap((instruction) => {
    const raw = words.slice(instruction.pc, instruction.nextPc)
    if (ADDED.has(instruction.name)) return raw
    for (const offset of LABEL_WORD_OFFSETS[instruction.name] ?? [])
      raw[offset] = remap(raw[offset])
    if (continuationLoads.has(instruction.pc)) raw[2] = remap(raw[2])
    return raw
  })
  const normalized = structuredClone(container)
  normalized.roles.words.values = compactWords
  return { container: normalized, pcMap, kept, originContinuationLoads }
}

export function diagnoseNormalizeSelfModifyingWordcode(
  container,
  { source = null } = {},
) {
  try {
    const runtime = source
      ? diagnosePatchAddedOpcodes(source)
      : { ok: true, result: {} }
    if (!runtime.ok)
      decline(runtime.diagnostic.code, runtime.diagnostic.message)
    const observed = diagnoseSelfModifyingRegions(container, runtime.result)
    if (!observed.ok) {
      decline(observed.diagnostic.code, observed.diagnostic.message)
    }
    const compacted = compact(container, observed.result)
    const wordcode = diagnoseWordcode(compacted.container)
    return accepted(
      {
        schemaVersion: 'jsconfuser-vm-self-modifying-normalization.v2',
        container: compacted.container,
        wordcode: wordcode.ok ? wordcode.result : null,
        originPcMap: compacted.pcMap,
        originContinuationLoads: compacted.originContinuationLoads,
        suspects: observed.result.suspects,
        suspectRuns: observed.result.suspectRuns,
        originalWordCount: container.roles.words.values.length,
        wordCount: compacted.container.roles.words.values.length,
        patchCount: observed.result.patches.length,
        decoyCount: observed.result.decoys.length,
        fillerCount: observed.result.fillers.length,
        addedOpcodeCounts: Object.fromEntries(
          [...ADDED].map((name) => [
            name,
            compacted.kept.filter((instruction) => instruction.name === name)
              .length,
          ]),
        ),
      },
      { fallback: 'normalizer-error' },
    )
  } catch (error) {
    return refused(error, { fallback: 'normalizer-error' })
  }
}

// The settle's labels and code over the current canonical stream. `settle` runs its steps in order.
class Settlement {
  constructor(
    wordcode,
    { suspects, suspectRuns, originPcMap, recoveredLabels },
  ) {
    this.wordcode = wordcode
    this.instructions = wordcode.instructions
    this.suspectRuns = suspectRuns
    this.originPcMap = originPcMap
    this.recoveredLabels = recoveredLabels
    this.starts = functionStarts(this.instructions)
    const functionId = functionOf(this.starts)
    this.items = this.instructions.map((instruction) => ({
      pc: instruction.pc,
      key: instruction,
      functionId: functionId(instruction.pc),
      name: instruction.name,
      words: instruction.words,
    }))
    this.current = new Map(
      suspects
        .filter((pc) => originPcMap.has(pc))
        .map((pc) => [originPcMap.get(pc), pc]),
    )
    this.indexByPc = new Map(
      this.instructions.map(({ pc }, index) => [pc, index]),
    )
    this.labels = new Set()
  }

  // Null while a JUMP_REG is not a finalizer's: labels are still hidden.
  settle(container) {
    if (!finalizersOnly(this.items)) return null
    this.seedLabels()
    return this.dropFillers(container, this.settleRuns(this.currentRuns()))
  }

  // Function starts, the direct targets and continuation literals of non-suspects, and the labels
  // a later stage recovered that the stream reaches only by fallthrough (dispatcher skip labels).
  seedLabels() {
    this.labels = new Set([
      ...this.starts,
      ...this.recoveredLabels.map((pc) => this.originPcMap.get(pc)),
    ])
    for (const instruction of this.instructions) {
      if (this.current.has(instruction.pc)) continue
      for (const offset of LABEL_WORD_OFFSETS[instruction.name] ?? [])
        this.labels.add(instruction.words[offset])
    }
    for (const key of selectContinuationLoads(
      this.items,
      new Set(this.current.keys()),
    ))
      this.labels.add(key.words[2])
  }

  // The observation's runs in current PCs, suspects only.
  currentRuns() {
    const current = (pc) => this.originPcMap.get(pc)
    return this.suspectRuns
      .map(({ anchor, entries }) => ({
        anchor: this.indexByPc.get(current(anchor)),
        entries: entries
          .filter((pc) => this.current.has(current(pc)))
          .map(current),
      }))
      .filter(({ entries }) => entries.length > 0)
  }

  // A code suspect that jumps or loads a continuation names a label (a dispatcher route can start
  // on a suspect); repeat until no label is added.
  settleRuns(runs) {
    for (;;) {
      const code = this.codeOf(runs)
      const addresses = selectContinuationLoads(
        this.items,
        new Set([...this.current.keys()].filter((pc) => !code.has(pc))),
      )
      if (!this.grow(code, addresses)) return { code, addresses }
    }
  }

  // A run's anchor inside a collected body, now that every label is known, makes the run the
  // body's own code. Otherwise a run is code from its first label.
  codeOf(runs) {
    const { instructions, labels } = this
    const code = new Set()
    for (const { anchor, entries } of runs) {
      const inBody =
        anchor !== undefined && !outerScanReaches(instructions, anchor, labels)
      const first = inBody ? 0 : entries.findIndex((pc) => labels.has(pc))
      if (first >= 0) for (const pc of entries.slice(first)) code.add(pc)
    }
    return code
  }

  // Whether the code's direct targets and continuation literals add a label.
  grow(code, addresses) {
    const before = this.labels.size
    for (const pc of code) {
      const instruction = this.instructions[this.indexByPc.get(pc)]
      for (const offset of LABEL_WORD_OFFSETS[instruction.name] ?? [])
        this.labels.add(instruction.words[offset])
    }
    for (const key of addresses) {
      if (!code.has(key.pc)) continue
      const target = this.originPcMap.get(key.words[2])
      if (target === undefined)
        decline('self-modifying-target', `PC ${key.words[2]} is not code`)
      this.labels.add(target)
    }
    return this.labels.size !== before
  }

  // Drop the fillers; remap direct targets and continuation literals (a code suspect's literal is
  // an `extract-container` word: through originPcMap first); parse.
  dropFillers(container, { code, addresses }) {
    const fillers = new Set(
      [...this.current.keys()].filter((pc) => !code.has(pc)),
    )
    const pcMap = new Map()
    let nextPc = 0
    for (const instruction of this.instructions) {
      if (fillers.has(instruction.pc)) continue
      pcMap.set(instruction.pc, nextPc)
      nextPc += instruction.nextPc - instruction.pc
    }
    pcMap.set(this.wordcode.wordCount, nextPc)
    const remap = (target) => {
      if (!pcMap.has(target))
        decline('self-modifying-target', `PC ${target} is not recovered code`)
      return pcMap.get(target)
    }
    const loads = new Set([...addresses].map(({ pc }) => pc))
    const words = this.instructions
      .filter(({ pc }) => !fillers.has(pc))
      .flatMap((instruction) => {
        const raw = instruction.words.slice()
        for (const offset of LABEL_WORD_OFFSETS[instruction.name] ?? [])
          raw[offset] = remap(raw[offset])
        if (loads.has(instruction.pc))
          raw[2] = remap(
            code.has(instruction.pc) ? this.originPcMap.get(raw[2]) : raw[2],
          )
        return raw
      })
    const normalized = structuredClone(container)
    normalized.roles.words.values = words
    const settled = diagnoseWordcode(normalized)
    if (!settled.ok)
      decline(settled.diagnostic.code, settled.diagnostic.message)
    return {
      container: normalized,
      wordcode: settled.result,
      pcMap,
      suspects: [],
      suspectRuns: [],
      fillerCount: fillers.size,
    }
  }
}

// Settles PATCH suspects once a later decoder has recovered the labels they hid: the filler rule
// reruns over the current canonical stream. Labels are complete when every JUMP_REG is a
// finalizer's (it reads its FINALLY_SETUP continuation register); otherwise nothing is settled. In
// each run selfModifying planted after a terminator, the entries before the first one a label names
// are fillers and leave; that entry and the rest are code. A suspect that is code and loads a
// continuation still holds an origin address, resolved here through originPcMap. Returns null when
// nothing can be settled yet; suspects is then unchanged.
export function diagnoseSettleSelfModifyingSuspects(
  container,
  wordcode,
  { suspects, suspectRuns, originPcMap, recoveredLabels = [] },
) {
  try {
    return accepted(
      new Settlement(wordcode, {
        suspects,
        suspectRuns,
        originPcMap,
        recoveredLabels,
      }).settle(container),
      { fallback: 'normalizer-error' },
    )
  } catch (error) {
    return refused(error, { fallback: 'normalizer-error' })
  }
}
