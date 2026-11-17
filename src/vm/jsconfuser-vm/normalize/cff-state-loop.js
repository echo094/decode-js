import { declines } from '../../decline.js'

// CFF's own shape refusal; `refusedBy` is null, as no record builder refused.
const { decline: refuse } = declines('cff', { refusedBy: null })

function decline(message) {
  refuse('cff-shape', message)
}

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

// The state-loop template's opening: `this`, `state = start`, `acc = 0`, `top: if (state != end)`.
const STATE_LOOP_PREFIX = [
  'LOAD_THIS',
  'LOAD_CONST',
  'MOVE',
  'LOAD_CONST',
  'MOVE',
  'LOAD_CONST',
  'NEQ',
  'JUMP_IF_FALSE',
]

// The operations whose written register a removed or replaced state-loop instruction erases.
const STATE_LOOP_WRITERS = new Set([
  'LOAD_THIS',
  'LOAD_CONST',
  'LOAD_INT',
  'MOVE',
  'ADD',
  'SUB',
  'EQ',
  'NEQ',
])

// The loop header: `state = start; acc = 0; top: if (state != end)`, exiting to `exitPc`.
function readLoopHeader(ins, pool) {
  if (
    ins.length < 18 ||
    STATE_LOOP_PREFIX.some((name, index) => ins[index].name !== name)
  )
    return null
  const startState = numericConstant(ins[1], pool)
  const state = ins[2].words[1]
  if (startState === null || ins[2].words[2] !== ins[1].words[1]) return null
  if (
    numericConstant(ins[3], pool) !== 0 ||
    ins[4].words[2] !== ins[3].words[1]
  )
    return null
  const endState = numericConstant(ins[5], pool)
  if (
    endState === null ||
    ins[6].words[2] !== state ||
    ins[6].words[3] !== ins[5].words[1] ||
    ins[7].words[1] !== ins[6].words[1]
  )
    return null
  return {
    startState,
    state,
    accumulator: ins[4].words[1],
    loopTop: ins[5].pc,
    endState,
    exitPc: ins[7].words[2],
  }
}

// One dispatch test's state value: the first is loaded into the accumulator, each later one adds
// or subtracts a delta from the one before. `width` is the instructions it takes.
function dispatchValue(ins, index, previous, accumulator, pool) {
  const load = ins[index]
  if (previous === null) {
    const current = numericConstant(load, pool)
    const move = ins[index + 1]
    return current !== null &&
      move?.name === 'MOVE' &&
      move.words[1] === accumulator &&
      move.words[2] === load.words[1]
      ? { current, width: 2 }
      : null
  }
  const delta = numericConstant(load, pool)
  const arithmetic = ins[index + 1]
  const move = ins[index + 2]
  if (
    delta === null ||
    !['ADD', 'SUB'].includes(arithmetic?.name) ||
    arithmetic.words[2] !== accumulator ||
    arithmetic.words[3] !== load.words[1] ||
    move?.name !== 'MOVE' ||
    move.words[1] !== accumulator ||
    move.words[2] !== arithmetic.words[1]
  )
    return null
  return {
    current: previous + (arithmetic.name === 'ADD' ? delta : -delta),
    width: 3,
  }
}

// The dispatch tests after the header, up to the jump back to its top: each `if (state === acc)`
// jumps to its state's body. `index` is the first instruction after them.
function readDispatchTests(ins, header, pool) {
  const { state, accumulator, loopTop, endState, exitPc } = header
  const stateTargets = new Map([[endState, exitPc]])
  let index = 8
  let previous = null
  while (index < ins.length) {
    if (ins[index].name === 'JUMP' && ins[index].words[1] === loopTop)
      return { stateTargets, index: index + 1 }
    const value = dispatchValue(ins, index, previous, accumulator, pool)
    if (!value) return null
    const [compare, skip, jump] = ins.slice(
      index + value.width,
      index + value.width + 3,
    )
    if (
      compare?.name !== 'EQ' ||
      compare.words[2] !== state ||
      compare.words[3] !== accumulator ||
      skip?.name !== 'JUMP_IF_FALSE' ||
      skip.words[1] !== compare.words[1] ||
      skip.words[2] !== jump?.nextPc ||
      jump?.name !== 'JUMP' ||
      stateTargets.has(value.current)
    )
      return null
    stateTargets.set(value.current, jump.words[1])
    previous = value.current
    index += value.width + 3
  }
  return { stateTargets, index }
}

// Reads one function's state loop. The prefix alone is spelling: every non-arrow function
// opens with LOAD_THIS, as the state-loop template does, and a plain loop on two fresh locals
// continues it. A function is CFF only once its whole loop reads (arms, back edge, initial state,
// adjacent exit, body targets); until then any mismatch returns null and the function carries
// through. After that, a refusal is CFF's and declines the whole adapter.
export function observeFunction(fn, wordcode, pool) {
  const byPc = new Map(wordcode.instructions.map((item) => [item.pc, item]))
  const ins = fn.instructionPcs.map((pc) => byPc.get(pc))
  const header = readLoopHeader(ins, pool)
  if (!header) return null
  const tests = readDispatchTests(ins, header, pool)
  if (!tests) return null
  const { stateTargets, index } = tests
  if (index < 13 || ins[index - 1]?.name !== 'JUMP') return null
  if (!stateTargets.has(header.startState)) return null
  if (ins[index]?.pc !== header.exitPc) return null
  const starts = [...new Set(stateTargets.values())].sort((a, b) => a - b)
  if (
    starts[0] !== header.exitPc ||
    starts.some((pc) => pc < header.exitPc || pc >= fn.endPc || !byPc.has(pc))
  )
    return null
  return new StateLoop(fn, ins, {
    header,
    stateTargets,
    starts,
    headerEnd: index,
  }).observe()
}

/**
 * A function's state loop once read: its bodies (`starts`, each to the next start), the state
 * each body runs under, and the rewrite that restores direct jumps. `replacements` (PC -> the
 * instructions written there) is filled in stream order, root first; `removed` holds the loop's
 * own instructions and each transition's.
 */
class StateLoop {
  // `loop`: the header read, its state targets, the body starts and the header's end index.
  constructor(fn, ins, { header, stateTargets, starts, headerEnd }) {
    Object.assign(this, { fn, ins, stateTargets, starts })
    this.state = header.state
    this.loopTop = header.loopTop
    this.entry = stateTargets.get(header.startState)
    this.stateByTarget = new Map()
    for (const [value, target] of stateTargets)
      if (value !== header.endState) this.stateByTarget.set(target, value)
    this.root = ins[0].pc
    this.replacements = new Map([[this.root, []]])
    this.removed = new Set(ins.slice(0, headerEnd).map((item) => item.pc))
    this.blockSuccessors = new Map()
    this.blockHandlers = new Map()
    this.fakeForms = new Set()
  }

  endOf(start) {
    return this.starts[this.starts.indexOf(start) + 1] ?? this.fn.endPc
  }

  segmentOf(start) {
    const end = this.endOf(start)
    return this.ins.filter((item) => item.pc >= start && item.pc < end)
  }

  // A transition `state += k; continue`: the body it reaches, or null when `sequence[at]` starts
  // none.
  transition(sequence, at, currentState) {
    const [load, arithmetic, jump] = sequence.slice(at, at + 3)
    if (
      load?.name !== 'LOAD_INT' ||
      !['ADD', 'SUB'].includes(arithmetic?.name) ||
      arithmetic.words[1] !== this.state ||
      arithmetic.words[2] !== this.state ||
      arithmetic.words[3] !== load.words[1] ||
      jump?.name !== 'JUMP' ||
      jump.words[1] !== this.loopTop
    )
      return null
    const nextState =
      currentState +
      (arithmetic.name === 'ADD' ? load.words[2] : -load.words[2])
    const target = this.stateTargets.get(nextState)
    if (target === undefined)
      decline(`Relative transition reaches unknown state ${nextState}`)
    return target
  }

  // The encoder's two fake bodies: one transition, or a fork on `state < k` between two.
  fakeForm(segment, currentState) {
    if (segment.length === 3)
      return this.transition(segment, 0, currentState) !== null
    const [load, less, branch] = segment
    const scratch = load?.words[1]
    return (
      segment.length === 9 &&
      load.name === 'LOAD_INT' &&
      less.name === 'LT' &&
      less.words[1] === scratch &&
      less.words[2] === this.state &&
      less.words[3] === scratch &&
      branch.name === 'JUMP_IF_TRUE' &&
      branch.words[1] === scratch &&
      branch.words[2] === segment[6].pc &&
      this.transition(segment, 3, currentState) !== null &&
      this.transition(segment, 6, currentState) !== null
    )
  }

  // A transition at `cursor` becomes a jump to its body; returns the instructions it took, or 0.
  rewriteDirect(segment, cursor, currentState, successors) {
    const direct = this.transition(segment, cursor, currentState)
    if (direct === null) return 0
    successors.push(direct)
    this.replacements.set(segment[cursor].pc, [
      { name: 'JUMP', words: [null, direct] },
    ])
    this.removed.add(segment[cursor + 1].pc)
    this.removed.add(segment[cursor + 2].pc)
    return 3
  }

  // A conditional over two transitions becomes the conditional to the second body and a jump to
  // the first; returns the instructions it took, or 0.
  rewriteConditional(segment, cursor, currentState, successors) {
    const item = segment[cursor]
    if (!['JUMP_IF_FALSE', 'JUMP_IF_TRUE'].includes(item.name)) return 0
    const first = this.transition(segment, cursor + 1, currentState)
    const second = this.transition(segment, cursor + 4, currentState)
    if (
      first === null ||
      second === null ||
      item.words[2] !== segment[cursor + 4]?.pc
    )
      return 0
    successors.push(second, first)
    this.replacements.set(item.pc, [
      { name: item.name, words: [null, item.words[1], second] },
      { name: 'JUMP', words: [null, first] },
    ])
    for (let offset = 1; offset <= 6; offset += 1)
      this.removed.add(segment[cursor + offset].pc)
    return 7
  }

  // One body: its state's own reload removed, its transitions rewritten, and the bodies it reaches
  // by transition or handler entry recorded.
  readBlock(start) {
    const segment = this.segmentOf(start)
    const currentState = this.stateByTarget.get(start)
    if (currentState !== undefined && this.fakeForm(segment, currentState))
      this.fakeForms.add(start)
    const successors = []
    const handlers = []
    let cursor = 0
    if (
      currentState !== undefined &&
      segment[0]?.name === 'LOAD_INT' &&
      segment[0].words[1] === this.state &&
      segment[0].words[2] === currentState
    ) {
      this.removed.add(segment[0].pc)
      cursor = 1
    }
    while (cursor < segment.length) {
      const taken =
        currentState === undefined
          ? 0
          : this.rewriteDirect(segment, cursor, currentState, successors) ||
            this.rewriteConditional(segment, cursor, currentState, successors)
      if (taken) {
        cursor += taken
        continue
      }
      const item = segment[cursor]
      if (item.name === 'TRY_SETUP' || item.name === 'FINALLY_SETUP')
        handlers.push(item.words[1])
      if (item.name === 'FOR_IN_NEXT') handlers.push(item.words[3])
      cursor += 1
    }
    this.blockSuccessors.set(start, successors)
    this.blockHandlers.set(start, handlers)
  }

  // A fake block has a fresh state no real transition targets, but fakes draw their own targets
  // from every state, fakes included. So of the bodies in a fake form, the fakes are the largest
  // set that no transition or handler entry outside it targets. Whether code runs never decides:
  // a dead source body targets like any other, and everything else stays for the backend.
  fakeStarts() {
    const fakeStarts = new Set(
      [...this.fakeForms].filter((start) => start !== this.entry),
    )
    for (let changed = true; changed; ) {
      changed = false
      const targeted = new Set(
        this.starts
          .filter((start) => !fakeStarts.has(start))
          .flatMap((start) => [
            ...this.blockSuccessors.get(start),
            ...this.blockHandlers.get(start),
          ]),
      )
      for (const start of fakeStarts)
        if (targeted.has(start)) {
          fakeStarts.delete(start)
          changed = true
        }
    }
    return fakeStarts
  }

  // The state-loop registers the rewrite erases must not reach the payload: no kept instruction
  // reads or captures one, and no rewritten conditional tests one. A fake block is removed whole,
  // so its reads of the state register erase nothing.
  checkErasedRegisters(fakeStarts) {
    const erased = new Set(
      this.ins
        .filter(
          (item) =>
            (this.removed.has(item.pc) || this.replacements.has(item.pc)) &&
            STATE_LOOP_WRITERS.has(item.name),
        )
        .map((item) => item.words[1]),
    )
    for (const start of this.starts)
      if (!fakeStarts.has(start))
        for (const item of this.segmentOf(start))
          this.checkErasedAt(item, erased)
  }

  // A rewritten instruction's conditional, or a kept instruction, reading an erased register.
  checkErasedAt(item, erased) {
    if (this.replacements.has(item.pc)) {
      if (
        this.replacements
          .get(item.pc)
          .some(
            (replacement) =>
              ['JUMP_IF_FALSE', 'JUMP_IF_TRUE'].includes(replacement.name) &&
              erased.has(replacement.words[1]),
          )
      )
        decline('Condition uses an erased state-loop register')
      return
    }
    if (this.removed.has(item.pc)) return
    if (
      item.operands.some(
        (operand) => operand.kind === 'register' && erased.has(operand.index),
      ) ||
      item.captures?.some(
        (capture) => capture.kind === 'local' && erased.has(capture.index),
      )
    )
      decline(`State-loop register escapes into payload at ${item.pc}`)
  }

  // The encoder rewrites a conditional to jump over the transition to its own fallthrough, so a
  // rewritten conditional's first successor is the block the compiler placed right after it. A
  // fake fork proves nothing, and a block two conditionals claim keeps no proved place. That is
  // the only order the stream proves: every other transition stays a jump, and the blocks keep
  // the stream's order, so structure is read from the graph, never from the layout.
  provedFallthroughs(fakeStarts) {
    const claims = Map.groupBy(
      [...this.blockSuccessors].filter(
        ([start, successors]) =>
          successors.length === 2 && !fakeStarts.has(start),
      ),
      ([, successors]) => successors[0],
    )
    return new Map(
      [...claims]
        .filter(([, owners]) => owners.length === 1)
        .map(([fallthrough, [[owner]]]) => [owner, fallthrough]),
    )
  }

  // The root falls into the entry block; each placed block pulls its proved fallthrough after it.
  // A conditional whose proved fallthrough follows it is written with its sense inverted, to the
  // other body, and falls into the next.
  orderBlocks(fakeStarts) {
    const fallthroughOf = this.provedFallthroughs(fakeStarts)
    const conditionalOf = new Map(
      [...fallthroughOf].map(([owner, fallthrough]) => [fallthrough, owner]),
    )
    const orderedStarts = []
    const placed = new Set()
    const place = (start) => {
      while (start !== undefined && !placed.has(start)) {
        placed.add(start)
        orderedStarts.push(start)
        start = fallthroughOf.get(start)
      }
    }
    place(this.entry)
    for (const start of this.starts)
      if (!conditionalOf.has(start) || start === this.entry) place(start)
    for (const start of this.starts) place(start)
    for (let order = 0; order < orderedStarts.length - 1; order += 1) {
      const start = orderedStarts[order]
      if (fallthroughOf.get(start) !== orderedStarts[order + 1]) continue
      this.invertTerminal(start)
    }
    return orderedStarts
  }

  invertTerminal(start) {
    const end = this.endOf(start)
    const [terminalPc, terminal] =
      [...this.replacements].filter(([pc]) => pc >= start && pc < end).at(-1) ??
      []
    if (terminal?.length !== 2) return
    const [conditional, jump] = terminal
    this.replacements.set(terminalPc, [
      {
        name:
          conditional.name === 'JUMP_IF_TRUE'
            ? 'JUMP_IF_FALSE'
            : 'JUMP_IF_TRUE',
        words: [null, conditional.words[1], jump.words[1]],
      },
    ])
  }

  observe() {
    for (const start of this.starts) this.readBlock(start)
    const fakeStarts = this.fakeStarts()
    this.checkErasedRegisters(fakeStarts)
    const orderedStarts = this.orderBlocks(fakeStarts)
    return {
      root: this.root,
      replacements: this.replacements,
      removed: this.removed,
      orderedStarts,
      blockRanges: this.starts.map((start) => ({
        start,
        end: this.endOf(start),
      })),
      fakeStarts,
      fn: this.fn,
    }
  }
}
