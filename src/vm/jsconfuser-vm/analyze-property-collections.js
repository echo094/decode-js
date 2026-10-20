import {
  CALL_FRAME_SCHEMA,
  CFG_SCHEMA,
  EXCLUDED_OPCODE_GROUPS,
  EXCLUDED_OPCODE_NAMES,
  FUNCTION_SCHEMA,
  J_DEFINITION_BY_NAME,
  J_OPCODE_DEFINITIONS,
  PROPERTY_COLLECTION_SCHEMA,
  PropertyCollectionsDecline,
  REFERENCE_SCHEMA,
  WORDCODE_SCHEMA,
  cloneData,
  decline,
  deepFreeze,
  destinationFor,
  evaluationOrder,
  inputIndexes,
  operandRoles,
  ownerByPc,
  reachablePcs,
  register,
  operationOperands,
} from './property-collections-operands.js'

function controlFlowFor(instruction, functionId, cfg) {
  if (instruction.name !== 'FOR_IN_SETUP' && instruction.name !== 'FOR_IN_NEXT')
    return null
  const cfgFunction = cfg.functions.find(({ id }) => id === functionId)

  const edges = cfgFunction.edges.filter(
    ({ sourcePc }) => sourcePc === instruction.pc,
  )

  if (instruction.name === 'FOR_IN_SETUP') {
    return {
      kind: 'fallthrough',
      normalTargetPc: instruction.nextPc,
      edge: cloneData(edges[0]),
    }
  }
  const exitTargetPc = instruction.operands[2].pc
  const exitEdges = edges.filter(
    ({ kind, targetPc }) => kind === 'branch' && targetPc === exitTargetPc,
  )
  const normalEdges = edges.filter(
    ({ kind, targetPc }) =>
      kind === 'fallthrough' && targetPc === instruction.nextPc,
  )

  return {
    kind: 'iterator-conditional',
    normalTargetPc: instruction.nextPc,
    exitTargetPc,
    normal: {
      condition: 'iterator has another enumerable key',
      writesDestination: true,
      incrementsIterator: true,
      edge: cloneData(normalEdges[0]),
    },
    exit: {
      condition: 'iterator is exhausted',
      writesDestination: false,
      incrementsIterator: false,
      edge: cloneData(exitEdges[0]),
    },
  }
}

function semanticClassification(name, roles, operands, controlFlow) {
  const common = {
    known: false,
    certainty: 'structural-only',
    roles: cloneData(roles),
    evaluationOrder: evaluationOrder(name, operands),
  }
  if (name === 'GET_PROP') {
    return {
      ...common,
      kind: 'property-read',
      resultType: 'dynamic',
      runtime:
        'reads object[key] through ordinary JavaScript property semantics',
      unknowns: [
        'object identity',
        'property key value',
        'property result',
        'accessor/proxy behavior',
      ],
      mayThrow: true,
    }
  }
  if (name === 'SET_PROP') {
    return {
      ...common,
      kind: 'property-write',
      resultType: 'no-register-result',
      runtime:
        'calls Reflect.set(object, key, value) and ignores its boolean result',
      unknowns: [
        'object identity',
        'property key value',
        'value',
        'setter/proxy behavior',
      ],
      mayThrow: true,
    }
  }
  if (name === 'DELETE_PROP') {
    return {
      ...common,
      kind: 'property-delete',
      resultType: 'boolean',
      runtime: 'computes delete object[key]',
      unknowns: [
        'object identity',
        'property key value',
        'deletion result',
        'proxy behavior',
      ],
      mayThrow: true,
    }
  }
  if (name === 'IN') {
    return {
      ...common,
      kind: 'membership-test',
      resultType: 'boolean',
      runtime: 'computes propertyKey in object, including the prototype chain',
      unknowns: [
        'property key value',
        'object identity',
        'membership result',
        'proxy behavior',
      ],
      mayThrow: true,
    }
  }
  if (name === 'INSTANCEOF') {
    return {
      ...common,
      kind: 'prototype-relation-test',
      resultType: 'boolean',
      runtime:
        'computes instance instanceof constructor using JavaScript prototype relation rules',
      unknowns: [
        'instance identity',
        'constructor identity',
        'prototype relation result',
        'custom hasInstance behavior',
      ],
      mayThrow: true,
    }
  }
  if (name === 'BUILD_ARRAY') {
    return {
      ...common,
      kind: 'array-construction',
      resultType: 'array',
      runtime:
        'allocates an Array(count) and writes element registers in payload order',
      count: operands[1].value,
      unknowns: ['element values', 'array identity'],
      mayThrow: false,
    }
  }
  if (name === 'BUILD_OBJECT') {
    return {
      ...common,
      kind: 'object-construction',
      resultType: 'object',
      runtime:
        'allocates an ordinary object and assigns each key/value pair in payload order',
      pairCount: operands[1].value,
      duplicateKeyBehavior:
        'later ordered assignment overwrites an earlier property',
      unknowns: [
        'object identity',
        'key values',
        'value contents',
        'prototype interactions',
      ],
      mayThrow: true,
    }
  }
  if (name === 'DEFINE_GETTER' || name === 'DEFINE_SETTER') {
    const kind = name === 'DEFINE_GETTER' ? 'getter' : 'setter'
    return {
      ...common,
      kind: `${kind}-definition`,
      resultType: 'no-register-result',
      runtime: `defines an own ${kind} with configurable=true and enumerable=true; preserves an existing opposite accessor when present`,
      accessorKind: kind,
      descriptor: {
        configurable: true,
        enumerable: true,
        preservesExistingOppositeAccessor: true,
      },
      unknowns: [
        'object identity',
        'property key value',
        'accessor function identity',
        'receiver behavior',
      ],
      mayThrow: true,
    }
  }
  if (name === 'FOR_IN_SETUP') {
    return {
      ...common,
      kind: 'for-in-setup',
      resultType: 'iterator',
      runtime:
        'collects enumerable own names across the prototype chain, de-duplicates first-seen names, and stores {_keys, i: 0}',
      setup: {
        nullishSourceProducesEmptyKeys: true,
        boxesPrimitiveSource: true,
        walksPrototypeChain: true,
        deDuplicatesNames: true,
      },
      unknowns: ['source value', 'enumerated key list', 'iterator identity'],
      mayThrow: true,
    }
  }
  return {
    ...common,
    kind: 'for-in-next',
    resultType: 'property-key-or-exit',
    runtime:
      'writes the next enumerable key and increments i, or jumps to exitTarget when exhausted',
    exitTargetPc: operands[2].pc,
    exit: controlFlow,
    unknowns: ['iterator contents', 'next key value', 'iteration count'],
    mayThrow: true,
  }
}

function effectFor(name, operands, destination, roles, semantic) {
  const registerResult = destination ? { ...destination } : null
  const reads =
    name === 'GET_PROP' || name === 'DELETE_PROP'
      ? { object: roles.object, key: roles.key }
      : name === 'SET_PROP'
        ? { object: roles.object, key: roles.key, value: roles.value }
        : name === 'IN'
          ? { propertyKey: roles.propertyKey, object: roles.object }
          : name === 'INSTANCEOF'
            ? { instance: roles.instance, constructor: roles.constructor }
            : name === 'BUILD_ARRAY'
              ? { elements: roles.elements }
              : name === 'BUILD_OBJECT'
                ? { pairs: roles.pairs }
                : name === 'DEFINE_GETTER' || name === 'DEFINE_SETTER'
                  ? {
                      object: roles.object,
                      key: roles.key,
                      accessorFunction: roles.accessorFunction,
                    }
                  : name === 'FOR_IN_SETUP'
                    ? { source: roles.source }
                    : { iterator: roles.iterator }
  const effect = {
    kind: J_DEFINITION_BY_NAME.get(name).effect,
    register: registerResult,
    resultType: semantic.resultType,
    reads,
    mutates: [
      'SET_PROP',
      'DELETE_PROP',
      'DEFINE_GETTER',
      'DEFINE_SETTER',
      'FOR_IN_NEXT',
    ].includes(name),
  }
  if (name === 'SET_PROP') effect.writesProperty = { ...roles }
  if (name === 'DELETE_PROP') effect.deletesProperty = { ...roles }
  if (name === 'DEFINE_GETTER' || name === 'DEFINE_SETTER')
    effect.definesAccessor = { ...roles }
  if (name === 'FOR_IN_SETUP') effect.createsIterator = { ...roles }
  if (name === 'FOR_IN_NEXT') effect.stepsIterator = { ...roles }
  return effect
}

function buildOperation(instruction, definition, functionId, reachable, cfg) {
  const operands = operationOperands(instruction, definition)
  const destination = destinationFor(definition.name, operands)
  const inputIndexesForOperation = inputIndexes(definition.name, operands)
  const inputs = inputIndexesForOperation.map((index) =>
    register(
      operands[index].index,
      `${definition.name}@${instruction.pc} input ${index}`,
    ),
  )
  const roles = operandRoles(definition.name, operands)
  const controlFlow = controlFlowFor(instruction, functionId, cfg)
  const semantic = semanticClassification(
    definition.name,
    roles,
    operands,
    controlFlow,
  )
  const payload =
    definition.name === 'BUILD_ARRAY'
      ? {
          kind: 'array',
          count: operands[1].value,
          elementRegisters: operands
            .slice(2)
            .map((operand) => ({ ...operand })),
        }
      : definition.name === 'BUILD_OBJECT'
        ? {
            kind: 'object',
            pairCount: operands[1].value,
            pairs: roles.pairs.map(({ pairIndex, key, value }) => ({
              pairIndex,
              key: { ...key.register },
              value: { ...value.register },
            })),
          }
        : definition.name === 'FOR_IN_NEXT'
          ? {
              kind: 'iterator-next',
              iterator: { ...operands[1] },
              exitTarget: { ...operands[2] },
            }
          : null
  return {
    id: `property-collection:${functionId}:${instruction.pc}`,
    functionId,
    pc: instruction.pc,
    reachable,
    opcode: { name: definition.name, value: definition.opcode },
    name: definition.name,
    family: definition.family,
    operandForm: definition.operandForm,
    operands,
    wordOperands: cloneData(instruction.wordOperands),
    words: instruction.words.slice(),
    width: instruction.width,
    nextPc: instruction.nextPc,
    destination,
    inputs,
    roles,
    payload,
    controlFlow,
    useDef: {
      uses: inputs.map((input) => ({ ...input })),
      defines: destination ? { ...destination } : null,
      conditionalDefine:
        definition.name === 'FOR_IN_NEXT'
          ? 'only when an enumerable key is available'
          : null,
    },
    effect: effectFor(definition.name, operands, destination, roles, semantic),
    evaluationOrder: semantic.evaluationOrder,
    semantic,
  }
}

function buildOperations(wordcode, functions, cfg) {
  const owners = ownerByPc(functions)
  const reachable = reachablePcs(cfg)
  const operations = []
  const seen = new Set()
  for (const instruction of wordcode.instructions) {
    const definition = J_DEFINITION_BY_NAME.get(instruction.name)
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
      decline('duplicate-operation', `Duplicate property operation ${key}`)
    seen.add(key)
    operations.push(
      buildOperation(
        instruction,
        definition,
        functionId,
        reachable.has(key),
        cfg,
      ),
    )
  }
  const expected = wordcode.instructions.filter(({ name }) =>
    J_DEFINITION_BY_NAME.has(name),
  )
  if (operations.length !== expected.length || seen.size !== expected.length) {
    decline(
      'incomplete-property-census',
      `Property operation census has ${operations.length} records for ${expected.length} J instructions`,
    )
  }
  return operations
}

function makeRows(operations) {
  const counts = Object.fromEntries(
    J_OPCODE_DEFINITIONS.map(({ name }) => [name, 0]),
  )
  for (const operation of operations) counts[operation.name] += 1
  const rows = J_OPCODE_DEFINITIONS.map((definition) => ({
    name: definition.name,
    opcode: definition.opcode,
    family: definition.family,
    operandForm: definition.operandForm,
    operation: definition.operation,
    effect: definition.effect,
    resultType: definition.resultType,
    known: definition.known,
    evaluationOrder: [...definition.evaluationRoles],
    width: ['BUILD_ARRAY', 'BUILD_OBJECT'].includes(definition.name)
      ? 'variable'
      : definition.name === 'FOR_IN_SETUP'
        ? 3
        : 4,
    count: counts[definition.name],
  }))
  if (rows.reduce((sum, row) => sum + row.count, 0) !== operations.length) {
    decline(
      'incomplete-property-census',
      'Property opcode row counts do not sum to operations',
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
      propertyOperationCount: rows.length,
      reachablePropertyOperationCount: rows.filter(({ reachable }) => reachable)
        .length,
      unreachablePropertyOperationCount: rows.filter(
        ({ reachable }) => !reachable,
      ).length,
    }
  })
}

function makeResult(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
  operations,
) {
  const rowData = makeRows(operations)
  const expectedNames = J_OPCODE_DEFINITIONS.map(({ name }) => name)
  const operationKeys = operations.map(
    ({ functionId, pc }) => `${functionId}:${pc}`,
  )
  return deepFreeze({
    schemaVersion: PROPERTY_COLLECTION_SCHEMA,
    encoding: 'numeric-u32',
    api: {
      analyze:
        'analyzePropertyCollections(wordcode, references, functions, cfg, callFrames)',
      diagnose:
        'diagnosePropertyCollections(wordcode, references, functions, cfg, callFrames)',
      returns: 'deeply frozen property/collection IR or null',
    },
    parseOnly: true,
    targetExecution: false,
    wordCount: wordcode.wordCount,
    instructionCount: wordcode.instructionCount,
    functionCount: functions.functions.length,
    opcodeScope: {
      family: 'J-property-collection',
      count: expectedNames.length,
      names: expectedNames,
      rows: rowData.rows,
    },
    operations,
    operationCount: operations.length,
    functionCensus: makeFunctionCensus(operations, functions),
    census: {
      expectedInstructionCount: wordcode.instructions.filter(({ name }) =>
        J_DEFINITION_BY_NAME.has(name),
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
    predecessorSchemas: {
      wordcode: WORDCODE_SCHEMA,
      references: REFERENCE_SCHEMA,
      functions: FUNCTION_SCHEMA,
      cfg: CFG_SCHEMA,
      callFrames: CALL_FRAME_SCHEMA,
    },
    predecessorInputs: {
      wordcodeSchema: WORDCODE_SCHEMA,
      referencesSchema: REFERENCE_SCHEMA,
      functionsSchema: FUNCTION_SCHEMA,
      cfgSchema: CFG_SCHEMA,
      callFramesSchema: CALL_FRAME_SCHEMA,
    },
    boundaryOmissions: EXCLUDED_OPCODE_GROUPS.map(({ boundary, names }) => ({
      boundary,
      names: [...names],
    })),
    proof: {
      allPropertyRowsPresent: operationKeys.length === operations.length,
      allPropertyRowsUnique:
        new Set(operationKeys).size === operationKeys.length,
      historicalForInNextWordOperandsPreserved: operations
        .filter(({ name }) => name === 'FOR_IN_NEXT')
        .every(
          ({ wordOperands }) =>
            wordOperands[1]?.kind === 'label-target' &&
            wordOperands[2]?.kind === 'register',
        ),
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
      callSiteCount: callFrames.callSites.length,
      returnCount: callFrames.returns.length,
      throwCount: callFrames.throws.length,
    },
  })
}

function recognize(wordcode, references, functions, cfg, callFrames) {
  const operations = buildOperations(wordcode, functions, cfg)
  return makeResult(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
    operations,
  )
}

export function diagnosePropertyCollections(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
) {
  try {
    const result = recognize(wordcode, references, functions, cfg, callFrames)
    return deepFreeze({ ok: true, result, diagnostic: null })
  } catch (error) {
    if (error instanceof PropertyCollectionsDecline) {
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
        code: 'property-collections-analysis-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function analyzePropertyCollections(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
) {
  return diagnosePropertyCollections(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  ).result
}

export default analyzePropertyCollections
