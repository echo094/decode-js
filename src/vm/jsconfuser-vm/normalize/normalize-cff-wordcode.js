import { declines } from '../../decline.js'
import { selectContinuationLoads } from '../wordcode/finally-continuations.js'
import { diagnoseWordcode } from '../wordcode/read-wordcode.js'
import { diagnoseReferences } from '../wordcode/validate-references.js'
import {
  diagnoseFunctionPartition,
  functionIndexAt,
} from '../wordcode/partition-functions.js'
import { LABEL_WORD_OFFSETS } from '../wordcode/wordcode-operands.js'
import { observeFunction } from './cff-state-loop.js'

// A refusal names the record builder that refused CFF's rewritten words (`refusedBy`, null when
// the refusal is CFF's own shape check).
const {
  decline: refuse,
  unwrap,
  accepted,
  refused,
} = declines('cff', {
  refusedBy: null,
})

function decline(message) {
  refuse('cff-shape', message)
}

// A record builder (readWordcode through partitionFunctions) refusing the rewritten words is that
// builder's refusal, not CFF's.
function requireResult(diagnosis, refusedBy) {
  return unwrap(diagnosis, { refusedBy })
}

// A function with a state loop as its root, then each kept body in the planned order; any other
// function as it is.
function orderInstructions(functions, plans, byPc) {
  const planByRoot = new Map(plans.map((plan) => [plan.root, plan]))
  const ordered = []
  for (const fn of functions.functions) {
    const plan = planByRoot.get(fn.startPc)
    if (!plan) {
      for (const pc of fn.instructionPcs) ordered.push(byPc.get(pc))
      continue
    }
    ordered.push(byPc.get(plan.root))
    for (const start of plan.orderedStarts)
      if (!plan.fakeStarts.has(start))
        ordered.push(...bodyInstructions(fn, plan, start, byPc))
  }
  return ordered
}

function bodyInstructions(fn, plan, start, byPc) {
  const range = plan.blockRanges.find((item) => item.start === start)
  return fn.instructionPcs
    .filter((pc) => pc >= range.start && pc < range.end)
    .map((pc) => byPc.get(pc))
}

// The written parts at their new PCs and each old PC's new one (`pcMap`): a replaced instruction
// writes its replacement, a removed one nothing, any other itself.
function rewriteParts(ordered, plans, opcodes) {
  const replacements = new Map(plans.flatMap((plan) => [...plan.replacements]))
  const removed = new Set(plans.flatMap((plan) => [...plan.removed]))
  const parts = []
  const pcMap = new Map()
  let nextPc = 0
  for (const instruction of ordered) {
    pcMap.set(instruction.pc, nextPc)
    const written = writtenParts(
      instruction,
      replacements.get(instruction.pc),
      removed,
      opcodes,
    )
    for (const { name, words, width } of written) {
      parts.push({ pc: nextPc, originPc: instruction.pc, name, words })
      nextPc += width
    }
  }
  return { parts, pcMap, nextPc }
}

// What one instruction writes: its replacement under the stream's opcodes, nothing when it is
// removed, otherwise itself.
function writtenParts(instruction, replacement, removed, opcodes) {
  if (replacement)
    return replacement.map(({ name, words }) => ({
      name,
      words: [opcodes[name], ...words.slice(1)],
      width: words.length,
    }))
  if (removed.has(instruction.pc)) return []
  return [
    {
      name: instruction.name,
      words: instruction.words.slice(),
      width: instruction.width,
    },
  ]
}

function remapTarget(pcMap, target) {
  if (!pcMap.has(target))
    decline(`Target ${target} is not an instruction boundary`)
  return pcMap.get(target)
}

// The parts' words, every label and each continuation load's target at its new PC.
function remapWords(parts, pcMap, functions) {
  const continuationLoads = selectContinuationLoads(
    parts.map((part) => ({
      key: part.pc,
      functionId: functionIndexAt(functions, part.originPc),
      name: part.name,
      words: part.words,
    })),
  )
  return parts.flatMap((part) => {
    const raw = part.words.slice()
    for (const offset of LABEL_WORD_OFFSETS[part.name] ?? [])
      raw[offset] = remapTarget(pcMap, raw[offset])
    if (continuationLoads.has(part.pc)) raw[2] = remapTarget(pcMap, raw[2])
    return raw
  })
}

// The normalized container's records, read again; a builder refusing them is that builder's
// refusal.
function rereadRecords(normalized, functions, pcMap) {
  const wordcode = requireResult(diagnoseWordcode(normalized), 'read-wordcode')
  const references = requireResult(
    diagnoseReferences(normalized, wordcode),
    'validate-references',
  )
  const sharedParentSuspects = new Set(
    functions.sharedParentStarts.map((pc) => remapTarget(pcMap, pc)),
  )
  const nextFunctions = requireResult(
    diagnoseFunctionPartition(normalized, wordcode, references, {
      sharedParentSuspects,
    }),
    'partition-functions',
  )
  return { wordcode, references, functions: nextFunctions }
}

function recognize(container, wordcode, functions) {
  const pool = container.roles.pool.values
  const plans = functions.functions
    .map((fn) => observeFunction(fn, wordcode, pool))
    .filter(Boolean)
  if (!plans.length)
    refuse('cff-absent', 'No pinned flattening state loop found')
  const byPc = new Map(wordcode.instructions.map((item) => [item.pc, item]))
  const { parts, pcMap, nextPc } = rewriteParts(
    orderInstructions(functions, plans, byPc),
    plans,
    container.roles.op.values,
  )
  pcMap.set(wordcode.wordCount, nextPc)
  const words = remapWords(parts, pcMap, functions)
  if (words.length !== nextPc) decline('Normalized stream width changed')
  const normalized = structuredClone(container)
  normalized.roles.words.values = words
  const records = rereadRecords(normalized, functions, pcMap)
  return {
    schemaVersion: 'jsconfuser-vm-cff-normalization.v1',
    container: normalized,
    wordcode: records.wordcode,
    references: records.references,
    functions: records.functions,
    pcMap,
    functionCount: plans.length,
    originalWordCount: wordcode.wordCount,
    normalizedWordCount: words.length,
  }
}

export function diagnoseNormalizeCffWordcode(container, wordcode, functions) {
  try {
    return accepted(recognize(container, wordcode, functions), {
      fallback: 'cff-normalization-error',
    })
  } catch (error) {
    return refused(error, {
      fallback: 'cff-normalization-error',
    })
  }
}
