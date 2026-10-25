import { selectContinuationLoads } from './finally-continuations.js'
import { diagnoseWordcode } from './read-wordcode.js'
import { diagnoseReferences } from './validate-references.js'
import { diagnoseFunctionPartition } from './partition-functions.js'

class CffDecline extends Error {
  constructor(code, message, refusedBy = null) {
    super(message)
    this.code = code
    this.refusedBy = refusedBy
  }
}

function decline(message) {
  throw new CffDecline('cff-shape', message)
}

// A record builder (readWordcode through partitionFunctions) refusing the rewritten words is that
// builder's refusal, not CFF's.
function requireResult(diagnosis, refusedBy) {
  if (!diagnosis.ok) {
    throw new CffDecline(
      diagnosis.diagnostic.code,
      diagnosis.diagnostic.message,
      refusedBy,
    )
  }
  return diagnosis.result
}

const TARGET_OFFSETS = Object.freeze({
  JUMP: [1],
  JUMP_IF_FALSE: [2],
  JUMP_IF_TRUE: [2],
  FOR_IN_NEXT: [3],
  TRY_SETUP: [1],
  FINALLY_SETUP: [1, 4],
  MAKE_CLOSURE: [2],
})

function numericConstant(instruction, pool) {
  if (
    instruction?.name !== 'LOAD_CONST' ||
    instruction.words[3] !== 0 ||
    typeof pool[instruction.words[2]] !== 'number' ||
    !Number.isInteger(pool[instruction.words[2]]) ||
    pool[instruction.words[2]] < 0 ||
    pool[instruction.words[2]] > 65535
  )
    return null
  return pool[instruction.words[2]]
}

// Reads one function's state loop. The prefix alone is spelling: every non-arrow function
// opens with LOAD_THIS, as the state-loop template does, and a plain loop on two fresh locals
// continues it. A function is CFF only once its whole loop reads (arms, back edge, initial state,
// adjacent exit, body targets); until then any mismatch returns null and the function carries
// through. After that, a refusal is CFF's and declines the whole adapter.
function observeFunction(fn, wordcode, pool) {
  const byPc = new Map(wordcode.instructions.map((item) => [item.pc, item]))
  const ins = fn.instructionPcs.map((pc) => byPc.get(pc))
  if (
    ins.length < 18 ||
    ins[0].name !== 'LOAD_THIS' ||
    ins[1]?.name !== 'LOAD_CONST' ||
    ins[2]?.name !== 'MOVE' ||
    ins[3]?.name !== 'LOAD_CONST' ||
    ins[4]?.name !== 'MOVE' ||
    ins[5]?.name !== 'LOAD_CONST' ||
    ins[6]?.name !== 'NEQ' ||
    ins[7]?.name !== 'JUMP_IF_FALSE'
  )
    return null
  const startState = numericConstant(ins[1], pool)
  const state = ins[2]?.words[1]
  if (
    startState === null ||
    ins[2]?.name !== 'MOVE' ||
    ins[2].words[2] !== ins[1].words[1]
  )
    return null
  if (
    numericConstant(ins[3], pool) !== 0 ||
    ins[4]?.name !== 'MOVE' ||
    ins[4].words[2] !== ins[3].words[1]
  )
    return null
  const accumulator = ins[4].words[1]
  const loopTop = ins[5].pc
  const endState = numericConstant(ins[5], pool)
  if (
    endState === null ||
    ins[6]?.name !== 'NEQ' ||
    ins[6].words[2] !== state ||
    ins[6].words[3] !== ins[5].words[1] ||
    ins[7]?.name !== 'JUMP_IF_FALSE' ||
    ins[7].words[1] !== ins[6].words[1]
  )
    return null
  const exitPc = ins[7].words[2]
  const stateTargets = new Map([[endState, exitPc]])
  let index = 8
  let previous = null
  while (index < ins.length) {
    if (ins[index].name === 'JUMP' && ins[index].words[1] === loopTop) {
      index += 1
      break
    }
    const load = ins[index]
    let current
    if (previous === null) {
      current = numericConstant(load, pool)
      if (
        current === null ||
        ins[index + 1]?.name !== 'MOVE' ||
        ins[index + 1].words[1] !== accumulator ||
        ins[index + 1].words[2] !== load.words[1]
      )
        return null
    } else {
      const delta = numericConstant(load, pool)
      const arithmetic = ins[index + 1]
      if (
        delta === null ||
        !['ADD', 'SUB'].includes(arithmetic?.name) ||
        arithmetic.words[2] !== accumulator ||
        arithmetic.words[3] !== load.words[1] ||
        ins[index + 2]?.name !== 'MOVE' ||
        ins[index + 2].words[1] !== accumulator ||
        ins[index + 2].words[2] !== arithmetic.words[1]
      )
        return null
      current = previous + (arithmetic.name === 'ADD' ? delta : -delta)
    }
    const offset = previous === null ? 2 : 3
    const compare = ins[index + offset]
    const skip = ins[index + offset + 1]
    const jump = ins[index + offset + 2]
    if (
      compare?.name !== 'EQ' ||
      compare.words[2] !== state ||
      compare.words[3] !== accumulator ||
      skip?.name !== 'JUMP_IF_FALSE' ||
      skip.words[1] !== compare.words[1] ||
      skip.words[2] !== jump?.nextPc ||
      jump?.name !== 'JUMP' ||
      stateTargets.has(current)
    )
      return null
    stateTargets.set(current, jump.words[1])
    previous = current
    index += offset + 3
  }
  if (index < 13 || ins[index - 1]?.name !== 'JUMP') return null
  if (!stateTargets.has(startState)) return null
  if (ins[index]?.pc !== exitPc) return null
  const starts = [...new Set(stateTargets.values())].sort((a, b) => a - b)
  if (
    starts[0] !== exitPc ||
    starts.some((pc) => pc < exitPc || pc >= fn.endPc || !byPc.has(pc))
  )
    return null
  const stateByTarget = new Map()
  for (const [value, target] of stateTargets) {
    if (value !== endState) stateByTarget.set(target, value)
  }
  const replacements = new Map()
  const removed = new Set(ins.slice(0, index).map((item) => item.pc))
  const blockSuccessors = new Map()
  const blockHandlers = new Map()
  const fakeForms = new Set()
  const root = ins[0].pc
  replacements.set(root, [])

  function transition(sequence, at, currentState) {
    const load = sequence[at]
    const arithmetic = sequence[at + 1]
    const jump = sequence[at + 2]
    if (
      load?.name !== 'LOAD_INT' ||
      !['ADD', 'SUB'].includes(arithmetic?.name) ||
      arithmetic.words[1] !== state ||
      arithmetic.words[2] !== state ||
      arithmetic.words[3] !== load.words[1] ||
      jump?.name !== 'JUMP' ||
      jump.words[1] !== loopTop
    )
      return null
    const nextState =
      currentState +
      (arithmetic.name === 'ADD' ? load.words[2] : -load.words[2])
    const target = stateTargets.get(nextState)
    if (target === undefined)
      decline(`Relative transition reaches unknown state ${nextState}`)
    return target
  }

  // The encoder's two fake bodies: one transition, or a fork on `state < k` between two.
  function fakeForm(segment, currentState) {
    if (segment.length === 3)
      return transition(segment, 0, currentState) !== null
    const [load, less, branch] = segment
    const scratch = load?.words[1]
    return (
      segment.length === 9 &&
      load.name === 'LOAD_INT' &&
      less.name === 'LT' &&
      less.words[1] === scratch &&
      less.words[2] === state &&
      less.words[3] === scratch &&
      branch.name === 'JUMP_IF_TRUE' &&
      branch.words[1] === scratch &&
      branch.words[2] === segment[6].pc &&
      transition(segment, 3, currentState) !== null &&
      transition(segment, 6, currentState) !== null
    )
  }

  for (let blockIndex = 0; blockIndex < starts.length; blockIndex += 1) {
    const start = starts[blockIndex]
    const end = starts[blockIndex + 1] ?? fn.endPc
    const segment = ins.filter((item) => item.pc >= start && item.pc < end)
    const currentState = stateByTarget.get(start)
    if (currentState !== undefined && fakeForm(segment, currentState))
      fakeForms.add(start)
    const successors = []
    const handlers = []
    let cursor = 0
    if (
      currentState !== undefined &&
      segment[0]?.name === 'LOAD_INT' &&
      segment[0].words[1] === state &&
      segment[0].words[2] === currentState
    ) {
      removed.add(segment[0].pc)
      cursor = 1
    }
    while (cursor < segment.length) {
      const item = segment[cursor]
      const direct =
        currentState === undefined
          ? null
          : transition(segment, cursor, currentState)
      if (direct !== null) {
        successors.push(direct)
        replacements.set(item.pc, [{ name: 'JUMP', words: [null, direct] }])
        removed.add(segment[cursor + 1].pc)
        removed.add(segment[cursor + 2].pc)
        cursor += 3
        continue
      }
      if (
        ['JUMP_IF_FALSE', 'JUMP_IF_TRUE'].includes(item.name) &&
        currentState !== undefined
      ) {
        const first = transition(segment, cursor + 1, currentState)
        const second = transition(segment, cursor + 4, currentState)
        if (
          first !== null &&
          second !== null &&
          item.words[2] === segment[cursor + 4]?.pc
        ) {
          successors.push(second, first)
          replacements.set(item.pc, [
            { name: item.name, words: [null, item.words[1], second] },
            { name: 'JUMP', words: [null, first] },
          ])
          for (let offset = 1; offset <= 6; offset += 1)
            removed.add(segment[cursor + offset].pc)
          cursor += 7
          continue
        }
      }
      if (item.name === 'TRY_SETUP' || item.name === 'FINALLY_SETUP')
        handlers.push(item.words[1])
      if (item.name === 'FOR_IN_NEXT') handlers.push(item.words[3])
      cursor += 1
    }
    blockSuccessors.set(start, successors)
    blockHandlers.set(start, handlers)
  }
  // A fake block has a fresh state no real transition targets, but fakes draw their own targets
  // from every state, fakes included. So of the bodies in a fake form, the fakes are the largest
  // set that no transition or handler entry outside it targets. Whether code runs never decides:
  // a dead source body targets like any other, and everything else stays for the backend.
  const entry = stateTargets.get(startState)
  const fakeStarts = new Set([...fakeForms].filter((start) => start !== entry))
  for (let changed = true; changed; ) {
    changed = false
    const targeted = new Set(
      starts
        .filter((start) => !fakeStarts.has(start))
        .flatMap((start) => [
          ...blockSuccessors.get(start),
          ...blockHandlers.get(start),
        ]),
    )
    for (const start of fakeStarts)
      if (targeted.has(start)) {
        fakeStarts.delete(start)
        changed = true
      }
  }
  const erasedRegisters = new Set(
    ins
      .filter(
        (item) =>
          (removed.has(item.pc) || replacements.has(item.pc)) &&
          [
            'LOAD_THIS',
            'LOAD_CONST',
            'LOAD_INT',
            'MOVE',
            'ADD',
            'SUB',
            'EQ',
            'NEQ',
          ].includes(item.name),
      )
      .map((item) => item.words[1]),
  )
  for (const start of starts) {
    // A fake block is removed whole, so its reads of the state register erase nothing.
    if (fakeStarts.has(start)) continue
    const end = starts[starts.indexOf(start) + 1] ?? fn.endPc
    for (const item of ins.filter(
      (item) => item.pc >= start && item.pc < end,
    )) {
      if (replacements.has(item.pc)) {
        if (
          replacements
            .get(item.pc)
            .some(
              (replacement) =>
                ['JUMP_IF_FALSE', 'JUMP_IF_TRUE'].includes(replacement.name) &&
                erasedRegisters.has(replacement.words[1]),
            )
        )
          decline('Condition uses an erased state-loop register')
        continue
      }
      if (removed.has(item.pc)) continue
      if (
        item.operands.some(
          (operand) =>
            operand.kind === 'register' && erasedRegisters.has(operand.index),
        ) ||
        item.captures?.some(
          (capture) =>
            capture.kind === 'local' && erasedRegisters.has(capture.index),
        )
      )
        decline(`State-loop register escapes into payload at ${item.pc}`)
    }
  }
  // The encoder rewrites a conditional to jump over the transition to its own fallthrough, so a
  // rewritten conditional's first successor is the block the compiler placed right after it. A
  // fake fork proves nothing, and a block two conditionals claim keeps no proved place. That is
  // the only order the stream proves: every other transition stays a jump, and the blocks keep
  // the stream's order, so structure is read from the graph, never from the layout.
  const claims = new Map()
  for (const [start, successors] of blockSuccessors)
    if (successors.length === 2 && !fakeStarts.has(start))
      claims.set(successors[0], [...(claims.get(successors[0]) ?? []), start])
  const fallthroughOf = new Map(
    [...claims]
      .filter(([, owners]) => owners.length === 1)
      .map(([fallthrough, [owner]]) => [owner, fallthrough]),
  )
  const conditionalOf = new Map(
    [...fallthroughOf].map(([owner, fallthrough]) => [fallthrough, owner]),
  )
  const blockRanges = starts.map((start, index) => ({
    start,
    end: starts[index + 1] ?? fn.endPc,
  }))
  const orderedStarts = []
  const placed = new Set()
  // The root falls into the entry block; each placed block pulls its proved fallthrough after it.
  const place = (start) => {
    while (start !== undefined && !placed.has(start)) {
      placed.add(start)
      orderedStarts.push(start)
      start = fallthroughOf.get(start)
    }
  }
  place(entry)
  for (const start of starts)
    if (!conditionalOf.has(start) || start === entry) place(start)
  for (const start of starts) place(start)
  for (let order = 0; order < orderedStarts.length - 1; order += 1) {
    const start = orderedStarts[order]
    const next = orderedStarts[order + 1]
    if (fallthroughOf.get(start) !== next) continue
    const range = blockRanges.find((item) => item.start === start)
    const [terminalPc, terminal] =
      [...replacements]
        .filter(([pc]) => pc >= range.start && pc < range.end)
        .at(-1) ?? []
    if (terminal?.length !== 2) continue
    const [conditional, jump] = terminal
    replacements.set(terminalPc, [
      {
        name:
          conditional.name === 'JUMP_IF_TRUE'
            ? 'JUMP_IF_FALSE'
            : 'JUMP_IF_TRUE',
        words: [null, conditional.words[1], jump.words[1]],
      },
    ])
  }
  return {
    root,
    replacements,
    removed,
    orderedStarts,
    blockRanges,
    fakeStarts,
    fn,
  }
}

function recognize(container, wordcode, functions) {
  const pool = container.roles.pool.values
  const plans = functions.functions
    .map((fn) => observeFunction(fn, wordcode, pool))
    .filter(Boolean)
  if (!plans.length)
    throw new CffDecline('cff-absent', 'No pinned flattening state loop found')
  const replacements = new Map(plans.flatMap((plan) => [...plan.replacements]))
  const removed = new Set(plans.flatMap((plan) => [...plan.removed]))
  const planByRoot = new Map(plans.map((plan) => [plan.root, plan]))
  const byPc = new Map(wordcode.instructions.map((item) => [item.pc, item]))
  const orderedInstructions = []
  for (const fn of functions.functions) {
    const plan = planByRoot.get(fn.startPc)
    if (!plan) {
      for (const pc of fn.instructionPcs) orderedInstructions.push(byPc.get(pc))
      continue
    }
    orderedInstructions.push(byPc.get(plan.root))
    for (const start of plan.orderedStarts) {
      if (plan.fakeStarts.has(start)) continue
      const range = plan.blockRanges.find((item) => item.start === start)
      for (const pc of fn.instructionPcs) {
        if (pc >= range.start && pc < range.end)
          orderedInstructions.push(byPc.get(pc))
      }
    }
  }
  const parts = []
  const pcMap = new Map()
  let nextPc = 0
  for (const instruction of orderedInstructions) {
    const replacement = replacements.get(instruction.pc)
    if (replacement) {
      pcMap.set(instruction.pc, nextPc)
      for (const item of replacement) {
        const words = item.words.slice()
        words[0] = container.roles.op.values[item.name]
        parts.push({
          pc: nextPc,
          originPc: instruction.pc,
          name: item.name,
          words,
        })
        nextPc += words.length
      }
    } else if (removed.has(instruction.pc)) {
      pcMap.set(instruction.pc, nextPc)
    } else {
      pcMap.set(instruction.pc, nextPc)
      parts.push({
        pc: nextPc,
        originPc: instruction.pc,
        name: instruction.name,
        words: instruction.words.slice(),
      })
      nextPc += instruction.width
    }
  }
  pcMap.set(wordcode.wordCount, nextPc)
  const remap = (target) => {
    if (!pcMap.has(target))
      decline(`Target ${target} is not an instruction boundary`)
    return pcMap.get(target)
  }
  const continuationLoads = selectContinuationLoads(
    parts.map((part) => ({
      key: part.pc,
      functionId: functions.functions.findIndex(
        (fn) => part.originPc >= fn.startPc && part.originPc < fn.endPc,
      ),
      name: part.name,
      words: part.words,
    })),
  )
  const words = parts.flatMap((part) => {
    const raw = part.words.slice()
    for (const offset of TARGET_OFFSETS[part.name] ?? [])
      raw[offset] = remap(raw[offset])
    if (continuationLoads.has(part.pc)) raw[2] = remap(raw[2])
    return raw
  })
  if (words.length !== nextPc) decline('Normalized stream width changed')
  const normalized = structuredClone(container)
  normalized.roles.words.values = words
  const nextWordcode = requireResult(
    diagnoseWordcode(normalized),
    'read-wordcode',
  )
  const references = requireResult(
    diagnoseReferences(normalized, nextWordcode),
    'validate-references',
  )
  const nextFunctions = requireResult(
    diagnoseFunctionPartition(normalized, nextWordcode, references, {
      sharedParentSuspects: new Set(functions.sharedParentStarts.map(remap)),
    }),
    'partition-functions',
  )
  return {
    schemaVersion: 'jsconfuser-vm-cff-normalization.v1',
    container: normalized,
    wordcode: nextWordcode,
    references,
    functions: nextFunctions,
    pcMap,
    functionCount: plans.length,
    originalWordCount: wordcode.wordCount,
    normalizedWordCount: words.length,
  }
}

export function diagnoseNormalizeCffWordcode(container, wordcode, functions) {
  try {
    return {
      ok: true,
      result: recognize(container, wordcode, functions),
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof CffDecline ? error.code : 'cff-normalization-error',
        message: error instanceof Error ? error.message : String(error),
        refusedBy: error instanceof CffDecline ? error.refusedBy : null,
      },
    }
  }
}
