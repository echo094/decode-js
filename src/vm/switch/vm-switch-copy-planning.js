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

function definitionState(regCount) {
  return new Map(
    Array.from({ length: regCount }, (_, register) => [register, new Set()]),
  )
}

function cloneDefinitionState(state, regCount) {
  return new Map(
    Array.from({ length: regCount }, (_, register) => [
      register,
      new Set(state.get(register)),
    ]),
  )
}

function mergeDefinitionState(target, source, regCount) {
  let changed = false
  for (let register = 0; register < regCount; register += 1) {
    const targetDefinitions = target.get(register)
    for (const definition of source.get(register)) {
      if (targetDefinitions.has(definition)) continue
      targetDefinitions.add(definition)
      changed = true
    }
  }
  return changed
}

function sameDefinitionState(left, right, regCount) {
  for (let register = 0; register < regCount; register += 1) {
    const leftDefinitions = left.get(register)
    const rightDefinitions = right.get(register)
    if (
      leftDefinitions.size !== rightDefinitions.size ||
      [...leftDefinitions].some(
        (definition) => !rightDefinitions.has(definition),
      )
    )
      return false
  }
  return true
}

function reachingDefinitionUses(blocks, edgeById, regCount) {
  const inStates = new Map(
    blocks.map((block) => [block.id, definitionState(regCount)]),
  )
  const outStates = new Map(
    blocks.map((block) => [block.id, definitionState(regCount)]),
  )
  const predecessors = new Map(blocks.map((block) => [block.id, []]))
  const blockByStart = new Map(blocks.map((block) => [block.startPc, block]))
  for (const block of blocks) {
    for (const edgeId of block.successorEdgeIds) {
      const edge = edgeById.get(edgeId)
      const target =
        edge?.targetPc === null ? null : blockByStart.get(edge?.targetPc)
      if (target) predecessors.get(target.id).push(block)
    }
  }

  const entry = blocks[0]
  const limit = Math.max(32, blocks.length * Math.max(1, regCount) * 8)
  let changed = true
  let iterations = 0
  while (changed) {
    changed = false
    iterations += 1
    if (iterations > limit)
      decline(
        'simplification-nonconvergent',
        'Adjacent-copy reaching definitions did not converge',
      )
    for (const block of blocks) {
      const incoming = definitionState(regCount)
      if (block === entry) {
        for (let register = 0; register < regCount; register += 1)
          incoming.get(register).add(`entry:${register}`)
      }
      for (const predecessor of predecessors.get(block.id))
        mergeDefinitionState(incoming, outStates.get(predecessor.id), regCount)
      if (!sameDefinitionState(inStates.get(block.id), incoming, regCount)) {
        inStates.set(block.id, incoming)
        changed = true
      }

      const outgoing = cloneDefinitionState(incoming, regCount)
      for (const instruction of block.leaves) {
        const destination = destinationRegister(instruction)
        if (destination !== null)
          outgoing.set(destination, new Set([`${instruction.pc}`]))
      }
      if (!sameDefinitionState(outStates.get(block.id), outgoing, regCount)) {
        outStates.set(block.id, outgoing)
        changed = true
      }
    }
  }

  const uses = new Map()
  for (const block of blocks) {
    const state = cloneDefinitionState(inStates.get(block.id), regCount)
    for (const instruction of block.leaves) {
      for (const register of readRegisters(instruction)) {
        for (const definition of state.get(register)) {
          const sites = uses.get(definition) || []
          sites.push({ pc: instruction.pc, register })
          uses.set(definition, sites)
        }
      }
      const destination = destinationRegister(instruction)
      if (destination !== null)
        state.set(destination, new Set([`${instruction.pc}`]))
    }
  }
  return uses
}

function adjacentCopyPlan(
  functionId,
  instructions,
  blocks,
  edgeById,
  regCount,
) {
  const uses = reachingDefinitionUses(blocks, edgeById, regCount)
  const localCaptureRegisters = localCaptureRegisterSet(instructions)
  // Handler routing writes these registers implicitly. Keep their definitions
  // and saved-completion copies explicit across every exceptional predecessor.
  for (const { operation } of instructions) {
    if (operation.kind === 'catch-setup')
      localCaptureRegisters.add(operation.exceptionRegister)
    if (operation.kind === 'finally-setup') {
      localCaptureRegisters.add(operation.continuation)
      localCaptureRegisters.add(operation.payload)
    }
  }
  const plan = new Map()
  const proofs = []
  const coalescedMovePcs = new Set()
  const blockByStart = new Map(blocks.map((block) => [block.startPc, block]))
  const predecessors = new Map(blocks.map((block) => [block.id, []]))
  for (const block of blocks) {
    for (const edgeId of block.successorEdgeIds) {
      const edge = edgeById.get(edgeId)
      const target =
        edge?.targetPc === null ? null : blockByStart.get(edge?.targetPc)
      if (target) predecessors.get(target.id).push({ block, edge })
    }
  }

  const consider = (producer, move) => {
    if (
      producer.reachable !== true ||
      move.reachable !== true ||
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
    plan.set(producer.pc, moveDestination)
    coalescedMovePcs.add(move.pc)
    proofs.push({
      functionId,
      producerPc: producer.pc,
      movePc: move.pc,
      sourceRegister: producerDestination,
      destinationRegister: moveDestination,
      reachingDefinitions: [`${producer.pc}`],
      useSites: [{ pc: move.pc, register: moveSource }],
      disposition: 'safely-eliminated',
      reason: 'single-reaching-definition-use',
      producerRetained: true,
      evaluationOrderPreserved: true,
      receiverSemanticsPreserved: true,
    })
  }

  for (const block of blocks) {
    for (let index = 0; index + 1 < block.leaves.length; index += 1) {
      consider(block.leaves[index], block.leaves[index + 1])
    }
    const producer = block.leaves.at(-1)
    if (!producer) continue
    for (const edgeId of block.successorEdgeIds) {
      const edge = edgeById.get(edgeId)
      let target =
        edge?.targetPc === null ? null : blockByStart.get(edge?.targetPc)
      if (edge?.kind !== 'fallthrough' || !target) continue
      // Jump steps entered only from here run nothing between the two.
      const seen = new Set()
      while (
        isJumpStep(target) &&
        predecessors.get(target.id).length === 1 &&
        !seen.has(target.id)
      ) {
        seen.add(target.id)
        const [next] = target.successorEdgeIds.map((id) => edgeById.get(id))
        target = next?.targetPc == null ? null : blockByStart.get(next.targetPc)
        if (!target) break
      }
      if (
        target &&
        !isJumpStep(target) &&
        predecessors.get(target.id).length === 1 &&
        target.leaves[0]
      )
        consider(producer, target.leaves[0])
    }
  }
  return { plan, proofs, coalescedMovePcs }
}

export function effectiveStructuredInstructions(
  functionId,
  instructions,
  controlFunction,
  edges,
  regCount,
) {
  const edgeById = structuredControlEdges(edges)
  const adjacent = adjacentCopyPlan(
    functionId,
    instructions,
    controlFunction.blocks,
    edgeById,
    regCount,
  )
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
  if (operation.mode === 'apply') {
    const receiver =
      operation.receiver.kind === 'register'
        ? registerName(functionId, operation.receiver.index)
        : operation.receiver.kind === 'global'
          ? 'globalThis'
          : 'null'
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

export function structuredControlEdges(edges) {
  return new Map(edges.map((edge) => [edge.id, edge]))
}
