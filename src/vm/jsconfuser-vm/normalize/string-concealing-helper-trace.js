import { declines } from '../../decline.js'
import { HELPER_SIGNATURES } from './string-concealing-helper-signatures.js'

const { decline: refuse } = declines('string-concealing')
const decline = (message) => refuse('string-concealing-shape', message)

const BINARY = ['ADD', 'BOR', 'BXOR', 'BAND', 'SHL', 'USHR', 'LT']

// The expression each traced operation writes, from its words: `read` names a register's value,
// `value` a literal operand.
const EXPRESSIONS = Object.freeze({
  LOAD_THIS: () => ['this'],
  LOAD_CONST: (w, read, value) => ['constant', value(w[2])],
  LOAD_GLOBAL: (w, read, value) => ['global', value(w[2])],
  MOVE: (w, read) => ['move', read(w[2])],
  GET_PROP: (w, read) => ['get', read(w[2]), read(w[3])],
  CALL: (w, read) => ['call', read(w[2]), ...w.slice(4).map(read)],
  CALL_METHOD: (w, read) => [
    'method',
    read(w[2]),
    read(w[3]),
    ...w.slice(5).map(read),
  ],
  ...Object.fromEntries(
    BINARY.map((name) => [name, (w, read) => [name, read(w[2]), read(w[3])]]),
  ),
})

// The template's operand counts: an operand added or dropped changes what the helper computes.
function checkWidth({ name, pc, words: w }) {
  if (
    ((name === 'LOAD_CONST' || name === 'LOAD_GLOBAL') && w[3] !== 0) ||
    (name === 'CALL' && w[3] !== w.length - 4) ||
    (name === 'CALL_METHOD' && w[4] !== w.length - 5)
  )
    decline(`String helper operand width changed at ${pc}`)
}

// The helper's trace in execution order: walk from its entry, follow every jump, and number
// instructions by first visit. A conditional records the instructions each outcome runs next, and
// reaching an instruction already traced records a GOTO. Layout and jumps to the next instruction
// leave no trace, so any earlier decoder's order gives the template's trace (CFF reorders bodies).
// `trace` runs the walk, then numbers its targets.
export class HelperTracer {
  constructor(items, pool, start = 0) {
    this.byPc = new Map(items.map((item) => [item.pc, item]))
    this.start = start
    this.end = items.at(-1)
      ? items.at(-1).pc + items.at(-1).words.length
      : start
    this.pool = pool
    this.registers = new Map()
    this.order = new Map()
    this.entries = []
    this.branches = []
    this.pending = [start]
  }

  trace() {
    while (this.pending.length) {
      let pc = this.follow(this.pending.pop())
      while (pc !== null) pc = this.stepAt(pc)
    }
    return this.numbered()
  }

  // The instruction a jump chain from `pc` reaches, inside the helper's body.
  follow(from) {
    let pc = from
    const seen = new Set()
    while (this.byPc.get(pc)?.name === 'JUMP' && !seen.has(pc)) {
      seen.add(pc)
      pc = this.byPc.get(pc).words[1]
    }
    if (pc < this.start || pc >= this.end || !this.byPc.has(pc))
      decline(`String helper control leaves its body at ${pc}`)
    return pc
  }

  value(index) {
    const raw = this.pool ? this.pool[index] : index
    // concealConstants' XOR restores this u32 literal in signed form;
    // the template's subsequent BOR 0 applies the same 32-bit coercion.
    if (raw === -1640531527) return 0x9e3779b9
    return raw === undefined ? '<undefined>' : raw
  }

  read(register) {
    return this.registers.get(register) ?? `arg${register}`
  }

  // Traces the instruction at `pc`; the next PC on this path, or null where the path ends.
  stepAt(pc) {
    if (this.order.has(pc)) {
      this.entries.push(['GOTO', pc])
      return null
    }
    const item = this.byPc.get(pc)
    this.order.set(pc, this.entries.length)
    checkWidth(item)
    const next = item.pc + item.words.length
    if (item.name === 'JUMP_IF_FALSE' || item.name === 'JUMP_IF_TRUE')
      return this.branchAt(item, next)
    if (item.name === 'RETURN') {
      this.entries.push(['RETURN', this.read(item.words[1])])
      return null
    }
    this.expressionAt(item)
    return this.follow(next)
  }

  // The true outcome continues this path; the false outcome is walked later.
  branchAt(item, next) {
    const target = this.follow(item.words[2])
    const fallthrough = this.follow(next)
    const [whenTrue, whenFalse] =
      item.name === 'JUMP_IF_FALSE'
        ? [fallthrough, target]
        : [target, fallthrough]
    const branch = ['IF', this.read(item.words[1]), whenTrue, whenFalse]
    this.entries.push(branch)
    this.branches.push(branch)
    this.pending.push(whenFalse)
    return whenTrue
  }

  expressionAt(item) {
    if (!Object.hasOwn(EXPRESSIONS, item.name))
      decline(`Unexpected ${item.name} in string helper`)
    const expression = EXPRESSIONS[item.name](
      item.words,
      (register) => this.read(register),
      (index) => this.value(index),
    )
    this.entries.push([item.name, expression])
    this.registers.set(
      item.words[1],
      item.name === 'MOVE' ? expression[1] : `op${this.entries.length - 1}`,
    )
  }

  // GOTO and branch targets as trace positions instead of PCs.
  numbered() {
    for (const entry of this.entries)
      if (entry[0] === 'GOTO') entry[1] = this.order.get(entry[1])
    for (const branch of this.branches) {
      branch[2] = this.order.get(branch[2])
      branch[3] = this.order.get(branch[3])
    }
    return this.entries
  }
}

function templateTrace(signature) {
  let pc = 0
  const items = signature.map(([name, ...operands]) => {
    const item = { name, pc, words: [null, ...operands] }
    pc += item.words.length
    return item
  })
  return new HelperTracer(items, null).trace()
}

// The traces of the two pinned helper templates, inflate then decode.
export const EXPECTED_HELPER_TRACES = HELPER_SIGNATURES.map(templateTrace)
