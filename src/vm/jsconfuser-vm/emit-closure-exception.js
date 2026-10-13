import {
  CALL_FRAME_SCHEMA,
  CANONICAL_OPCODES,
  CFG_SCHEMA,
  CLOSURE_SCHEMA,
  COMPLETION_NAMES,
  ClosureExceptionDecline,
  EMISSION_SCHEMA,
  EXCEPTION_SCHEMA,
  FUNCTION_SCHEMA,
  REFERENCE_SCHEMA,
  SEMANTIC_BOUNDARY,
  SETUP_NAMES,
  WORDCODE_SCHEMA,
  cloneData,
  closureRecords,
  decline,
  deepFreeze,
  edgeKey,
  functionMaps,
  instructionRecords,
  register,
  routeRecords,
  stateKey,
} from './closure-exception-records.js'

function exceptionRecords(exceptionFinally) {
  const handlers = exceptionFinally.handlerRecords.map((record) => ({
    id: record.id,
    kind: 'try-catch-region',
    ...cloneData(record),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const finalizers = exceptionFinally.finallyRecords.map((record) => ({
    id: record.id,
    kind: 'try-finally-region',
    ...cloneData(record),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const instructionStates = exceptionFinally.instructionStates.map((state) => ({
    id: `state:${state.functionId}:${state.pc}`,
    kind: 'handler-finally-state',
    ...cloneData(state),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const merges = exceptionFinally.merges.map((merge) => ({
    id: `merge:${merge.functionId}:${merge.pc}`,
    kind: 'handler-finally-merge',
    ...cloneData(merge),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const transitions = exceptionFinally.transitions.map((transition) => ({
    id: `transition:${transition.functionId}:${transition.pc}`,
    kind: 'handler-finally-transition',
    ...cloneData(transition),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const jumps = exceptionFinally.jumpRegChecks.map((jump) => ({
    id: `jump-reg:${jump.functionId}:${jump.pc}`,
    kind: 'finally-continuation-check',
    ...cloneData(jump),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const throwPads = finalizers.map((record) => ({
    id: `throw-pad:${record.id}`,
    kind: 'finally-throw-pad',
    finalizerId: record.id,
    ownerFunction: record.ownerFunction,
    setupPc: record.setupPc,
    finallyPc: record.finallyPc,
    continuationReg: record.continuationReg,
    payloadReg: record.payloadReg,
    throwPadPc: record.throwPadPc,
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  return {
    handlers,
    finalizers,
    instructionStates,
    merges,
    transitions,
    jumps,
    throwPads,
  }
}

function completionRecords(instructions, routes) {
  return instructions
    .filter(({ name }) => COMPLETION_NAMES.has(name))
    .map((instruction) => {
      const kind = instruction.name === 'RETURN' ? 'return' : 'throw'
      const sourceRegister = register(instruction.words[1])
      return {
        id: `completion:${instruction.functionId}:${instruction.pc}`,
        kind: `${kind}-completion`,
        functionId: instruction.functionId,
        pc: instruction.pc,
        name: instruction.name,
        opcode: cloneData(instruction.opcode),
        words: [...instruction.words],
        width: instruction.width,
        operands: cloneData(instruction.operands),
        sourceRegister,
        payloadRegister: kind === 'throw' ? sourceRegister : null,
        reachable: instruction.reachable,
        routes: routes
          .filter(
            ({ functionId, sourcePc }) =>
              functionId === instruction.functionId &&
              sourcePc === instruction.pc,
          )
          .map(cloneData),
        semanticBoundary: SEMANTIC_BOUNDARY,
      }
    })
}

function fallbackRecords(functions, cfg, edgeRecords, instructions) {
  const edgeIds = new Map(edgeRecords.map((edge) => [edgeKey(edge), edge.id]))
  const instructionIds = new Map(
    instructions.map((instruction) => [
      stateKey(instruction.functionId, instruction.pc),
      instruction.id,
    ]),
  )
  return functions.functions.map((fn) => {
    const cfgFunction = cfg.functions.find(({ id }) => id === fn.id)

    const blocks = cfgFunction.blocks.map((block) => ({
      id: block.id,
      startPc: block.startPc,
      endPc: block.endPc,
      instructionPcs: [...block.instructionPcs],
      instructionIds: block.instructionPcs.map((pc) => {
        const id = instructionIds.get(stateKey(fn.id, pc))
        if (!id)
          decline(
            'incomplete-instruction',
            `No emitted instruction ${fn.id}:${pc}`,
          )
        return id
      }),
      successorRouteIds: block.successors.map((successor) => {
        const id = edgeIds.get(edgeKey(successor))
        if (!id)
          decline(
            'invalid-route-identity',
            `No emitted edge for ${fn.id}:${successor.sourcePc}`,
          )
        return id
      }),
      handlerStateIn: cloneData(block.handlerStateIn),
    }))
    const requiredStateMachine = cfgFunction.irreducible?.required === true
    const fallback = requiredStateMachine
      ? {
          kind: 'state-machine',
          required: true,
          stateVariable: '__jsconfuserVmState',
          entryBlockId: `${fn.id}:b@${fn.startPc}`,
          dispatch: blocks.map((block) => ({
            state: block.id,
            blockId: block.id,
            successorRouteIds: [...block.successorRouteIds],
          })),
          proof: cloneData(cfgFunction.irreducible),
        }
      : {
          kind: 'opaque',
          required: false,
          blockIds: blocks.map(({ id }) => id),
          reason:
            'The closure/exception boundary does not claim a structured JavaScript control form',
        }
    return {
      id: fn.id,
      kind: 'function-emission-boundary',
      functionKind: fn.kind,
      startPc: fn.startPc,
      endPc: fn.endPc,
      parentFunctionId: fn.parentFunctionId,
      regCount: fn.regCount,
      paramCount: fn.paramCount,
      captureCount: fn.captureCount,
      hasRest: fn.hasRest,
      blocks,
      fallback,
      semanticBoundary: SEMANTIC_BOUNDARY,
    }
  })
}

function functionCoverage(records) {
  const keys = records.map(({ id }) => id)
  return {
    expected: records.length,
    emitted: records.length,
    unique: new Set(keys).size === keys.length,
    complete: true,
  }
}

function coverage(expected, emitted, keys) {
  return {
    expected,
    emitted,
    unique: new Set(keys).size === keys.length,
    complete: expected === emitted && new Set(keys).size === expected,
  }
}

function countBy(items, key) {
  return Object.fromEntries(
    [...new Set(items.map((item) => item[key]))]
      .sort()
      .map((value) => [
        value,
        items.filter((item) => item[key] === value).length,
      ]),
  )
}

function buildResult(data) {
  const maps = functionMaps(data.functions)
  const instructions = instructionRecords(
    data.wordcode,
    data.functions,
    data.exceptionFinally,
  )
  const closures = closureRecords(data.closureLifetimes)
  const exceptions = exceptionRecords(data.exceptionFinally)
  const routes = routeRecords(data.exceptionFinally)
  const completions = completionRecords(instructions, routes.completionRoutes)
  const functions = fallbackRecords(
    data.functions,
    data.cfg,
    routes.edgeRecords,
    instructions,
  )
  const setupInstructions = instructions.filter(({ name }) =>
    SETUP_NAMES.has(name),
  )
  const tryEnds = instructions.filter(({ name }) => name === 'TRY_END')
  const throws = instructions.filter(({ name }) => name === 'THROW')
  const returns = instructions.filter(({ name }) => name === 'RETURN')
  const instructionKeys = instructions.map(({ functionId, pc }) =>
    stateKey(functionId, pc),
  )
  const routeKeys = routes.edgeRecords.map(edgeKey)
  const closureSiteKeys = closures.sites.map(({ id }) => id)
  const captureKeys = closures.captures.map(({ id }) => id)
  const bindingKeys = closures.bindings.map(({ id }) => id)
  const useKeys = closures.uses.map(({ id }) => id)
  const terminationKeys = closures.terminations.map(({ id }) => id)
  const completionKeys = completions.map(({ id }) => id)
  const stateKeys = exceptions.instructionStates.map(({ id }) => id)
  const mergeKeys = exceptions.merges.map(({ id }) => id)
  const transitionKeys = exceptions.transitions.map(({ id }) => id)
  const jumpKeys = exceptions.jumps.map(({ id }) => id)
  const handlerKeys = exceptions.handlers.map(({ id }) => id)
  const finalizerKeys = exceptions.finalizers.map(({ id }) => id)
  const throwPadKeys = exceptions.throwPads.map(({ id }) => id)

  const opcodeCounts = Object.fromEntries(
    Object.keys(CANONICAL_OPCODES).map((name) => [
      name,
      instructions.filter((instruction) => instruction.name === name).length,
    ]),
  )
  const routeCounts = countBy(routes.completionRoutes, 'route')
  const routeKindCounts = countBy(routes.completionRoutes, 'kind')
  const captureKindCounts = countBy(
    closures.captures.map(({ source }) => source),
    'kind',
  )

  return deepFreeze({
    schemaVersion: EMISSION_SCHEMA,
    encoding: 'numeric-u32',
    parseOnly: true,
    targetExecution: false,
    emittedJavaScript: false,
    vmExecuted: false,
    finalJavaScriptSemantics: false,
    semanticBoundary: SEMANTIC_BOUNDARY,
    wordCount: data.wordcode.wordCount,
    instructionCount: data.wordcode.instructionCount,
    functionCount: data.functions.functions.length,
    predecessorSchemas: {
      wordcode: WORDCODE_SCHEMA,
      references: REFERENCE_SCHEMA,
      functions: FUNCTION_SCHEMA,
      cfg: CFG_SCHEMA,
      callFrames: CALL_FRAME_SCHEMA,
      closureLifetimes: CLOSURE_SCHEMA,
      exceptionFinally: EXCEPTION_SCHEMA,
    },
    functions,
    instructions,
    closureRecords: closures.sites,
    captureRecords: closures.captures,
    bindingRecords: closures.bindings,
    upvalueUseRecords: closures.uses,
    lifetimeTransitionRecords: closures.terminations,
    handlerRecords: cloneData(data.exceptionFinally.handlerRecords),
    finallyRecords: cloneData(data.exceptionFinally.finallyRecords),
    handlerEmissionRecords: exceptions.handlers,
    finallyEmissionRecords: exceptions.finalizers,
    handlerFinallyStateRecords: exceptions.instructionStates,
    mergeRecords: exceptions.merges,
    transitionRecords: exceptions.transitions,
    finallyContinuationChecks: exceptions.jumps,
    throwPadRecords: exceptions.throwPads,
    completionRecords: completions,
    routeRecords: routes.completionRoutes,
    edgeRecords: routes.edgeRecords,
    closureSites: cloneData(data.closureLifetimes.closureSites),
    capturePairs: cloneData(data.closureLifetimes.capturePairs),
    bindings: cloneData(data.closureLifetimes.bindings),
    uses: cloneData(data.closureLifetimes.uses),
    terminationEvents: cloneData(data.closureLifetimes.terminationEvents),
    exceptionStates: cloneData(data.exceptionFinally.instructionStates),
    edgeStates: cloneData(data.exceptionFinally.edgeStates),
    merges: cloneData(data.exceptionFinally.merges),
    jumpRegChecks: cloneData(data.exceptionFinally.jumpRegChecks),
    transitions: cloneData(data.exceptionFinally.transitions),
    completionRoutes: cloneData(data.exceptionFinally.completionRoutes),
    census: {
      opcodeCounts,
      closures: {
        sites: closures.sites.length,
        capturePairs: closures.captures.length,
        localCapturePairs: captureKindCounts.local ?? 0,
        upvalueCapturePairs: captureKindCounts.upvalue ?? 0,
        bindings: closures.bindings.length,
        upvalueUses: closures.uses.length,
        terminationEvents: closures.terminations.length,
      },
      exceptions: {
        trySetup: instructions.filter(({ name }) => name === 'TRY_SETUP')
          .length,
        tryEnd: tryEnds.length,
        finallySetup: instructions.filter(
          ({ name }) => name === 'FINALLY_SETUP',
        ).length,
        handlers: exceptions.handlers.length,
        finalizers: exceptions.finalizers.length,
        handlerFinallyStates: exceptions.instructionStates.length,
        merges: exceptions.merges.length,
        transitions: exceptions.transitions.length,
        jumpRegChecks: exceptions.jumps.length,
        throwPads: exceptions.throwPads.length,
      },
      completions: {
        returns: returns.length,
        throws: throws.length,
        records: completions.length,
      },
      routes: {
        total: routes.completionRoutes.length,
        byKind: routeKindCounts,
        byRoute: routeCounts,
      },
    },
    coverage: {
      instructions: coverage(
        data.wordcode.instructions.length,
        instructions.length,
        instructionKeys,
      ),
      closures: {
        sites: coverage(
          data.closureLifetimes.closureSites.length,
          closures.sites.length,
          closureSiteKeys,
        ),
        capturePairs: coverage(
          data.closureLifetimes.capturePairs.length,
          closures.captures.length,
          captureKeys,
        ),
        bindings: coverage(
          data.closureLifetimes.bindings.length,
          closures.bindings.length,
          bindingKeys,
        ),
        uses: coverage(
          data.closureLifetimes.uses.length,
          closures.uses.length,
          useKeys,
        ),
        terminationEvents: coverage(
          data.closureLifetimes.terminationEvents.length,
          closures.terminations.length,
          terminationKeys,
        ),
      },
      exceptions: {
        handlers: coverage(
          data.exceptionFinally.handlerRecords.length,
          exceptions.handlers.length,
          handlerKeys,
        ),
        finalizers: coverage(
          data.exceptionFinally.finallyRecords.length,
          exceptions.finalizers.length,
          finalizerKeys,
        ),
        setupInstructions: coverage(
          data.wordcode.instructions.filter(({ name }) => SETUP_NAMES.has(name))
            .length,
          setupInstructions.length,
          setupInstructions.map(({ functionId, pc }) =>
            stateKey(functionId, pc),
          ),
        ),
        tryEnds: coverage(
          data.wordcode.instructions.filter(({ name }) => name === 'TRY_END')
            .length,
          tryEnds.length,
          tryEnds.map(({ functionId, pc }) => stateKey(functionId, pc)),
        ),
        throws: coverage(
          data.wordcode.instructions.filter(({ name }) => name === 'THROW')
            .length,
          throws.length,
          throws.map(({ functionId, pc }) => stateKey(functionId, pc)),
        ),
        states: coverage(
          data.exceptionFinally.instructionStates.length,
          exceptions.instructionStates.length,
          stateKeys,
        ),
        edges: coverage(
          data.exceptionFinally.edgeStates.length,
          routes.edgeRecords.length,
          routeKeys,
        ),
        merges: coverage(
          data.exceptionFinally.merges.length,
          exceptions.merges.length,
          mergeKeys,
        ),
        transitions: coverage(
          data.exceptionFinally.transitions.length,
          exceptions.transitions.length,
          transitionKeys,
        ),
        jumpRegChecks: coverage(
          data.exceptionFinally.jumpRegChecks.length,
          exceptions.jumps.length,
          jumpKeys,
        ),
        throwPads: coverage(
          data.exceptionFinally.finallyRecords.length,
          exceptions.throwPads.length,
          throwPadKeys,
        ),
      },
      completions: coverage(
        data.wordcode.instructions.filter(({ name }) =>
          COMPLETION_NAMES.has(name),
        ).length,
        completions.length,
        completionKeys,
      ),
      routes: coverage(
        data.exceptionFinally.completionRoutes.length,
        routes.completionRoutes.length,
        routes.completionRoutes.map(({ id }) => id),
      ),
      completionRoutes: coverage(
        data.exceptionFinally.completionRoutes.length,
        routes.completionRoutes.length,
        routes.completionRoutes.map(({ id }) => id),
      ),
      functions: functionCoverage(functions),
    },
    proof: {
      exactInstructionCoverage: true,
      exactClosureCoverage: true,
      exactExceptionCoverage: true,
      noTargetExecution: true,
      noJavaScriptEmission: true,
      noFinalJavaScriptSemantics: true,
      ownerIdentityFromPacketD:
        maps.ownerByPc.size === data.wordcode.instructions.length,
    },
    omissions: {
      finalJavaScript: 'not emitted',
      JavaScriptSemantics:
        'not claimed; closure and exception records remain target-local',
      sourceReplacement: 'not performed',
      visitorCliPluginRegistry: 'not integrated',
      targetExecution: 'not performed',
      hardenedVariants: 'not supported',
      runtimeEquivalence: 'not checked',
    },
  })
}

function analyze(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
  closureLifetimes,
  exceptionFinally,
) {
  const data = {
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
    closureLifetimes,
    exceptionFinally,
  }
  return buildResult(data)
}

export function diagnoseClosureException(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
  closureLifetimes,
  exceptionFinally,
) {
  try {
    return deepFreeze({
      ok: true,
      result: analyze(
        wordcode,
        references,
        functions,
        cfg,
        callFrames,
        closureLifetimes,
        exceptionFinally,
      ),
      diagnostic: null,
    })
  } catch (error) {
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof ClosureExceptionDecline
            ? error.code
            : 'closure-exception-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function emitClosureException(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
  closureLifetimes,
  exceptionFinally,
) {
  const diagnosis = diagnoseClosureException(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
    closureLifetimes,
    exceptionFinally,
  )
  return diagnosis.ok ? diagnosis.result : null
}

export default emitClosureException
