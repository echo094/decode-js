import { indexWordcode } from './wordcode-index.js'
import {
  CFG_SCHEMA,
  CfgDecline,
  FUNCTION_SCHEMA,
  REFERENCE_SCHEMA,
  TERMINATOR_NAMES,
  WORDCODE_SCHEMA,
  decline,
  deepFreeze,
  sameArray,
} from './build-cfg-wordcode.js'
import { indexFunctions, indexReferences } from './build-cfg-preflight.js'
import {
  destinationRegister,
  makeHandlerRecords,
  recordView,
  solveStacks,
  stateView,
  validateRegisterRanges,
} from './build-cfg-edges.js'

function emptyDataState(regCount) {
  return Array.from({ length: regCount }, () => ({
    values: new Set(),
    unknown: true,
    origins: new Map(),
  }))
}

function cloneDataCell(cell) {
  return {
    values: new Set(cell.values),
    unknown: cell.unknown,
    origins: new Map(
      [...cell.origins].map(([value, origins]) => [value, new Set(origins)]),
    ),
  }
}

function cloneDataState(state) {
  return state.map(cloneDataCell)
}

function mergeDataCell(left, right) {
  const merged = cloneDataCell(left)
  merged.unknown = merged.unknown || right.unknown
  for (const value of right.values) merged.values.add(value)
  for (const [value, origins] of right.origins) {
    const mergedOrigins = merged.origins.get(value) ?? new Set()
    for (const origin of origins) mergedOrigins.add(origin)
    merged.origins.set(value, mergedOrigins)
  }
  return merged
}

function mergeDataState(left, right) {
  return left.map((cell, index) => mergeDataCell(cell, right[index]))
}

function sameDataState(left, right) {
  if (left.length !== right.length) return false
  return left.every((cell, index) => {
    const other = right[index]
    if (
      cell.unknown !== other.unknown ||
      cell.values.size !== other.values.size
    )
      return false
    for (const value of cell.values) if (!other.values.has(value)) return false
    if (cell.origins.size !== other.origins.size) return false
    for (const [value, origins] of cell.origins) {
      const otherOrigins = other.origins.get(value)
      if (!otherOrigins || origins.size !== otherOrigins.size) return false
      for (const origin of origins) if (!otherOrigins.has(origin)) return false
    }
    return true
  })
}

function writeUnknown(state, register) {
  state[register] = { values: new Set(), unknown: true, origins: new Map() }
}

function writeSingleton(state, register, value, origin) {
  state[register] = {
    values: new Set([value]),
    unknown: false,
    origins: new Map([[value, new Set([origin])]]),
  }
}

function transferData(instruction, state) {
  const next = cloneDataState(state)
  const destination = destinationRegister(instruction)
  if (instruction.name === 'LOAD_INT') {
    writeSingleton(next, destination, instruction.words[2], instruction.pc)
  } else if (instruction.name === 'MOVE') {
    next[destination] = cloneDataCell(next[instruction.words[2]])
  } else if (destination !== null) {
    writeUnknown(next, destination)
  }
  return next
}

function applyExtraWrites(state, writes) {
  const next = cloneDataState(state)
  for (const write of writes) {
    if (write.kind === 'singleton')
      writeSingleton(next, write.register, write.value, write.origin)
    else if (write.kind === 'unknown') writeUnknown(next, write.register)
    else
      decline(
        'invalid-dataflow-write',
        `Unknown data-flow write kind ${write.kind}`,
      )
  }
  return next
}

function solveRegisterData(fn, stackResult, wordcodeData) {
  const inStates = new Map([[fn.startPc, emptyDataState(fn.regCount)]])
  const queue = [fn.startPc]
  const bySource = new Map()
  for (const edge of stackResult.edges) {
    const list = bySource.get(edge.sourcePc) ?? []
    list.push(edge)
    bySource.set(edge.sourcePc, list)
  }

  while (queue.length) {
    const pc = queue.shift()
    const instruction = wordcodeData.byPc.get(pc)
    const output = transferData(instruction, inStates.get(pc))
    for (const edge of bySource.get(pc) ?? []) {
      if (edge.targetPc === null) continue
      const next = applyExtraWrites(output, edge.extraWrites)
      const prior = inStates.get(edge.targetPc)
      const merged = prior ? mergeDataState(prior, next) : next
      if (!prior || !sameDataState(prior, merged)) {
        inStates.set(edge.targetPc, merged)
        queue.push(edge.targetPc)
      }
    }
  }

  const jumps = []
  for (const instruction of fn.instructionPcs
    .map((pc) => wordcodeData.byPc.get(pc))
    .filter((item) => item.name === 'JUMP_REG')) {
    const state = inStates.get(instruction.pc)
    if (!state)
      decline(
        'unresolved-jump-reg',
        `Function ${fn.id}: JUMP_REG@${instruction.pc} is unreachable`,
      )
    const source = state[instruction.words[1]]
    if (!source || source.unknown || source.values.size === 0) {
      decline(
        'unresolved-jump-reg',
        `Function ${fn.id}: JUMP_REG@${instruction.pc} has no finite known target set`,
      )
    }
    const targets = [...source.values].sort((left, right) => left - right)
    const origins = {}
    for (const target of targets) {
      origins[target] = [...(source.origins.get(target) ?? [])]
        .map(String)
        .sort()
    }
    jumps.push({
      pc: instruction.pc,
      sourceRegister: instruction.words[1],
      targets,
      origins,
    })
  }
  return { inStates, jumps }
}

function sameJumpMap(left, right) {
  const keys = new Set([...left.keys(), ...right.keys()])
  for (const key of keys) {
    if (!sameArray(left.get(key) ?? [], right.get(key) ?? [])) return false
  }
  return true
}

function solveControlFlow(
  fn,
  records,
  functionsData,
  referencesData,
  wordcodeData,
) {
  const jumpTargets = new Map(
    fn.instructionPcs
      .map((pc) => wordcodeData.byPc.get(pc))
      .filter((instruction) => instruction.name === 'JUMP_REG')
      .map((instruction) => [instruction.pc, []]),
  )
  let finalStack = null
  let finalData = null
  for (let iteration = 0; iteration < 32; iteration += 1) {
    finalStack = solveStacks(
      fn,
      jumpTargets,
      records,
      functionsData,
      referencesData,
      wordcodeData,
    )
    finalData = solveRegisterData(fn, finalStack, wordcodeData)
    const next = new Map(finalData.jumps.map((jump) => [jump.pc, jump.targets]))
    for (const jump of finalData.jumps) {
      for (const target of jump.targets) {
        if (!wordcodeData.boundarySet.has(target)) {
          decline(
            'out-of-range-target',
            `Function ${fn.id}: JUMP_REG@${jump.pc} targets non-boundary pc ${target}`,
          )
        }
        if (functionsData.ownerByPc.get(target) !== fn.id) {
          decline(
            'cross-function-target',
            `Function ${fn.id}: JUMP_REG@${jump.pc} targets function ${functionsData.ownerByPc.get(target)}`,
          )
        }
      }
    }
    if (sameJumpMap(jumpTargets, next)) break
    jumpTargets.clear()
    for (const [pc, targets] of next) jumpTargets.set(pc, targets)
    if (iteration === 31)
      decline(
        'dataflow-nonconvergence',
        `Function ${fn.id}: JUMP_REG data flow did not converge`,
      )
  }
  const reachableJumps = new Set(finalData.jumps.map((jump) => jump.pc))
  for (const pc of jumpTargets.keys()) {
    if (!reachableJumps.has(pc))
      decline(
        'unresolved-jump-reg',
        `Function ${fn.id}: JUMP_REG@${pc} is unreachable`,
      )
  }
  return {
    ...finalStack,
    ...finalData,
    inStates: finalStack.inStates,
    dataInStates: finalData.inStates,
    jumpTargets,
  }
}

function edgeTargetEdges(edges, sourcePc) {
  return edges.filter((edge) => edge.sourcePc === sourcePc)
}

function findIrreducibleRegions(fn, edges) {
  const nodes = fn.instructionPcs
  const nodeSet = new Set(nodes)
  const adjacency = new Map(nodes.map((pc) => [pc, new Set()]))
  for (const edge of edges) {
    if (edge.targetPc !== null && nodeSet.has(edge.targetPc)) {
      adjacency.get(edge.sourcePc)?.add(edge.targetPc)
    }
  }

  let nextIndex = 0
  const indexes = new Map()
  const lowLinks = new Map()
  const stack = []
  const onStack = new Set()
  const components = []
  const visit = (node) => {
    indexes.set(node, nextIndex)
    lowLinks.set(node, nextIndex)
    nextIndex += 1
    stack.push(node)
    onStack.add(node)
    for (const target of adjacency.get(node) ?? []) {
      if (!indexes.has(target)) {
        visit(target)
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)))
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(target)))
      }
    }
    if (lowLinks.get(node) === indexes.get(node)) {
      const component = []
      let value
      do {
        value = stack.pop()
        onStack.delete(value)
        component.push(value)
      } while (value !== node)
      components.push(component.sort((left, right) => left - right))
    }
  }
  for (const node of nodes) if (!indexes.has(node)) visit(node)

  const regions = []
  for (const component of components) {
    const componentSet = new Set(component)
    const isCycle =
      component.length > 1 ||
      edges.some(
        (edge) =>
          edge.sourcePc === component[0] && edge.targetPc === component[0],
      )
    if (!isCycle) continue
    const entries = new Set()
    for (const edge of edges) {
      if (
        edge.targetPc !== null &&
        componentSet.has(edge.targetPc) &&
        !componentSet.has(edge.sourcePc)
      ) {
        entries.add(edge.targetPc)
      }
    }
    if (entries.size > 1) {
      regions.push({
        startPcs: [...entries].sort((left, right) => left - right),
        instructionPcs: component,
        reason: 'multiple-entry-cycle',
      })
    }
  }
  return regions
}

function buildBlocks(fn, stackResult, records, wordcodeData) {
  const leaders = new Set([fn.startPc])
  for (const record of records.values()) {
    if (record.ownerFunction !== fn.id) continue
    leaders.add(record.type === 'handler' ? record.handlerPc : record.finallyPc)
    if (record.type === 'finally') leaders.add(record.throwPadPc)
  }
  for (const instruction of fn.instructionPcs.map((pc) =>
    wordcodeData.byPc.get(pc),
  )) {
    for (const edge of edgeTargetEdges(stackResult.edges, instruction.pc)) {
      if (edge.targetPc !== null) leaders.add(edge.targetPc)
    }
    if (
      TERMINATOR_NAMES.has(instruction.name) &&
      instruction.nextPc < fn.endPc
    ) {
      leaders.add(instruction.nextPc)
    }
  }

  const sortedLeaders = [...leaders].sort((left, right) => left - right)
  const blocks = []
  for (let index = 0; index < sortedLeaders.length; index += 1) {
    const startPc = sortedLeaders[index]
    const endPc = sortedLeaders[index + 1] ?? fn.endPc
    const instructionPcs = fn.instructionPcs.filter(
      (pc) => pc >= startPc && pc < endPc,
    )
    if (instructionPcs.length === 0 || instructionPcs[0] !== startPc) {
      decline(
        'invalid-basic-block',
        `Function ${fn.id}: leader ${startPc} does not start a block`,
      )
    }
    const lastPc = instructionPcs.at(-1)
    blocks.push({
      id: `${fn.id}:b@${startPc}`,
      functionId: fn.id,
      startPc,
      endPc,
      instructionPcs,
      successors: edgeTargetEdges(stackResult.edges, lastPc),
      handlerStateIn: stateView(
        stackResult.inStates.get(startPc) ?? [],
        records,
      ),
    })
  }
  const covered = blocks.flatMap(({ instructionPcs }) => instructionPcs)
  if (!sameArray(covered, fn.instructionPcs)) {
    decline(
      'invalid-basic-block',
      `Function ${fn.id}: basic blocks do not cover its instructions exactly`,
    )
  }
  return { leaders: sortedLeaders, blocks }
}

function copyEdge(edge, functionId) {
  const copy = { ...edge, functionId }
  delete copy.extraWrites
  return copy
}

function serializeRecord(record) {
  return {
    id: record.id,
    ownerFunction: record.ownerFunction,
    ...recordView(record),
  }
}

function registerValue(index) {
  return { kind: 'register', index }
}

function makeCallSite(instruction, edges) {
  const raw = instruction.words
  const method = instruction.name === 'CALL_METHOD'
  const destination = raw[1]
  const receiver = method ? raw[2] : null
  const callee = method ? raw[3] : raw[2]
  const argc = method ? raw[4] : raw[3]
  const firstArgument = method ? 5 : 4
  const argumentsValue =
    argc === 65535
      ? { kind: 'spread', arrayRegister: registerValue(raw[firstArgument]) }
      : {
          kind: 'fixed',
          count: argc,
          registers: raw
            .slice(firstArgument, firstArgument + argc)
            .map(registerValue),
        }
  const exceptional = edges.find(
    (edge) => edge.callSitePc === instruction.pc && edge.route !== 'normal',
  )
  return {
    pc: instruction.pc,
    kind: instruction.name,
    destination: registerValue(destination),
    callee: registerValue(callee),
    calleeFunctions: [],
    receiver: receiver === null ? null : registerValue(receiver),
    constructorState: {
      isConstructor: instruction.name === 'NEW',
      mode: instruction.name === 'NEW' ? 'allocate-this' : 'ordinary',
    },
    arguments: argumentsValue,
    continuationPc: instruction.nextPc,
    returnDestination: registerValue(destination),
    exceptionalCompletion: exceptional
      ? {
          kind: exceptional.kind,
          route: exceptional.route,
          targetPc: exceptional.targetPc,
          payload: exceptional.payload,
        }
      : null,
  }
}

function makeFunctionResult(fn, cfg, records, wordcodeData) {
  const edges = cfg.edges.map((edge) => copyEdge(edge, fn.id))
  const blocks = cfg.blocks.map((block) => ({
    ...block,
    successors: block.successors.map((edge) => copyEdge(edge, fn.id)),
  }))
  const callSites = fn.instructionPcs
    .map((pc) => wordcodeData.byPc.get(pc))
    .filter(
      (instruction) =>
        instruction.name === 'CALL' ||
        instruction.name === 'CALL_METHOD' ||
        instruction.name === 'NEW',
    )
    .map((instruction) => makeCallSite(instruction, cfg.edges))
  const handlerRecords = [...records.values()]
    .filter((record) => record.ownerFunction === fn.id)
    .map(serializeRecord)
  const irreducibleRegions = findIrreducibleRegions(fn, cfg.edges)
  return {
    id: fn.id,
    kind: fn.kind,
    startPc: fn.startPc,
    endPc: fn.endPc,
    parentFunctionId: fn.parentFunctionId,
    regCount: fn.regCount,
    paramCount: fn.paramCount,
    captureCount: fn.captureCount,
    hasRest: fn.hasRest,
    instructionPcs: [...fn.instructionPcs],
    instructionCount: fn.instructionPcs.length,
    leaders: [...cfg.leaders],
    blocks,
    edges,
    indirectTargets: cfg.jumps.map((jump) => ({ ...jump })),
    callSites,
    handlerRecords: handlerRecords.filter(({ type }) => type === 'handler'),
    finallyRecords: handlerRecords.filter(({ type }) => type === 'finally'),
    irreducible: {
      required: irreducibleRegions.length > 0,
      fallback: irreducibleRegions.length > 0 ? 'state-machine' : null,
      regions: irreducibleRegions,
    },
  }
}

function makeResult(
  wordcodeData,
  functionsResult,
  functionsData,
  functionResults,
) {
  const allEdges = functionResults.flatMap((fn) => fn.edges)
  const allIndirectTargets = functionResults.flatMap((fn) =>
    fn.indirectTargets.map((jump) => ({ functionId: fn.id, ...jump })),
  )
  const allCallSites = functionResults.flatMap((fn) => fn.callSites)
  return deepFreeze({
    schemaVersion: CFG_SCHEMA,
    encoding: 'numeric-u32',
    wordCount: wordcodeData.words.length,
    instructionCount: wordcodeData.instructions.length,
    functionCount: functionResults.length,
    functions: functionResults,
    edges: allEdges,
    indirectTargets: allIndirectTargets,
    callSites: allCallSites,
    ownership: functionsResult.ownership.map((ownership) => ({ ...ownership })),
    frame: {
      frameStart: functionsResult.frame.frameStart,
      headerSize: functionsResult.frame.headerSize,
      slots: { ...functionsResult.frame.slots },
      root: { ...functionsResult.frame.root },
    },
    irreducibleFunctions: functionResults
      .filter(({ irreducible }) => irreducible.required)
      .map(({ id }) => id),
    source: {
      wordcodeSchema: WORDCODE_SCHEMA,
      referencesSchema: REFERENCE_SCHEMA,
      functionsSchema: FUNCTION_SCHEMA,
      functionEntries: functionsData.functions.map(
        ({ id, startPc, endPc }) => ({
          id,
          startPc,
          endPc,
        }),
      ),
    },
  })
}

function recognize(wordcode, references, functionsResult) {
  const wordcodeData = indexWordcode(wordcode)
  const referencesData = indexReferences(references)
  const functionsData = indexFunctions(functionsResult)
  validateRegisterRanges(wordcodeData, functionsData)
  const records = makeHandlerRecords(
    wordcodeData,
    functionsData,
    referencesData,
  )
  const functionResults = []
  for (const fn of functionsData.functions) {
    const cfg = solveControlFlow(
      fn,
      records,
      functionsData,
      referencesData,
      wordcodeData,
    )
    const blocks = buildBlocks(fn, cfg, records, wordcodeData)
    functionResults.push(
      makeFunctionResult(fn, { ...cfg, ...blocks }, records, wordcodeData),
    )
  }
  return makeResult(
    wordcodeData,
    functionsResult,
    functionsData,
    functionResults,
  )
}

export function diagnoseControlFlow(wordcode, references, functions) {
  try {
    const result = recognize(wordcode, references, functions)
    return deepFreeze({ ok: true, result, diagnostic: null })
  } catch (error) {
    if (error instanceof CfgDecline) {
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
        code: 'cfg-builder-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function buildControlFlow(wordcode, references, functions) {
  return diagnoseControlFlow(wordcode, references, functions).result
}

export default buildControlFlow
