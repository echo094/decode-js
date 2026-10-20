import {
  ALL_OPCODE_NAMES,
  CALL_COMPLETION_SCHEMA,
  CALL_FRAME_SCHEMA,
  CALL_NAMES,
  CFG_SCHEMA,
  CLOSURE_LIFETIME_SCHEMA,
  COMPLETION_NAMES,
  CallCompletionDecline,
  FUNCTION_SCHEMA,
  OMITTED_OPCODE_GROUPS,
  REFERENCE_SCHEMA,
  RELEVANT_NAMES,
  WORDCODE_SCHEMA,
  callGrammar,
  cloneData,
  deepFreeze,
  functionOwner,
  instructionLeaf,
  ownerMaps,
} from './call-completion-input.js'

function readOrder(instruction, callSite, grammar) {
  const roles = []
  if (instruction.name === 'CALL_METHOD') roles.push('receiver')
  roles.push('callee', 'argument-count')
  if (grammar.kind === 'spread') {
    roles.push('spread-array')
  } else {
    for (let index = 0; index < grammar.count; index += 1)
      roles.push(`argument[${index}]`)
  }
  const registers = {
    ...(instruction.name === 'CALL_METHOD'
      ? { receiver: cloneData(callSite.receiver) }
      : {}),
    callee: cloneData(callSite.callee),
    ...(grammar.kind === 'spread'
      ? { 'spread-array': cloneData(grammar.arrayRegister) }
      : Object.fromEntries(
          grammar.registers.map((register, index) => [
            `argument[${index}]`,
            cloneData(register),
          ]),
        )),
  }
  return {
    kind: 'left-to-right-register-read',
    roles,
    steps: roles.map((role, order) => ({
      order,
      role,
      register: registers[role] ?? null,
      word:
        role === 'argument-count'
          ? instruction.words[instruction.name === 'CALL_METHOD' ? 4 : 3]
          : null,
    })),
    caveat:
      'This records compiler/runtime register-read order; property access, coercion, getters, proxies, and final JavaScript semantics remain later-packet facts.',
  }
}

function targetDescription(callSite, closureLifetimes) {
  const internal = callSite.calleeFunctions.length > 0
  const closureSites = internal
    ? closureLifetimes.closureSites
        .filter((site) =>
          callSite.calleeFunctions.includes(site.childFunctionId),
        )
        .map((site) => ({
          id: site.id,
          creationPc: site.creationPc,
          parentFunctionId: site.parentFunctionId,
          childFunctionId: site.childFunctionId,
          childStartPc: site.childStartPc,
        }))
    : []
  return {
    kind: internal ? 'internal-closure' : 'host-or-dynamic',
    functionIds: [...callSite.calleeFunctions],
    closureSiteIds: closureSites.map(({ id }) => id),
    closureSites,
    certainty: internal ? 'statically-proven-by-packet-f' : 'not-invented',
  }
}

function normalCallRoute(callSite) {
  return {
    kind: 'call',
    sourcePc: callSite.pc,
    targetPc: callSite.continuationPc,
    route: 'normal',
    mode: 'direct',
    callSitePc: callSite.pc,
    continuationPc: callSite.continuationPc,
    payload: {
      returnDestination: cloneData(callSite.returnDestination),
    },
  }
}

function callRecord(instruction, callSite, owner, reachable, closureLifetimes) {
  const grammar = callGrammar(instruction, callSite)
  const target = targetDescription(callSite, closureLifetimes)
  const isMethod = instruction.name === 'CALL_METHOD'
  const isConstructor = instruction.name === 'NEW'
  return {
    id: `call:${owner.functionId}:${instruction.pc}`,
    functionId: owner.functionId,
    pc: instruction.pc,
    name: instruction.name,
    opcode: cloneData(instruction.opcode),
    words: [...instruction.words],
    width: instruction.width,
    nextPc: instruction.nextPc,
    reachable,
    destination: cloneData(callSite.destination),
    callee: cloneData(callSite.callee),
    receiver: cloneData(callSite.receiver),
    receiverPreservation: isMethod
      ? {
          kind: 'call-method-this-argument',
          register: cloneData(callSite.receiver),
          preservedThrough: 'CALL_METHOD',
        }
      : { kind: 'none' },
    target,
    callMode: target.kind,
    constructorState: cloneData(callSite.constructorState),
    construction: isConstructor
      ? {
          kind: 'new-construction',
          allocationMode: callSite.constructorState.mode,
          returnRule: 'explicit-object-or-allocated-this',
          semanticBoundary: 'later-packet',
        }
      : {
          kind: 'ordinary-call',
          thisMode: isMethod ? 'receiver-register' : 'null-or-host-default',
          semanticBoundary: 'later-packet',
        },
    arguments: cloneData(callSite.arguments),
    grammar,
    evaluationOrder: readOrder(instruction, callSite, grammar),
    continuationPc: callSite.continuationPc,
    returnDestination: cloneData(callSite.returnDestination),
    completion: {
      normal: normalCallRoute(callSite),
      exceptional: cloneData(callSite.exceptionalCompletion),
    },
    cfg: cloneData(callSite.cfg),
    semanticBoundary: 'later-packet',
  }
}

function completionRouteRecords(callFrames, ownerByPc) {
  return callFrames.completionRoutes.map((route, index) => {
    const functionId = ownerByPc.get(route.sourcePc)

    return {
      id: `completion:${functionId}:${route.sourcePc}:${index}`,
      functionId,
      ...cloneData(route),
      semanticBoundary: 'later-packet',
    }
  })
}

function completionRecord(instruction, record, owner, reachable, routeRecords) {
  const routes = routeRecords.filter(
    ({ sourcePc, functionId }) =>
      sourcePc === instruction.pc && functionId === owner.functionId,
  )
  return {
    id: `${instruction.name.toLowerCase()}:${owner.functionId}:${instruction.pc}`,
    functionId: owner.functionId,
    pc: instruction.pc,
    name: instruction.name,
    opcode: cloneData(instruction.opcode),
    words: [...instruction.words],
    width: instruction.width,
    nextPc: instruction.nextPc,
    reachable,
    sourceRegister: cloneData(record.sourceRegister),
    payloadRegister: cloneData(record.payloadRegister),
    callerDestinations: cloneData(record.callerDestinations),
    routes: cloneData(record.routes),
    routeRecordIds: routes.map(({ id }) => id),
    constructorCallers: (record.callerDestinations ?? [])
      .filter(({ constructorState }) => constructorState?.isConstructor)
      .map((destination) => ({
        callSitePc: destination.callSitePc,
        callerFunctionId: destination.callerFunctionId,
        constructorState: cloneData(destination.constructorState),
      })),
    semanticBoundary: 'later-packet',
  }
}

function functionOwnerFacts(functions, closureLifetimes) {
  const sitesByParent = new Map()
  for (const site of closureLifetimes.closureSites) {
    const sites = sitesByParent.get(site.parentFunctionId) ?? []
    sites.push(site.id)
    sitesByParent.set(site.parentFunctionId, sites)
  }
  return functions.functions.map((fn) => ({
    functionId: fn.id,
    kind: fn.kind,
    startPc: fn.startPc,
    endPc: fn.endPc,
    parentFunctionId: fn.parentFunctionId,
    instructionPcs: [...fn.instructionPcs],
    closureSiteIds: sitesByParent.get(fn.id) ?? [],
    semanticBoundary: 'later-packet',
  }))
}

function makeCensus(wordcode, calls, returns, throws, routes, instructions) {
  const countsByName = Object.fromEntries(
    ALL_OPCODE_NAMES.map((name) => [name, 0]),
  )
  for (const instruction of instructions) countsByName[instruction.name] += 1
  const relevant = instructions.filter(({ name }) => RELEVANT_NAMES.has(name))
  const keys = relevant.map(({ functionId, pc }) => `${functionId}:${pc}`)
  const callKeys = calls.map(({ functionId, pc }) => `${functionId}:${pc}`)
  const completionKeys = [...returns, ...throws].map(
    ({ functionId, pc }) => `${functionId}:${pc}`,
  )
  return {
    expectedInstructionCount: wordcode.instructions.length,
    emittedInstructionCount: instructions.length,
    countsByName,
    relevantInstructionCount: relevant.length,
    callCount: calls.length,
    returnCount: returns.length,
    throwCount: throws.length,
    completionRouteCount: routes.length,
    operationKeys: keys,
    callKeys,
    completionKeys,
    dropped: [],
    duplicated: [],
    complete:
      instructions.length === wordcode.instructions.length &&
      new Set(keys).size === keys.length,
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

function recognize(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
  closureLifetimes,
) {
  const data = {
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
    closureLifetimes,
  }
  const maps = ownerMaps(data.functions, data.cfg)
  const instructions = data.wordcode.instructions.map((instruction) => {
    const functionId = maps.ownerByPc.get(instruction.pc)

    return instructionLeaf(
      instruction,
      functionId,
      maps.reachable.has(`${functionId}:${instruction.pc}`),
    )
  })
  const instructionByPc = new Map(
    data.wordcode.instructions.map((instruction) => [
      instruction.pc,
      instruction,
    ]),
  )
  const callSitesByPc = new Map(
    data.callFrames.callSites.map((callSite) => [callSite.pc, callSite]),
  )
  const calls = instructions
    .filter(({ name }) => CALL_NAMES.has(name))
    .map((leaf) => {
      const instruction = instructionByPc.get(leaf.pc)
      const owner = functionOwner(
        leaf.functionId,
        maps.functionById,
        `${leaf.name}@${leaf.pc}`,
      )
      return callRecord(
        instruction,
        callSitesByPc.get(leaf.pc),
        owner,
        leaf.reachable,
        data.closureLifetimes,
      )
    })
  const routeRecords = completionRouteRecords(data.callFrames, maps.ownerByPc)
  const returnsByPc = new Map(
    data.callFrames.returns.map((record) => [record.pc, record]),
  )
  const throwsByPc = new Map(
    data.callFrames.throws.map((record) => [record.pc, record]),
  )
  const returns = instructions
    .filter(({ name }) => name === 'RETURN')
    .map((leaf) =>
      completionRecord(
        instructionByPc.get(leaf.pc),
        returnsByPc.get(leaf.pc),
        functionOwner(leaf.functionId, maps.functionById, `RETURN@${leaf.pc}`),
        leaf.reachable,
        routeRecords,
      ),
    )
  const throws = instructions
    .filter(({ name }) => name === 'THROW')
    .map((leaf) =>
      completionRecord(
        instructionByPc.get(leaf.pc),
        throwsByPc.get(leaf.pc),
        functionOwner(leaf.functionId, maps.functionById, `THROW@${leaf.pc}`),
        leaf.reachable,
        routeRecords,
      ),
    )
  const callKeys = calls.map(({ functionId, pc }) => `${functionId}:${pc}`)
  const completionKeys = [...returns, ...throws].map(
    ({ functionId, pc }) => `${functionId}:${pc}`,
  )
  const census = makeCensus(
    data.wordcode,
    calls,
    returns,
    throws,
    routeRecords,
    instructions,
  )
  return deepFreeze({
    schemaVersion: CALL_COMPLETION_SCHEMA,
    encoding: 'numeric-u32',
    api: {
      emit: 'emitCallCompletion(wordcode, references, functions, cfg, callFrames, closureLifetimes)',
      diagnose:
        'diagnoseCallCompletion(wordcode, references, functions, cfg, callFrames, closureLifetimes)',
      returns: 'deeply frozen parse-only call/completion emission IR or null',
    },
    parseOnly: true,
    targetExecution: false,
    emittedJavaScript: false,
    vmExecuted: false,
    finalJavaScriptSemantics: false,
    semanticBoundary: 'later-packet',
    wordCount: data.wordcode.wordCount,
    instructionCount: data.wordcode.instructionCount,
    functionCount: data.functions.functions.length,
    opcodeScope: {
      family: 'L-call-receiver-construction-completion',
      names: [...RELEVANT_NAMES],
      count: RELEVANT_NAMES.size,
    },
    instructions,
    calls,
    returns,
    throws,
    completionRoutes: routeRecords,
    frame: cloneData(data.callFrames.frame),
    frames: cloneData(data.callFrames.frames),
    ownerFacts: functionOwnerFacts(data.functions, data.closureLifetimes),
    closureLifetimes: cloneData(data.closureLifetimes),
    coverage: {
      instructions: coverage(
        data.wordcode.instructions.length,
        instructions.length,
        instructions.map(({ functionId, pc }) => `${functionId}:${pc}`),
      ),
      calls: coverage(
        data.wordcode.instructions.filter(({ name }) => CALL_NAMES.has(name))
          .length,
        calls.length,
        callKeys,
      ),
      completions: coverage(
        data.wordcode.instructions.filter(({ name }) =>
          COMPLETION_NAMES.has(name),
        ).length,
        returns.length + throws.length,
        completionKeys,
      ),
      completionRoutes: coverage(
        data.callFrames.completionRoutes.length,
        routeRecords.length,
        routeRecords.map(({ id }) => id),
      ),
    },
    census,
    boundaryOmissions: OMITTED_OPCODE_GROUPS.map(({ boundary, names }) => ({
      boundary,
      names: [...names],
    })),
    predecessorSchemas: {
      wordcode: WORDCODE_SCHEMA,
      references: REFERENCE_SCHEMA,
      functions: FUNCTION_SCHEMA,
      cfg: CFG_SCHEMA,
      callFrames: CALL_FRAME_SCHEMA,
      closureLifetimes: CLOSURE_LIFETIME_SCHEMA,
    },
    proof: {
      allCallRowsPresent:
        calls.length ===
        data.wordcode.instructions.filter(({ name }) => CALL_NAMES.has(name))
          .length,
      allCompletionRowsPresent:
        returns.length + throws.length ===
        data.wordcode.instructions.filter(({ name }) =>
          COMPLETION_NAMES.has(name),
        ).length,
      allRouteRowsPresent:
        routeRecords.length === data.callFrames.completionRoutes.length,
      allInstructionRowsUnique:
        new Set(instructions.map(({ functionId, pc }) => `${functionId}:${pc}`))
          .size === instructions.length,
      closureLifetimeAndOwnerFactsCarried: true,
      noTargetCodeExecuted: true,
      noFinalJavaScriptEmitted: true,
    },
    inputs: {
      wordCount: data.wordcode.wordCount,
      instructionCount: data.wordcode.instructionCount,
      functionCount: data.functions.functions.length,
      cfgEdgeCount: data.cfg.edges.length,
      cfgBlockCount: data.cfg.functions.reduce(
        (count, fn) => count + fn.blocks.length,
        0,
      ),
      callSiteCount: data.callFrames.callSites.length,
      returnCount: data.callFrames.returns.length,
      throwCount: data.callFrames.throws.length,
      closureSiteCount: data.closureLifetimes.closureSites.length,
      bindingCount: data.closureLifetimes.bindings.length,
    },
  })
}

export function diagnoseCallCompletion(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
  closureLifetimes,
) {
  try {
    return deepFreeze({
      ok: true,
      result: recognize(
        wordcode,
        references,
        functions,
        cfg,
        callFrames,
        closureLifetimes,
      ),
      diagnostic: null,
    })
  } catch (error) {
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof CallCompletionDecline
            ? error.code
            : 'call-completion-analysis-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function emitCallCompletion(
  wordcode,
  references,
  functions,
  cfg,
  callFrames,
  closureLifetimes,
) {
  return diagnoseCallCompletion(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
    closureLifetimes,
  ).result
}

export default emitCallCompletion
