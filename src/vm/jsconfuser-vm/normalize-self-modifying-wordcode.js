import { diagnoseSelfModifyingRegions } from './observe-self-modifying.js'
import { diagnoseWordcode } from './read-wordcode.js'
import { diagnosePatchAddedOpcodes } from './observe-patch-added-opcodes.js'
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
const ADDED = new Set(['ALIAS', 'MACRO', 'SPECIALIZED', 'SYNTHETIC'])

class NormalizationDecline extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function decline(code, message) {
  throw new NormalizationDecline(code, message)
}

function stepsOf(instruction) {
  return instruction.steps && instruction.name !== 'SYNTHETIC'
    ? instruction.steps
    : [instruction]
}

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
  const functionStarts = [
    ...new Set([
      0,
      ...kept.flatMap((instruction) =>
        stepsOf(instruction)
          .filter(({ name }) => name === 'MAKE_CLOSURE')
          .map(({ words: stepWords }) => stepWords[2]),
      ),
    ]),
  ].sort((left, right) => left - right)
  const functionId = (pc) =>
    functionStarts.findLastIndex((start) => start <= pc)
  const selected = selectContinuationLoads(
    kept
      .filter((instruction) => !suspects.has(instruction.pc))
      .flatMap((instruction) =>
        stepsOf(instruction).map((step, index) => ({
          key: { instruction, index },
          functionId: functionId(instruction.pc),
          name: step.name,
          words: step.words,
        })),
      ),
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
    for (const offset of DIRECT_TARGET_OFFSETS[instruction.name] ?? [])
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
    return {
      ok: true,
      result: {
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
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof NormalizationDecline
            ? error.code
            : 'normalizer-error',
        message: error instanceof Error ? error.message : String(error),
      },
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
    const current = new Map(
      suspects
        .filter((pc) => originPcMap.has(pc))
        .map((pc) => [originPcMap.get(pc), pc]),
    )
    const instructions = wordcode.instructions
    const functionStarts = [
      ...new Set([
        0,
        ...instructions
          .filter(({ name }) => name === 'MAKE_CLOSURE')
          .map(({ words }) => words[2]),
      ]),
    ].sort((left, right) => left - right)
    const functionId = (pc) =>
      functionStarts.findLastIndex((start) => start <= pc)
    const continuations = new Set(
      instructions
        .filter(({ name }) => name === 'FINALLY_SETUP')
        .map(({ pc, words }) => `${functionId(pc)}:${words[2]}`),
    )
    if (
      instructions.some(
        ({ name, pc, words }) =>
          name === 'JUMP_REG' &&
          !continuations.has(`${functionId(pc)}:${words[1]}`),
      )
    )
      return { ok: true, result: null, diagnostic: null }
    // Labels a later stage recovered that the stream reaches only by fallthrough (dispatcher skip
    // labels), as origin PCs.
    const labels = new Set([
      ...functionStarts,
      ...recoveredLabels.map((pc) => originPcMap.get(pc)),
    ])
    for (const instruction of instructions) {
      if (current.has(instruction.pc)) continue
      for (const offset of DIRECT_TARGET_OFFSETS[instruction.name] ?? [])
        labels.add(instruction.words[offset])
    }
    const items = (keep) =>
      instructions
        .filter(({ pc }) => keep(pc))
        .map((instruction) => ({
          key: instruction,
          functionId: functionId(instruction.pc),
          name: instruction.name,
          words: instruction.words,
        }))
    for (const key of selectContinuationLoads(items((pc) => !current.has(pc))))
      labels.add(key.words[2])
    const runs = suspectRuns
      .map((run) =>
        run
          .filter((pc) => current.has(originPcMap.get(pc)))
          .map((pc) => originPcMap.get(pc)),
      )
      .filter((run) => run.length > 0)
    const indexByPc = new Map(instructions.map(({ pc }, index) => [pc, index]))
    // A code suspect that jumps or loads a continuation names a label (a dispatcher route can start
    // on a suspect); repeat until no run changes.
    let code = new Set()
    let addresses = new Set()
    for (;;) {
      const next = new Set()
      for (const run of runs) {
        const first = run.findIndex((pc) => labels.has(pc))
        if (first >= 0) for (const pc of run.slice(first)) next.add(pc)
      }
      addresses = selectContinuationLoads(
        items((pc) => !current.has(pc) || next.has(pc)),
      )
      let grew = false
      for (const pc of next) {
        const instruction = instructions[indexByPc.get(pc)]
        for (const offset of DIRECT_TARGET_OFFSETS[instruction.name] ?? []) {
          if (labels.has(instruction.words[offset])) continue
          labels.add(instruction.words[offset])
          grew = true
        }
      }
      for (const key of addresses) {
        if (!next.has(key.pc)) continue
        const target = originPcMap.get(key.words[2])
        if (target === undefined)
          decline('self-modifying-target', `PC ${key.words[2]} is not code`)
        if (!labels.has(target)) {
          labels.add(target)
          grew = true
        }
      }
      code = next
      if (!grew) break
    }
    const fillers = new Set([...current.keys()].filter((pc) => !code.has(pc)))
    const pcMap = new Map()
    let nextPc = 0
    for (const instruction of instructions) {
      if (fillers.has(instruction.pc)) continue
      pcMap.set(instruction.pc, nextPc)
      nextPc += instruction.nextPc - instruction.pc
    }
    pcMap.set(wordcode.wordCount, nextPc)
    const remap = (target) => {
      if (!pcMap.has(target))
        decline('self-modifying-target', `PC ${target} is not recovered code`)
      return pcMap.get(target)
    }
    const loads = new Set([...addresses].map(({ pc }) => pc))
    const words = instructions.flatMap((instruction) => {
      if (fillers.has(instruction.pc)) return []
      const raw = instruction.words.slice()
      for (const offset of DIRECT_TARGET_OFFSETS[instruction.name] ?? [])
        raw[offset] = remap(raw[offset])
      if (loads.has(instruction.pc))
        raw[2] = remap(
          code.has(instruction.pc) ? originPcMap.get(raw[2]) : raw[2],
        )
      return raw
    })
    const normalized = structuredClone(container)
    normalized.roles.words.values = words
    const settled = diagnoseWordcode(normalized)
    if (!settled.ok)
      decline(settled.diagnostic.code, settled.diagnostic.message)
    return {
      ok: true,
      result: {
        container: normalized,
        wordcode: settled.result,
        pcMap,
        suspects: [],
        suspectRuns: [],
        fillerCount: fillers.size,
      },
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof NormalizationDecline
            ? error.code
            : 'normalizer-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
