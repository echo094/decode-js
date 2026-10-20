import { selectContinuationLoads } from './finally-continuations.js'
import { diagnoseWordcode } from './read-wordcode.js'
import { diagnoseReferences } from './validate-references.js'
import { diagnoseFunctionPartition } from './partition-functions.js'
import { diagnoseControlFlow } from './build-cfg.js'
import { composePcMaps } from './expand-observed-word-stream.js'

class CffDecline extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function decline(message) {
  throw new CffDecline('cff-shape', message)
}

function requireResult(diagnosis) {
  if (!diagnosis.ok) {
    throw new CffDecline(
      diagnosis.diagnostic.code,
      diagnosis.diagnostic.message,
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
  ) {
    decline('Dispatch constant is not a plain integer')
  }
  return pool[instruction.words[2]]
}

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
  if (ins[2]?.name !== 'MOVE' || ins[2].words[2] !== ins[1].words[1])
    decline('Dispatch state initialization changed')
  if (
    numericConstant(ins[3], pool) !== 0 ||
    ins[4]?.name !== 'MOVE' ||
    ins[4].words[2] !== ins[3].words[1]
  )
    decline('Dispatch accumulator initialization changed')
  const accumulator = ins[4].words[1]
  const loopTop = ins[5].pc
  const endState = numericConstant(ins[5], pool)
  if (
    ins[6]?.name !== 'NEQ' ||
    ins[6].words[2] !== state ||
    ins[6].words[3] !== ins[5].words[1] ||
    ins[7]?.name !== 'JUMP_IF_FALSE' ||
    ins[7].words[1] !== ins[6].words[1]
  )
    decline('Dispatch loop guard changed')
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
        ins[index + 1]?.name !== 'MOVE' ||
        ins[index + 1].words[1] !== accumulator ||
        ins[index + 1].words[2] !== load.words[1]
      )
        decline('Dispatch first arm changed')
    } else {
      const delta = numericConstant(load, pool)
      const arithmetic = ins[index + 1]
      if (
        !['ADD', 'SUB'].includes(arithmetic?.name) ||
        arithmetic.words[2] !== accumulator ||
        arithmetic.words[3] !== load.words[1] ||
        ins[index + 2]?.name !== 'MOVE' ||
        ins[index + 2].words[1] !== accumulator ||
        ins[index + 2].words[2] !== arithmetic.words[1]
      )
        decline('Dispatch relative arm changed')
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
      decline('Dispatch comparison arm changed')
    stateTargets.set(current, jump.words[1])
    previous = current
    index += offset + 3
  }
  if (index < 13 || ins[index - 1]?.name !== 'JUMP')
    decline('Dispatch loop has no back edge')
  if (!stateTargets.has(startState))
    decline('Initial state is absent from dispatch')
  const dispatchEnd = ins[index]?.pc
  if (dispatchEnd !== exitPc)
    decline('Dispatch exit is not adjacent to its body blocks')
  const starts = [...new Set(stateTargets.values())].sort((a, b) => a - b)
  if (
    starts[0] !== exitPc ||
    starts.some((pc) => pc < exitPc || pc >= fn.endPc || !byPc.has(pc))
  )
    decline('Dispatch targets are not body boundaries')
  const stateByTarget = new Map()
  for (const [value, target] of stateTargets) {
    if (value !== endState) stateByTarget.set(target, value)
  }
  const replacements = new Map()
  const removed = new Set(ins.slice(0, index).map((item) => item.pc))
  const blockSuccessors = new Map()
  const blockHandlers = new Map()
  const stateDependentStarts = []
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

  for (let blockIndex = 0; blockIndex < starts.length; blockIndex += 1) {
    const start = starts[blockIndex]
    const end = starts[blockIndex + 1] ?? fn.endPc
    const segment = ins.filter((item) => item.pc >= start && item.pc < end)
    if (segment.some((item) => item.name === 'LT' && item.words[2] === state))
      stateDependentStarts.push(start)
    const currentState = stateByTarget.get(start)
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
    // State-dependent fake arms are retained until reachability proves them dead.
    if (stateDependentStarts.includes(start)) continue
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
          decline('Dispatch condition uses erased state')
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
        decline(`Dispatch register escapes into payload at ${item.pc}`)
    }
  }
  // The encoder rewrites a conditional to jump over the transition to its own fallthrough, so a
  // rewritten conditional's first successor is the block the compiler placed right after it. A
  // fake fork proves nothing, and a block two conditionals claim keeps no proved place. That is
  // the only order the stream proves: every other transition stays a jump, and the blocks keep
  // the stream's order, so structure is read from the graph, never from the layout.
  const claims = new Map()
  for (const [start, successors] of blockSuccessors)
    if (successors.length === 2 && !stateDependentStarts.includes(start))
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
  const entry = stateTargets.get(startState)
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
    stateDependentStarts,
    fn,
  }
}

function recognize(container, wordcode, functions, partitionOptions) {
  const pool = container.roles.pool.values
  const plans = functions.functions
    .map((fn) => observeFunction(fn, wordcode, pool))
    .filter(Boolean)
  if (!plans.length) decline('No pinned flattening dispatch loop found')
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
  const nextWordcode = requireResult(diagnoseWordcode(normalized))
  const references = requireResult(diagnoseReferences(normalized, nextWordcode))
  const nextPartitionOptions = partitionOptions && {
    allowSharedParentStarts: new Set(
      [...partitionOptions.allowSharedParentStarts].map(remap),
    ),
  }
  const nextFunctions = requireResult(
    diagnoseFunctionPartition(
      normalized,
      nextWordcode,
      references,
      nextPartitionOptions,
    ),
  )
  const cfg = requireResult(
    diagnoseControlFlow(nextWordcode, references, nextFunctions),
  )
  const livePcs = new Set(
    cfg.edges.flatMap((edge) =>
      edge.targetPc === null ? [edge.sourcePc] : [edge.sourcePc, edge.targetPc],
    ),
  )
  for (const plan of plans) {
    if (plan.stateDependentStarts.some((pc) => livePcs.has(remap(pc))))
      decline('A fake state-dependent block became reachable')
  }
  const transformedStarts = new Set(plans.map((plan) => remap(plan.root)))
  const reachable = new Set()
  for (const fn of cfg.functions) {
    if (!transformedStarts.has(fn.startPc)) {
      for (const pc of fn.instructionPcs) reachable.add(pc)
      continue
    }
    reachable.add(fn.startPc)
    for (const edge of fn.edges) {
      reachable.add(edge.sourcePc)
      if (edge.targetPc !== null) reachable.add(edge.targetPc)
    }
  }
  const compactMap = new Map()
  const compactParts = []
  let compactPc = 0
  for (const instruction of nextWordcode.instructions) {
    if (!reachable.has(instruction.pc)) continue
    compactMap.set(instruction.pc, compactPc)
    compactParts.push({
      pc: instruction.pc,
      name: instruction.name,
      words: instruction.words.slice(),
    })
    compactPc += instruction.width
  }
  compactMap.set(nextWordcode.wordCount, compactPc)
  const compactRemap = (target, part) => {
    if (!compactMap.has(target))
      decline(`${part.name}@${part.pc} targets removed PC ${target}`)
    return compactMap.get(target)
  }
  const compactContinuations = selectContinuationLoads(
    compactParts.map((part) => ({
      key: part.pc,
      functionId: nextFunctions.functions.findIndex(
        (fn) => part.pc >= fn.startPc && part.pc < fn.endPc,
      ),
      name: part.name,
      words: part.words,
    })),
  )
  const compactWords = compactParts.flatMap((part) => {
    const raw = part.words.slice()
    for (const offset of TARGET_OFFSETS[part.name] ?? [])
      raw[offset] = compactRemap(raw[offset], part)
    if (compactContinuations.has(part.pc)) raw[2] = compactRemap(raw[2], part)
    return raw
  })
  normalized.roles.words.values = compactWords
  const compactWordcode = requireResult(diagnoseWordcode(normalized))
  const compactReferences = requireResult(
    diagnoseReferences(normalized, compactWordcode),
  )
  const compactPartitionOptions = nextPartitionOptions && {
    allowSharedParentStarts: new Set(
      [...nextPartitionOptions.allowSharedParentStarts].map((pc) =>
        compactRemap(pc, { name: 'MAKE_CLOSURE', pc }),
      ),
    ),
  }
  const compactFunctions = requireResult(
    diagnoseFunctionPartition(
      normalized,
      compactWordcode,
      compactReferences,
      compactPartitionOptions,
    ),
  )
  const compactCfg = requireResult(
    diagnoseControlFlow(compactWordcode, compactReferences, compactFunctions),
  )
  return {
    schemaVersion: 'jsconfuser-vm-cff-normalization.v1',
    container: normalized,
    wordcode: compactWordcode,
    references: compactReferences,
    functions: compactFunctions,
    cfg: compactCfg,
    pcMap: composePcMaps(pcMap, compactMap),
    functionCount: plans.length,
    originalWordCount: wordcode.wordCount,
    normalizedWordCount: compactWords.length,
  }
}

export function diagnoseNormalizeCffWordcode(
  container,
  wordcode,
  functions,
  partitionOptions,
) {
  try {
    return {
      ok: true,
      result: recognize(container, wordcode, functions, partitionOptions),
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
      },
    }
  }
}
