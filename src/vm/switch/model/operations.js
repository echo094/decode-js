import * as t from '@babel/types'
import { mayThrow } from './control.js'
import { decline } from './model.js'

// Facts about one typed operation and one function's cases that every backend stage reads: the
// registers an operation reads and writes, the slots a value can fold into, whether it may throw,
// reaching definitions, and register and function names.

// A constant as an expression node: a negative number, -0 and -Infinity as a negation, NaN and
// Infinity by name, undefined as `void 0`.
export function literalNode(value) {
  if (value === undefined) return t.unaryExpression('void', t.numericLiteral(0))
  if (value === null) return t.nullLiteral()
  if (typeof value === 'string') return t.stringLiteral(value)
  if (typeof value === 'boolean') return t.booleanLiteral(value)
  if (typeof value === 'bigint') return t.bigIntLiteral(value)
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return t.identifier('NaN')
    const magnitude =
      Math.abs(value) === Infinity
        ? t.identifier('Infinity')
        : t.numericLiteral(Math.abs(value))
    return value < 0 || Object.is(value, -0)
      ? t.unaryExpression('-', magnitude)
      : magnitude
  }
  decline('unsupported-constant-value', 'Constant is not a supported literal')
}

export function functionName(functionId) {
  return `__recovered_function_${functionId}`
}

export function registerName(functionId, register) {
  return `__recovered_r_${functionId}_${register}`
}

// The registers an instruction writes or captures. A folded producer is written inside its use
// and writes no register; a literal's site writes the literal.
function writtenRegisters(instruction) {
  const destination =
    instruction.folded || instruction.writesValue || instruction.discarded
      ? null
      : instruction.unit
        ? instruction.unit.destination
        : destinationRegister(instruction)
  const operation = instruction.operation
  return [
    ...(destination !== null ? [destination] : []),
    ...(Object.hasOwn(OTHER_WRITES, operation.kind)
      ? OTHER_WRITES[operation.kind](operation)
      : []),
  ]
}

// The registers an operation writes besides its destination, by kind.
const OTHER_WRITES = Object.freeze({
  // The key a for-in step writes on its non-exit route.
  'for-in-next': (op) => [op.destination],
  'catch-setup': (op) => [op.exceptionRegister],
  'finally-setup': (op) => [op.continuation, op.payload],
  closure: (op) =>
    op.captures
      .filter((capture) => capture.kind === 'local')
      .map((capture) => capture.index),
})

export function functionRegisterSet(instructions) {
  const registers = new Set()
  for (const instruction of instructions)
    for (const register of [
      ...readRegisters(instruction),
      ...writtenRegisters(instruction),
    ])
      registers.add(register)
  return registers
}

export function localCaptureRegisterSet(instructions) {
  const registers = new Set()
  for (const instruction of instructions) {
    if (instruction.operation.kind !== 'closure') continue
    for (const capture of instruction.operation.captures)
      if (capture.kind === 'local') registers.add(capture.index)
  }
  return registers
}

// A non-root function's parameter registers, up to the last one read.
function parameterRegisters(frame, functionRecord, read) {
  if (frame.root) return []
  let count = 0
  for (let register = 0; register < functionRecord.paramCount; register++)
    if (read.has(register)) count = register + 1
  return Array.from({ length: count }, (_, register) => register)
}

// A function's rendering frame: `functionId`; `root`, the program's entry; `captures`, the
// register each capture index names (resolved at the closure site that created this invocation);
// `closures`, each closure site's function expression by PC, written before the function itself.
//
// The opening of a function, `{ params, prologue }`: its parameters, the parameter registers up to
// the last one read (the rest register as `...`; the root has none); then the prologue: the other
// `registers` declared, and the argument array, when its register (`paramCount`) is read, from the
// call's own arguments. With `reachingDefinitions` (a structured function's
// solver result) the array is bound only where its entry value reaches a read or a closure
// captures the register: a write before every read leaves the binding nothing to give.
export function functionHead(
  frame,
  functionRecord,
  instructions,
  registers,
  reachingDefinitions = null,
) {
  const { functionId } = frame
  const read = new Set([
    ...registerReadCounts(instructions).keys(),
    ...localCaptureRegisterSet(instructions),
  ])
  const parameters = parameterRegisters(frame, functionRecord, read)
  const rest = functionRecord.hasRest ? functionRecord.paramCount - 1 : null
  const register = (index) => t.identifier(registerName(functionId, index))
  const params = parameters.map((index) =>
    index === rest ? t.restElement(register(index)) : register(index),
  )
  const prologue = []
  const declared = [...registers]
    .filter((index) => !parameters.includes(index))
    .sort((left, right) => left - right)
  if (declared.length > 0)
    prologue.push(
      t.variableDeclaration(
        'let',
        declared.map((index) => t.variableDeclarator(register(index))),
      ),
    )
  const argumentsRegister = functionRecord.paramCount
  const entryRead = (register) =>
    !reachingDefinitions ||
    localCaptureRegisterSet(instructions).has(register) ||
    instructions.some(
      (instruction) =>
        readRegisters(instruction).includes(register) &&
        reachingDefinitions
          .get(instruction.pc)
          ?.[register]?.has(`entry:${register}`),
    )
  if (
    !frame.root &&
    argumentsRegister < functionRecord.regCount &&
    registers.has(argumentsRegister) &&
    read.has(argumentsRegister) &&
    entryRead(argumentsRegister)
  )
    prologue.push(
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          register(argumentsRegister),
          t.arrayExpression([t.spreadElement(t.identifier('arguments'))]),
        ),
      ),
    )
  return { params, prologue }
}

// A function's node: the root a declaration, any other the expression its closure site writes.
export function functionNode(frame, head, body) {
  const block = t.blockStatement([...head.prologue, ...body])
  return frame.root
    ? t.functionDeclaration(
        t.identifier(functionName(frame.functionId)),
        [],
        block,
      )
    : t.functionExpression(null, head.params, block)
}

// The registers an instruction reads as registers: a literal read is written as its literal and
// a folded read as its producer's expression, whose own reads its producer's row counts.
export function readRegisters(instruction) {
  const { operation } = instruction
  // A method call `o[k](args)` reads its receiver as its folded callee's object, which that read
  // counts.
  const registers =
    methodReceiver(instruction) === null
      ? operationReads(operation)
      : [operation.callee, ...operation.arguments.registers]
  // A literal's part does not read the object it builds: the literal is that object.
  return registers.filter(
    (register) =>
      !instruction.literalReads?.has(register) &&
      !instruction.foldedReads?.has(register) &&
      register !== instruction.literalObject,
  )
}

// The receiver register of a call written as a method call, `o[k](args)`: its callee is folded
// as a read of the receiver register. Otherwise null.
function methodReceiver(instruction) {
  const operation = instruction.operation
  if (operation.kind !== 'call' || operation.receiver?.kind !== 'register')
    return null
  const calleeRead = instruction.foldedReads?.get(operation.callee)
  return operation.mode === 'apply' &&
    calleeRead?.operation.kind === 'property-read' &&
    calleeRead.operation.object === operation.receiver.index
    ? operation.receiver.index
    : null
}

// The registers an assignment's value reads, by value kind.
const VALUE_READS = Object.freeze({
  register: (value) => [value.index],
  binary: (value) => [value.left, value.right],
  unary: (value) => [value.source],
  typeof: (value) => [value.source],
})

const sourceRead = (op) => [op.source]
const objectKeyReads = (op) => [op.object, op.key]

// The registers an operation reads, by kind, in the order its rendering evaluates them.
const OPERATION_READS = Object.freeze({
  assign: (op) =>
    Object.hasOwn(VALUE_READS, op.value.kind)
      ? VALUE_READS[op.value.kind](op.value)
      : [],
  'global-write': sourceRead,
  'upvalue-write': sourceRead,
  'indirect-jump': sourceRead,
  return: sourceRead,
  throw: sourceRead,
  'for-in-setup': sourceRead,
  'property-read': objectKeyReads,
  'property-delete': objectKeyReads,
  'property-write': (op) => [op.object, op.key, op.value],
  branch: (op) => [op.condition],
  'switch-test': (op) => op.reads,
  call: (op) => [
    op.callee,
    ...(op.receiver.kind === 'register' ? [op.receiver.index] : []),
    ...op.arguments.registers,
  ],
  array: (op) => op.elements,
  object: (op) => op.pairs.flatMap(({ key, value }) => [key, value]),
  accessor: (op) => [op.object, op.key, op.callback],
  'object-spread': (op) => [op.object, op.source],
  'for-in-next': (op) => [op.iterator],
})

export function operationReads(op) {
  return Object.hasOwn(OPERATION_READS, op.kind)
    ? OPERATION_READS[op.kind](op)
    : []
}

function registerReadCounts(instructions) {
  const counts = new Map()
  for (const instruction of instructions) {
    for (const register of readRegisters(instruction))
      counts.set(register, (counts.get(register) || 0) + 1)
  }
  return counts
}

export function destinationRegister(instruction) {
  // Iterator advance writes only on its non-exit route; adjacent-copy elimination
  // cannot redirect it as an unconditional definition.
  if (instruction.operation.kind === 'for-in-next') return null
  return Number.isSafeInteger(instruction.operation.destination)
    ? instruction.operation.destination
    : null
}

/**
 * The literal reads of one function's cases. `at(pc, register)` is the one literal every definition
 * reaching `register` at reachable `pc` holds, as `{ value }`, or null: each reaching definition must
 * be a case's write whose solved values are a single literal, every origin of it a literal assign;
 * an entry value, a route write or a captured register is not. `read(instruction, register)` is
 * whether that operand read reads such a literal.
 */
export class LiteralReads {
  constructor(instructions, solved) {
    this.solved = solved
    this.byPc = new Map(instructions.map((item) => [item.pc, item]))
    this.reachablePcs = new Set(solved.reachablePcs)
    this.localCaptureRegisters = localCaptureRegisterSet(instructions)
  }

  at(pc, register) {
    if (!this.reachablePcs.has(pc) || this.localCaptureRegisters.has(register))
      return null
    const ids = this.solved.reachingDefinitions.get(pc)?.[register]
    if (!ids || ids.size === 0) return null
    let found = null
    for (const id of ids) {
      if (this.solved.definitions.get(id)?.pc == null) return null
      const cell = this.solved.definitionValues.get(id)
      if (!cell || cell.unknown || cell.values.size !== 1) return null
      const [origins] = cell.values.values()
      for (const origin of origins) {
        const operation = this.byPc.get(Number(origin))?.operation
        if (
          !/^\d+$/.test(origin) ||
          operation?.kind !== 'assign' ||
          operation.value.kind !== 'literal'
        )
          return null
        // The solver keys values by SameValueZero; the literal itself tells 0 from -0.
        if (found && !Object.is(found.value, operation.value.value)) return null
        found = { value: operation.value.value }
      }
    }
    return found
  }

  read(instruction, register) {
    return (
      operandRead(instruction) && this.at(instruction.pc, register) !== null
    )
  }
}

// Every read of a reachable case, keyed by each definition reaching it at that case (the control
// solver's reaching definitions); one read of a register reached by two definitions is a use of each.
export function reachingDefinitionUses(
  instructions,
  reachingDefinitions,
  removed = new Set(),
  literals = null,
) {
  const uses = new Map()
  for (const instruction of instructions) {
    if (removed.has(instruction.pc)) continue
    const state = reachingDefinitions.get(instruction.pc)
    if (!state) continue
    for (const register of readRegisters(instruction)) {
      if (literals?.read(instruction, register)) continue
      for (const definition of state[register]) {
        const sites = uses.get(definition) || []
        sites.push({ pc: instruction.pc, register })
        uses.set(definition, sites)
      }
    }
  }
  return uses
}

// Producers that fold into their use as one expression. An object and an accessor keep their
// several statements and the for-in steps their iterator state, so those keep statement form. A
// closure reads no register when it is created: the function it writes reads its captured
// registers lexically when it runs.
const FOLDABLE_PRODUCERS = new Set([
  'assign',
  'property-read',
  'property-delete',
  'safe-typeof',
  'upvalue-read',
  'call',
  'array',
  'closure',
])

// A global read is written as its bare name, which checks the global object for the name and
// reads it as the VM does, except where a bare name would not reach the global: `eval` (a bare
// call to it is a direct eval), `arguments` (each function's own binding; the compiler gives the
// root none) and the decode's own `__recovered_` names. Those keep the checked statement form.
export function bareGlobal(name) {
  return (
    name !== 'eval' && name !== 'arguments' && !name.startsWith('__recovered_')
  )
}

// Whether `operation` renders as one expression: a foldable producer or a bare global read.
export function expressionProducer(operation) {
  return (
    FOLDABLE_PRODUCERS.has(operation.kind) ||
    (operation.kind === 'global-read' && bareGlobal(operation.name))
  )
}

// The kinds a folded expression may stand in. Nothing folds into a move (copy simplification's,
// save a conditional value's use, valueSlots), an object or an accessor (each writes or repeats
// before it reads), or a switch test, a for-in step and an indirect jump (each reads natively).
const FOLD_TARGETS = new Set([
  'assign',
  'global-write',
  'upvalue-write',
  'return',
  'throw',
  'for-in-setup',
  'property-read',
  'property-write',
  'property-delete',
  'branch',
  'call',
  'array',
])

// The register reads of an operation in the order its rendering evaluates them, or null where
// nothing folds into it. `foldable` is false where a folded expression cannot stand. `member`
// marks a callee called without receiver, where a member expression would pass its object as
// `this`.
export function foldSlots(operation) {
  if (
    !FOLD_TARGETS.has(operation.kind) ||
    (operation.kind === 'assign' && operation.value.kind === 'register')
  )
    return null
  const slots = operationReads(operation).map((register) => ({
    register,
    foldable: true,
  }))
  if (operation.kind === 'call')
    slots[0].member =
      operation.mode === 'apply' && operation.receiver.kind === 'none'
  return slots
}

export function valueSlots(operation) {
  return (
    foldSlots(operation) ??
    (operation.kind === 'assign' && operation.value.kind === 'register'
      ? [{ register: operation.value.index, foldable: true }]
      : null)
  )
}

export function sameStack(left = [], right = []) {
  return (
    left.length === right.length &&
    left.every((record, index) => record.setupPc === right[index].setupPc)
  )
}

// A spread reads its source's getters.
export function operationMayThrow(operation) {
  return operation.kind === 'object-spread' || mayThrow(operation)
}

// Reads the emitter renders through its operand renderer; an indirect jump's source and an
// iterator are read natively by the structured rendering.
export function operandRead(instruction) {
  return !['indirect-jump', 'for-in-next'].includes(instruction.operation.kind)
}
