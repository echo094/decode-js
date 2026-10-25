import { requireHandlers } from './locate-handlers.js'
import { meaningResolver } from './handler-meaning.js'
import {
  decomposeEffects,
  handlerEffects,
  unifyEffects,
} from './handler-effects.js'
import { CANONICAL_OPCODES, createOpcodeTable } from './opcode-table.js'

// The canonical handlers by behaviour, all at once. A handler the behaviour matchers name
// uniquely is that opcode. An encoder's added handlers are built from canonical bodies, so a
// matcher can fit an original handler and its copies alike and name none of them: each such
// handler is then asked again among the named ones only, and of the handlers one template fits, the
// one reading the most operands is the original (a copy bakes some of them in). Handlers with
// equal effects (an alias in identity order) share one meaning; the lowest label stands for it.
// The rest are added handlers, for the added-opcode readers.
export function behaviourTable(view) {
  const resolver = meaningResolver(view)
  const named = new Map()
  for (const handler of view.handlers) {
    const name = resolver.opcodeFor(handler.label)
    if (name) named.set(handler, name)
  }
  const taken = new Set(named.values())
  const namedLabels = [...named.keys()].map((handler) => handler.label)
  const groups = new Map()
  for (const handler of view.handlers) {
    if (named.has(handler)) continue
    const name = resolver.nameAmong(handler.label, namedLabels)
    if (!name || taken.has(name)) continue
    groups.set(name, [...(groups.get(name) ?? []), handler])
  }
  const identities = new Map()
  for (const [name, members] of groups) {
    const read = members.map((handler) => ({
      handler,
      ...handlerEffects(view, handler, identities),
    }))
    const most = Math.max(...read.map((item) => item.operands))
    const originals = read
      .filter((item) => item.operands === most)
      .sort((left, right) => left.handler.label - right.handler.label)
    const [first, ...rest] = originals
    if (rest.every((item) => sameEffects(first.effects, item.effects)))
      named.set(first.handler, name)
  }

  // Values come from labels. A name no handler answers keeps its canonical default unless an
  // identified handler already holds that value.
  const opcodes = createOpcodeTable()
  const labels = new Set([...named.keys()].map((handler) => handler.label))
  for (const name of Object.keys(CANONICAL_OPCODES))
    if (labels.has(opcodes[name])) opcodes[name] = null
  for (const [handler, name] of named) opcodes[name] = handler.label
  return { opcodes, sentinel: resolver.sentinel(), named }
}

// Equal effects: the same terms, each operand slot in the same position.
function sameEffects(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

// The handler view with this decode's opcode table by behaviour and its added handlers classified
// (`added`: label -> class), for the added-opcode readers.
export function requireIdentifiedHandlers(ast, code) {
  const view = requireHandlers(ast, code)
  const table = behaviourTable(view)
  return { ...view, opcodes: table.opcodes, added: classifyAdded(view, table) }
}

// Operands whose count depends on the instruction: a specialized handler cannot bake them.
const VARIABLE_WIDTH = new Set([
  'MAKE_CLOSURE',
  'BUILD_ARRAY',
  'BUILD_OBJECT',
  'CALL',
  'CALL_METHOD',
  'NEW',
])

const isSlot = (term) => term && typeof term === 'object' && 'op' in term
const isLiteral = (term) =>
  term && typeof term === 'object' && 'literal' in term

// Each added handler by what it does, against the canonical handlers `table` names:
// - specialized: one canonical handler with every operand slot a literal (its baked operands);
// - alias: one canonical handler whose slots are its own reads in another order
//   (`canonicalToStored[j]` is the read that canonical operand j takes);
// - macro: two or more canonical handlers in sequence, operands read as they are used;
// - anti: two or more canonical handlers in sequence, all operands read up front into one array.
// A handler that fits none, or more than one way, is left unclassified (null).
export function classifyAdded(view, table) {
  const identities = new Map()
  const references = [...table.named].map(([handler, name]) => ({
    name,
    opcode: handler.label,
    ...handlerEffects(view, handler, identities),
  }))
  const classes = new Map()
  for (const handler of view.handlers) {
    if (table.named.has(handler)) continue
    const actual = handlerEffects(view, handler, identities)
    const singles = references.flatMap((reference) => {
      const slots = new Map()
      return unifyEffects(reference.effects, actual.effects, slots)
        ? [{ reference, slots }]
        : []
    })
    classes.set(handler.label, classify(singles, actual, references))
  }
  return classes
}

function classify(singles, actual, references) {
  if (singles.length > 1) return null
  if (singles.length === 1) {
    const [{ reference, slots }] = singles
    const bound = [...Array(reference.operands).keys()].map((index) =>
      slots.get(index),
    )
    if (
      bound.length > 0 &&
      bound.every(isLiteral) &&
      !VARIABLE_WIDTH.has(reference.name)
    )
      return {
        kind: 'specialized',
        name: reference.name,
        opcode: reference.opcode,
        operands: bound.map((term) => term.literal),
      }
    if (!bound.some(isLiteral)) fillDeadReads([bound], actual.operands)
    const order = bound.map((term) => (isSlot(term) ? term.op : null))
    if (
      bound.length > 0 &&
      bound.length === actual.operands &&
      order.every((item) => item !== null) &&
      new Set(order).size === order.length
    )
      return {
        kind: 'alias',
        name: reference.name,
        opcode: reference.opcode,
        canonicalToStored: order,
      }
    return null
  }
  const ways = decomposeEffects(references, actual.effects)
  if (ways.length !== 1 || ways[0].length < 2) return null
  const steps = ways[0].map(({ reference, slots }) => ({
    name: reference.name,
    opcode: reference.opcode,
    operands: [...Array(reference.operands).keys()].map((index) =>
      slots.get(index),
    ),
  }))
  fillDeadReads(
    steps.map((step) => step.operands),
    actual.operands,
  )
  const reads = steps.flatMap((step) => step.operands)
  if (!reads.every(isSlot)) return null
  const order = reads.map((term) => term.op)
  if (new Set(order).size !== order.length || order.length !== actual.operands)
    return null
  return {
    kind: actual.eager ? 'anti' : 'macro',
    steps: steps.map((step) => ({
      name: step.name,
      opcode: step.opcode,
      reads: step.operands.map((term) => term.op),
    })),
  }
}

// A read whose value no effect uses (a register the handler loads and never touches) still consumes
// a word of the stream, so a reference slot no effect binds takes the next actual read no effect
// binds either, in order. Only fresh reads can fill it; a baked literal stays unknown.
function fillDeadReads(groups, count) {
  const used = new Set(
    groups.flat().flatMap((term) => (isSlot(term) ? [term.op] : [])),
  )
  const spare = [...Array(count).keys()].filter((read) => !used.has(read))
  for (const group of groups)
    for (const [index, term] of group.entries())
      if (term === undefined && spare.length > 0)
        group[index] = { op: spare.shift() }
}
