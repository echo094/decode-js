import { VmSwitchDecline, isJumpStep } from './vm-switch-model.js'

export function decline(code, message) {
  throw new VmSwitchDecline(code, message)
}

export function requireValue(value, code, message) {
  if (!value) decline(code, message)
  return value
}

function literal(value) {
  if (value === undefined) return 'void 0'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (value === Infinity) return 'Infinity'
    if (value === -Infinity) return '-Infinity'
    if (Object.is(value, -0)) return '-0'
    return String(value)
  }
  if (typeof value === 'bigint') return `${String(value)}n`
  decline('unsupported-constant-value', 'Constant is not a supported literal')
}

export function functionName(functionId) {
  return `__recovered_function_${functionId}`
}

export function registerName(functionId, register) {
  return `__recovered_r_${functionId}_${register}`
}

export function functionRegisterSet(instructions) {
  const registers = new Set()
  for (const instruction of instructions) {
    for (const register of readRegisters(instruction)) registers.add(register)
    const destination = destinationRegister(instruction)
    if (destination !== null) registers.add(destination)
    const operation = instruction.operation
    if (operation.kind === 'catch-setup')
      registers.add(operation.exceptionRegister)
    if (operation.kind === 'finally-setup') {
      registers.add(operation.continuation)
      registers.add(operation.payload)
    }
    if (operation.kind === 'closure')
      for (const capture of operation.captures)
        if (capture.kind === 'local') registers.add(capture.index)
  }
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

export function functionNeedsArguments(instructions, functionRecord) {
  const reads = registerReadCounts(instructions)
  const usedRegisters = new Set([
    ...reads.keys(),
    ...localCaptureRegisterSet(instructions),
  ])
  const argumentRegisters = []
  for (let register = 0; register < functionRecord.paramCount; register += 1)
    argumentRegisters.push(register)
  if (functionRecord.paramCount < functionRecord.regCount)
    argumentRegisters.push(functionRecord.paramCount)
  return argumentRegisters.some((register) => usedRegisters.has(register))
}

function readRegisters(instruction) {
  const op = instruction.operation
  if (op.kind === 'assign') {
    const value = op.value
    if (value.kind === 'register') return [value.index]
    if (value.kind === 'binary') return [value.left, value.right]
    if (value.kind === 'unary' || value.kind === 'typeof') return [value.source]
    return []
  }
  if (op.kind === 'global-write' || op.kind === 'upvalue-write')
    return [op.source]
  if (op.kind === 'property-read' || op.kind === 'property-delete')
    return [op.object, op.key]
  if (op.kind === 'property-write') return [op.object, op.key, op.value]
  if (op.kind === 'branch') return [op.condition]
  if (['indirect-jump', 'return', 'throw', 'for-in-setup'].includes(op.kind))
    return [op.source]
  if (op.kind === 'call')
    return [
      ...(op.receiver.kind === 'register' ? [op.receiver.index] : []),
      op.callee,
      ...op.arguments.registers,
    ]
  if (op.kind === 'array') return op.elements
  if (op.kind === 'object')
    return op.pairs.flatMap(({ key, value }) => [key, value])
  if (op.kind === 'accessor') return [op.object, op.key, op.callback]
  if (op.kind === 'for-in-next') return [op.iterator]
  return []
}

function registerReadCounts(instructions) {
  const counts = new Map()
  for (const instruction of instructions) {
    for (const register of readRegisters(instruction))
      counts.set(register, (counts.get(register) || 0) + 1)
  }
  return counts
}

function destinationRegister(instruction) {
  // Iterator advance writes only on its non-exit route; adjacent-copy elimination
  // cannot redirect it as an unconditional definition.
  if (instruction.operation.kind === 'for-in-next') return null
  return Number.isSafeInteger(instruction.operation.destination)
    ? instruction.operation.destination
    : null
}

// Every read of a reachable case, keyed by each definition reaching it at that case (the control
// solver's reaching definitions); one read of a register reached by two definitions is a use of each.
function reachingDefinitionUses(instructions, reachingDefinitions) {
  const uses = new Map()
  for (const instruction of instructions) {
    const state = reachingDefinitions.get(instruction.pc)
    if (!state) continue
    for (const register of readRegisters(instruction)) {
      for (const definition of state[register]) {
        const sites = uses.get(definition) || []
        sites.push({ pc: instruction.pc, register })
        uses.set(definition, sites)
      }
    }
  }
  return uses
}

function adjacentCopyPlan(functionId, instructions, solved) {
  const reachablePcs = new Set(solved.reachablePcs)
  const uses = reachingDefinitionUses(instructions, solved.reachingDefinitions)
  // A closure reads and writes a locally captured register through its cell at any call, which no
  // reaching definition records.
  const localCaptureRegisters = localCaptureRegisterSet(instructions)
  const plan = new Map()
  const links = []
  const coalescedMovePcs = new Set()
  // A coalesced move's value is written by the producer it was folded into; following these
  // links from any removed move reaches the retained producer of its chain.
  const foldedInto = new Map()
  const retainedProducer = (pc) => {
    while (foldedInto.has(pc)) pc = foldedInto.get(pc)
    return pc
  }
  // A node is one case; its successors are the control solver's edges from its PC.
  const nodes = [...instructions]
    .sort((left, right) => left.pc - right.pc)
    .map((instruction) => ({ startPc: instruction.pc, instruction }))
  const nodeByPc = new Map(nodes.map((node) => [node.startPc, node]))
  const outgoing = Map.groupBy(solved.edges, (edge) => edge.sourcePc)
  const incoming = new Map()
  for (const edge of solved.edges)
    if (edge.targetPc !== null)
      incoming.set(edge.targetPc, (incoming.get(edge.targetPc) ?? 0) + 1)
  const nodeAt = (pc) => (pc === null ? null : (nodeByPc.get(pc) ?? null))

  const consider = (producer, move) => {
    if (
      !reachablePcs.has(producer.pc) ||
      !reachablePcs.has(move.pc) ||
      move.operation.kind !== 'assign' ||
      move.operation.value.kind !== 'register' ||
      destinationRegister(producer) === null
    )
      return
    const producerDestination = destinationRegister(producer)
    const moveDestination = destinationRegister(move)
    const moveSource = move.operation.value.index
    if (
      producerDestination !== moveSource ||
      producerDestination === moveDestination ||
      localCaptureRegisters.has(producerDestination) ||
      localCaptureRegisters.has(moveDestination)
    )
      return
    const sites = uses.get(`${producer.pc}`) || []
    if (sites.length !== 1 || sites[0].pc !== move.pc) return
    if (plan.has(producer.pc) || coalescedMovePcs.has(move.pc)) return
    // Earlier coalesces may already have changed both instructions: a removed producer writes
    // through its chain's retained producer, and a move already planned as a producer hands its
    // retarget on, so the retained producer writes the register at the end of the chain.
    const retained = retainedProducer(producer.pc)
    plan.set(retained, plan.get(move.pc) ?? moveDestination)
    plan.delete(move.pc)
    foldedInto.set(move.pc, retained)
    coalescedMovePcs.add(move.pc)
    links.push({ producerPc: producer.pc, movePc: move.pc, moveSource })
  }

  for (const node of nodes) {
    for (const edge of outgoing.get(node.startPc) ?? []) {
      if (edge.kind !== 'fallthrough') continue
      let target = nodeAt(edge.targetPc)
      // Jump steps entered only from here run nothing between the two.
      const seen = new Set()
      while (
        isJumpStep(target) &&
        incoming.get(target.startPc) === 1 &&
        !seen.has(target.startPc)
      ) {
        seen.add(target.startPc)
        const [next] = outgoing.get(target.startPc) ?? []
        target = nodeAt(next?.targetPc ?? null)
      }
      if (target && !isJumpStep(target) && incoming.get(target.startPc) === 1)
        consider(node.instruction, target.instruction)
    }
  }
  // Each row reports a removed move against the final plan: the producer that is retained and
  // the register it now writes; the reaching definition is the move's own producer.
  const proofs = links.map(({ producerPc, movePc, moveSource }) => {
    const retained = retainedProducer(movePc)
    return {
      functionId,
      producerPc: retained,
      movePc,
      sourceRegister: moveSource,
      destinationRegister: plan.get(retained),
      reachingDefinitions: [`${producerPc}`],
      useSites: [{ pc: movePc, register: moveSource }],
      disposition: 'safely-eliminated',
      reason: 'single-reaching-definition-use',
      producerRetained: true,
      evaluationOrderPreserved: true,
      receiverSemanticsPreserved: true,
    }
  })
  return { plan, proofs, coalescedMovePcs }
}

export function effectiveStructuredInstructions(
  functionId,
  instructions,
  solved,
) {
  const adjacent = adjacentCopyPlan(functionId, instructions, solved)
  const { plan: copyPlan, proofs: copyProofs, coalescedMovePcs } = adjacent
  return {
    copyPlan,
    copyProofs,
    coalescedMovePcs,
    instructions: instructions
      .filter(({ pc }) => !coalescedMovePcs.has(pc))
      .map((instruction) => {
        const destination = copyPlan.get(instruction.pc)
        return destination === undefined
          ? instruction
          : retargetDestination(instruction, destination)
      }),
  }
}

export function retargetDestination(instruction, register) {
  return {
    ...instruction,
    operation: { ...instruction.operation, destination: register },
  }
}

function functionForPc(functions, startPc) {
  const functionRecord = functions.functions.find(
    ({ startPc: candidate }) => candidate === startPc,
  )
  if (!functionRecord) {
    decline(
      'missing-closure-function',
      `Closure points at missing function entry ${startPc}`,
    )
  }
  return functionRecord
}

function captureExpression(functionId, instruction, functions) {
  const { captures: captureRecords, entry } = instruction.operation
  const captures = []
  for (const capture of captureRecords) {
    if (!capture || !Number.isSafeInteger(capture.index) || capture.index < 0) {
      decline(
        'invalid-capture-pair',
        'Closure contains an invalid capture pair',
      )
    }
    if (capture.kind === 'local') {
      const cell = `__recovered_cells_${functionId}[${capture.index}]`
      captures.push(cell)
    } else if (capture.kind === 'upvalue') {
      captures.push(`__recovered_captures[${capture.index}]`)
    } else {
      decline('unsupported-capture-kind', 'Closure has an unknown capture kind')
    }
  }
  functionForPc(functions, entry)
  return captures
}

function argExpression(functionId, args) {
  if (args.kind === 'array-register')
    return registerName(functionId, args.registers[0])
  return `[${args.registers.map((register) => registerName(functionId, register)).join(', ')}]`
}

function emitCall(functionId, operation) {
  const destination = registerName(functionId, operation.destination)
  const callee = registerName(functionId, operation.callee)
  const args = argExpression(functionId, operation.arguments)
  if (operation.mode === 'apply' && operation.receiver.kind === 'none') {
    const { kind, registers } = operation.arguments
    const list =
      kind === 'array-register'
        ? `...${registerName(functionId, registers[0])}`
        : registers
            .map((register) => registerName(functionId, register))
            .join(', ')
    return `${destination} = ${callee}(${list});`
  }
  if (operation.mode === 'apply') {
    const receiver = registerName(functionId, operation.receiver.index)
    return `${destination} = Reflect.apply(${callee}, ${receiver}, ${args});`
  }
  return `${destination} = Reflect.construct(${callee}, ${args});`
}

function emitCollection(functionId, operation) {
  const destination = registerName(functionId, operation.destination)
  if (operation.kind === 'array') {
    const values = operation.elements.map((register) =>
      registerName(functionId, register),
    )
    return `${destination} = [${values.join(', ')}];`
  }
  const lines = [`${destination} = {};`]
  for (const pair of operation.pairs) {
    const key = registerName(functionId, pair.key)
    const value = registerName(functionId, pair.value)
    lines.push(`Reflect.set(${destination}, ${key}, ${value});`)
  }
  return lines.join('\n')
}

export function emitInstruction(
  functionId,
  instruction,
  functions,
  emissionMode = 'dispatch',
) {
  const operation = instruction.operation
  if (!operation)
    decline(
      'missing-switch-operation',
      'VM switch case has no semantic operation',
    )
  const nextPc = instruction.nextPc
  const next =
    emissionMode === 'dispatch'
      ? `__recovered_pc = ${nextPc};\ncontinue __recovered_dispatch;`
      : ''
  const destination = () => registerName(functionId, operation.destination)
  const source = (register) => registerName(functionId, register)

  if (operation.kind === 'assign') {
    const value = operation.value
    let expression
    if (value.kind === 'literal') expression = literal(value.value)
    else if (value.kind === 'this') expression = 'this'
    else if (value.kind === 'register') expression = source(value.index)
    else if (value.kind === 'binary')
      expression = `${source(value.left)} ${value.operator} ${source(value.right)}`
    else if (value.kind === 'unary')
      expression = `${value.operator}${source(value.source)}`
    else if (value.kind === 'typeof')
      expression = `typeof ${source(value.source)}`
    else if (value.kind === 'undefined') expression = 'void 0'
    else
      decline(
        'unsupported-switch-value',
        `Unknown VM switch value ${value.kind}`,
      )
    return `${destination()} = ${expression};\n${next}`
  }
  if (operation.kind === 'global-read') {
    const value = literal(operation.name)
    return `if (!(${value} in globalThis)) throw new ReferenceError(${value} + ' is not defined');\n${destination()} = globalThis[${value}];\n${next}`
  }
  if (operation.kind === 'global-write')
    return `globalThis[${literal(operation.name)}] = ${source(operation.source)};\n${next}`
  if (operation.kind === 'upvalue-read')
    return `${destination()} = __recovered_captures[${operation.index}].value;\n${next}`
  if (operation.kind === 'upvalue-write')
    return `__recovered_captures[${operation.index}].value = ${source(operation.source)};\n${next}`
  if (operation.kind === 'property-read')
    return `${destination()} = ${source(operation.object)}[${source(operation.key)}];\n${next}`
  if (operation.kind === 'property-write')
    return `Reflect.set(${source(operation.object)}, ${source(operation.key)}, ${source(operation.value)});\n${next}`
  if (operation.kind === 'property-delete')
    return `${destination()} = Reflect.deleteProperty(${source(operation.object)}, ${source(operation.key)});\n${next}`
  if (operation.kind === 'safe-typeof') {
    const global = literal(operation.name)
    return `${destination()} = Object.prototype.hasOwnProperty.call(globalThis, ${global}) ? typeof globalThis[${global}] : 'undefined';\n${next}`
  }
  if (operation.kind === 'jump')
    return `__recovered_pc = ${operation.target};\ncontinue __recovered_dispatch;`
  if (operation.kind === 'branch') {
    const condition = source(operation.condition)
    const predicate = operation.when === 'false' ? `!${condition}` : condition
    return `__recovered_pc = ${predicate} ? ${operation.target} : ${nextPc};\ncontinue __recovered_dispatch;`
  }
  if (operation.kind === 'indirect-jump')
    return `__recovered_pc = ${source(operation.source)};\ncontinue __recovered_dispatch;`
  if (operation.kind === 'call')
    return `${emitCall(functionId, operation)}\n${next}`
  if (operation.kind === 'return') return `return ${source(operation.source)};`
  if (operation.kind === 'throw') return `throw ${source(operation.source)};`
  if (operation.kind === 'closure') {
    const captures = captureExpression(functionId, instruction, functions)
    const child = functionForPc(functions, operation.entry)
    const captureName = `__recovered_closure_captures_${functionId}_${instruction.pc}`
    const localCells = operation.captures
      .filter((operand) => operand.kind === 'local')
      .map((operand) => operand.index)
    const statements = localCells.map(
      (register) =>
        `__recovered_cells_${functionId}[${register}] ||= { get value() { return ${registerName(functionId, register)}; }, set value(__value) { ${registerName(functionId, register)} = __value; } };`,
    )
    if (child.captureCount > 0)
      statements.push(`const ${captureName} = [${captures.join(', ')}];`)
    const childArguments =
      child.captureCount > 0
        ? `[${captureName}, ...__recovered_closure_args]`
        : '[...__recovered_closure_args]'
    statements.push(
      `${destination()} = function (...__recovered_closure_args) { const __recovered_this = this == null ? globalThis : this; return Reflect.apply(${functionName(child.id)}, __recovered_this, ${childArguments}); };`,
    )
    statements.push(next)
    return statements.join('\n')
  }
  if (operation.kind === 'array' || operation.kind === 'object')
    return `${emitCollection(functionId, operation)}\n${next}`
  if (operation.kind === 'accessor') {
    const object = source(operation.object)
    const key = source(operation.key)
    const callback = source(operation.callback)
    const descriptorName = `__recovered_descriptor_${functionId}_${instruction.pc}`
    const existingName = `__recovered_existing_${functionId}_${instruction.pc}`
    const accessor = operation.accessor
    const other = accessor === 'get' ? 'set' : 'get'
    return `{\nconst ${existingName} = Object.getOwnPropertyDescriptor(${object}, ${key});\nconst ${descriptorName} = { ${accessor}: ${callback}, configurable: true, enumerable: true };\nif (${existingName} && typeof ${existingName}.${other} === 'function') ${descriptorName}.${other} = ${existingName}.${other};\nObject.defineProperty(${object}, ${key}, ${descriptorName});\n}\n${next}`
  }
  if (operation.kind === 'for-in-setup')
    return `${destination()} = { keys: __recovered_enumerable_keys(${source(operation.source)}), index: 0 };\n${next}`
  if (operation.kind === 'for-in-next') {
    const iterator = source(operation.iterator)
    return `if (${iterator}.index >= ${iterator}.keys.length) { __recovered_pc = ${operation.exit}; } else { ${destination()} = ${iterator}.keys[${iterator}.index++]; __recovered_pc = ${nextPc}; }\ncontinue __recovered_dispatch;`
  }
  if (operation.kind === 'catch-setup')
    return `__recovered_handlers.push({ kind: 'catch', target: ${operation.target}, register: ${operation.exceptionRegister} });\n${next}`
  if (operation.kind === 'handler-pop')
    return `__recovered_handlers.pop();\n${next}`
  if (operation.kind === 'finally-setup')
    return `__recovered_handlers.push({ kind: 'finally', target: ${operation.target}, continuation: ${operation.continuation}, payload: ${operation.payload}, throwPad: ${operation.throwPad} });\n${next}`
  if (operation.kind === 'debugger') return next
  decline(
    'unsupported-switch-operation',
    `VM switch emission does not support ${operation.kind}`,
  )
}

export function emitHandlerRegisterAssignment(
  functionId,
  registerCount,
  property,
  value,
) {
  const lines = [`switch (__recovered_handler.${property}) {`]
  for (let register = 0; register < registerCount; register += 1) {
    lines.push(
      `case ${register}: ${registerName(functionId, register)} = ${value}; break;`,
    )
  }
  lines.push("default: throw new Error('Invalid recovered handler register');")
  lines.push('}')
  return lines
}

export function appendRendered(lines, rendered) {
  const renderedLines = rendered.split('\n')
  while (renderedLines.at(-1) === '') renderedLines.pop()
  lines.push(...renderedLines)
}

export function invertPredicate(predicate) {
  return predicate.startsWith('!') ? predicate.slice(1) : `!(${predicate})`
}
