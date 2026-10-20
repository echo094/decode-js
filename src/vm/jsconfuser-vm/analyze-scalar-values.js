import {
  CFG_SCHEMA,
  EXCLUDED_OPCODE_GROUPS,
  EXCLUDED_OPCODE_NAMES,
  FUNCTION_SCHEMA,
  I_DEFINITION_BY_NAME,
  I_OPCODE_DEFINITIONS,
  REFERENCE_SCHEMA,
  SCALAR_VALUES_SCHEMA,
  ScalarValuesDecline,
  WORDCODE_SCHEMA,
  decline,
  deepFreeze,
} from './scalar-values-preflight.js'

function register(index) {
  return { kind: 'register', index }
}

function copyOperand(operand) {
  return { ...operand }
}

function reachablePcs(cfg) {
  const reachable = new Map()
  for (const fn of cfg.functions) {
    const edgesBySource = new Map()
    for (const edge of fn.edges) {
      const edges = edgesBySource.get(edge.sourcePc) ?? []
      edges.push(edge)
      edgesBySource.set(edge.sourcePc, edges)
    }
    const seen = new Set([fn.startPc])
    const queue = [fn.startPc]
    while (queue.length) {
      const pc = queue.shift()
      for (const edge of edgesBySource.get(pc) ?? []) {
        if (edge.targetPc !== null && !seen.has(edge.targetPc)) {
          seen.add(edge.targetPc)
          queue.push(edge.targetPc)
        }
      }
    }
    for (const pc of seen) reachable.set(`${fn.id}:${pc}`, true)
  }
  return reachable
}

function ownerByPc(functions) {
  return new Map(
    functions.ownership.map(({ pc, functionId }) => [String(pc), functionId]),
  )
}

function constantReference(instruction, references, operandIndex) {
  const ref = references.constants.references.find(
    ({ pc, instruction: name, operand }) =>
      pc === instruction.pc &&
      name === instruction.name &&
      operand === operandIndex,
  )

  return {
    kind: 'constant',
    index: ref.index,
    concealKey: ref.concealKey,
    value: references.constants.values[ref.index],
  }
}

function operationShape(instruction, definition) {
  const operands = instruction.operands.map((operand, index) =>
    copyOperand(
      operand,
      `${instruction.name}@${instruction.pc} operand ${index}`,
    ),
  )
  const destination =
    definition.name === 'STORE_GLOBAL'
      ? null
      : register(
          instruction.words[1],
          `${instruction.name}@${instruction.pc} destination`,
        )
  const inputIndexes =
    definition.name === 'LOAD_CONST' ||
    definition.name === 'LOAD_INT' ||
    definition.name === 'LOAD_GLOBAL'
      ? []
      : definition.name === 'STORE_GLOBAL'
        ? [1]
        : definition.operandKinds.length === 3
          ? [1, 2]
          : definition.name === 'MOVE' ||
              definition.family === 'unary' ||
              definition.name === 'TYPEOF' ||
              definition.name === 'VOID'
            ? [1]
            : []
  const inputs = inputIndexes.map((index) =>
    register(
      instruction.operands[index].index,
      `${instruction.name}@${instruction.pc} input ${index}`,
    ),
  )
  return { operands, destination, inputs }
}

function valueSemantics(definition, operation, constant, immediate) {
  if (definition.name === 'LOAD_CONST') {
    return {
      kind: 'known-constant',
      operation: definition.operation,
      resultType: 'constant',
      known: true,
      value: constant.value,
    }
  }
  if (definition.name === 'LOAD_INT') {
    return {
      kind: 'known-integer',
      operation: definition.operation,
      resultType: 'integer',
      known: true,
      value: immediate,
    }
  }
  if (definition.name === 'MOVE') {
    return {
      kind: 'register-copy',
      operation: definition.operation,
      resultType: 'copy',
      known: false,
      sourceRegister: operation.inputs[0],
    }
  }
  if (definition.name === 'STORE_GLOBAL') {
    return {
      kind: 'input-value',
      operation: definition.operation,
      resultType: 'no-register-result',
      known: false,
      sourceRegister: operation.inputs[0],
    }
  }
  if (definition.name === 'VOID') {
    return {
      kind: 'known-undefined',
      operation: definition.operation,
      resultType: 'undefined',
      known: true,
    }
  }
  return {
    kind: 'dynamic-operation',
    operation: definition.operation,
    resultType: definition.resultType,
    known: false,
  }
}

function makeOperation(
  instruction,
  definition,
  functionId,
  reachable,
  references,
) {
  const operation = operationShape(instruction, definition)
  const constantOperandIndex =
    definition.name === 'STORE_GLOBAL'
      ? 0
      : definition.name === 'LOAD_CONST' ||
          definition.name === 'LOAD_GLOBAL' ||
          definition.name === 'TYPEOF_SAFE'
        ? 1
        : null
  const constant =
    constantOperandIndex === null
      ? null
      : constantReference(instruction, references, constantOperandIndex)
  const immediate =
    definition.name === 'LOAD_INT' ? instruction.operands[1].value : null
  const globalReference =
    definition.name === 'LOAD_GLOBAL' ||
    definition.name === 'STORE_GLOBAL' ||
    definition.name === 'TYPEOF_SAFE'
      ? {
          kind: 'global',
          name: constant.value,
          constant: { ...constant },
        }
      : null
  const globalReads =
    definition.effect === 'global-read' ? [globalReference] : []
  const globalWrites =
    definition.effect === 'global-write' ? [globalReference] : []
  return {
    id: `scalar:${functionId}:${instruction.pc}`,
    functionId,
    pc: instruction.pc,
    reachable,
    opcode: { name: definition.name, value: definition.opcode },
    name: definition.name,
    family: definition.family,
    operands: operation.operands,
    words: instruction.words.slice(),
    width: instruction.width,
    nextPc: instruction.nextPc,
    destination: operation.destination,
    inputs: operation.inputs,
    constantReference: constant,
    globalReference,
    immediate: immediate === null ? null : { kind: 'uint32', value: immediate },
    useDef: {
      uses: operation.inputs.map((input) => ({ ...input })),
      defines: operation.destination ? { ...operation.destination } : null,
      globalReads: globalReads.map((reference) => ({ ...reference })),
      globalWrites: globalWrites.map((reference) => ({ ...reference })),
    },
    effect: {
      kind: definition.effect,
      register: operation.destination ? { ...operation.destination } : null,
      global: globalReference ? { ...globalReference } : null,
    },
    valueSemantics: valueSemantics(definition, operation, constant, immediate),
  }
}

function buildOperations(wordcode, references, functions, cfg) {
  const owners = ownerByPc(functions)
  const reachable = reachablePcs(cfg)
  const operations = []
  const seen = new Set()
  for (const instruction of wordcode.instructions) {
    const definition = I_DEFINITION_BY_NAME.get(instruction.name)
    if (!definition) {
      if (!EXCLUDED_OPCODE_NAMES.has(instruction.name)) {
        decline(
          'unsupported-opcode',
          `${instruction.name}@${instruction.pc} is outside the known pinned opcode map`,
        )
      }
      continue
    }
    const functionId = owners.get(String(instruction.pc))

    const key = `${functionId}:${instruction.pc}`
    if (seen.has(key))
      decline('duplicate-operation', `Duplicate scalar operation ${key}`)
    seen.add(key)
    operations.push(
      makeOperation(
        instruction,
        definition,
        functionId,
        reachable.has(key),
        references,
      ),
    )
  }
  const expected = wordcode.instructions.filter(({ name }) =>
    I_DEFINITION_BY_NAME.has(name),
  )
  if (operations.length !== expected.length || seen.size !== expected.length) {
    decline(
      'incomplete-scalar-census',
      `Scalar operation census has ${operations.length} records for ${expected.length} I instructions`,
    )
  }
  return operations
}

function makeRows(operations) {
  const counts = Object.fromEntries(
    I_OPCODE_DEFINITIONS.map(({ name }) => [name, 0]),
  )
  for (const operation of operations) counts[operation.name] += 1
  const rows = I_OPCODE_DEFINITIONS.map((definition) => ({
    name: definition.name,
    opcode: definition.opcode,
    family: definition.family,
    operandForm: definition.operandForm,
    operation: definition.operation,
    effect: definition.effect,
    resultType: definition.resultType,
    known: definition.known,
    count: counts[definition.name],
  }))
  if (rows.reduce((sum, row) => sum + row.count, 0) !== operations.length) {
    decline(
      'incomplete-scalar-census',
      'Scalar opcode row counts do not sum to operations',
    )
  }
  return { counts, rows }
}

function makeFunctionCensus(operations, functions) {
  return functions.functions.map((fn) => {
    const rows = operations.filter(({ functionId }) => functionId === fn.id)
    return {
      functionId: fn.id,
      startPc: fn.startPc,
      endPc: fn.endPc,
      instructionCount: fn.instructionCount,
      scalarOperationCount: rows.length,
      reachableScalarOperationCount: rows.filter(({ reachable }) => reachable)
        .length,
      unreachableScalarOperationCount: rows.filter(
        ({ reachable }) => !reachable,
      ).length,
    }
  })
}

function makeResult(wordcode, references, functions, cfg, operations) {
  const rowData = makeRows(operations)
  const expectedNames = I_OPCODE_DEFINITIONS.map(({ name }) => name)
  const operationKeys = operations.map(
    ({ functionId, pc }) => `${functionId}:${pc}`,
  )
  return deepFreeze({
    schemaVersion: SCALAR_VALUES_SCHEMA,
    encoding: 'numeric-u32',
    api: {
      analyze: 'analyzeScalarValues(wordcode, references, functions, cfg)',
      diagnose: 'diagnoseScalarValues(wordcode, references, functions, cfg)',
      returns: 'deeply frozen scalar/value IR or null',
    },
    parseOnly: true,
    targetExecution: false,
    wordCount: wordcode.wordCount,
    instructionCount: wordcode.instructionCount,
    functionCount: functions.functions.length,
    opcodeScope: {
      family: 'I-scalar-value',
      count: expectedNames.length,
      names: expectedNames,
      rows: rowData.rows,
    },
    operations,
    operationCount: operations.length,
    functionCensus: makeFunctionCensus(operations, functions),
    census: {
      expectedInstructionCount: wordcode.instructions.filter(({ name }) =>
        I_DEFINITION_BY_NAME.has(name),
      ).length,
      operationCount: operations.length,
      countsByName: rowData.counts,
      operationKeys,
      dropped: [],
      duplicated: [],
      complete: true,
    },
    reachability: {
      source: 'Packet E per-function CFG edges from each function entry',
      unreachableOperationCount: operations.filter(
        ({ reachable }) => !reachable,
      ).length,
    },
    valueState: {
      dataflow: 'not-introduced',
      mergeAgreement: 'not-applicable',
      limitation:
        'I records preserve exact use/def facts and typed operation semantics; they do not propagate register values across CFG merges.',
    },
    predecessorSchemas: {
      wordcode: WORDCODE_SCHEMA,
      references: REFERENCE_SCHEMA,
      functions: FUNCTION_SCHEMA,
      cfg: CFG_SCHEMA,
    },
    boundaryOmissions: EXCLUDED_OPCODE_GROUPS.map(({ boundary, names }) => ({
      boundary,
      names: [...names],
    })),
    proof: {
      allScalarRowsPresent: operationKeys.length === operations.length,
      allScalarRowsUnique: new Set(operationKeys).size === operationKeys.length,
      noTargetCodeExecuted: true,
    },
    inputs: {
      wordCount: wordcode.wordCount,
      instructionCount: wordcode.instructionCount,
      constantPoolSize: references.constants.poolSize,
      functionCount: functions.functions.length,
      cfgEdgeCount: cfg.edges.length,
      cfgBlockCount: cfg.functions.reduce(
        (count, fn) => count + fn.blocks.length,
        0,
      ),
    },
  })
}

function recognize(wordcode, references, functions, cfg) {
  const operations = buildOperations(wordcode, references, functions, cfg)
  return makeResult(wordcode, references, functions, cfg, operations)
}

export function diagnoseScalarValues(wordcode, references, functions, cfg) {
  try {
    const result = recognize(wordcode, references, functions, cfg)
    return deepFreeze({ ok: true, result, diagnostic: null })
  } catch (error) {
    if (error instanceof ScalarValuesDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'scalar-values-analysis-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function analyzeScalarValues(wordcode, references, functions, cfg) {
  return diagnoseScalarValues(wordcode, references, functions, cfg).result
}

export default analyzeScalarValues
