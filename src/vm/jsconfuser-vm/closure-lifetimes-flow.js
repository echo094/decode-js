import {
  CALL_NAMES,
  REGISTER_RESULT_NAMES,
  UPVALUE_NAMES,
  cloneData,
  decline,
  destinationFor,
  register,
} from './closure-lifetimes-contract.js'
import {
  sameAbstractValue,
  sameEnvironment,
} from './analyze-closure-lifetimes.js'

function bindingId(ownerFunctionId, index) {
  return `binding:${ownerFunctionId}:register:${index}`
}

function closureId(site) {
  return `closure:${site.parentFunctionId}:${site.creationPc}`
}

export function resolveBindings(functionData) {
  const resolved = new Map()
  const resolving = new Set()
  const bindings = new Map()

  function resolve(functionId, captureIndex) {
    const key = `${functionId}:${captureIndex}`
    if (resolved.has(key)) return resolved.get(key)
    if (resolving.has(key))
      decline('incomplete-capture', `Capture resolution cycles at ${key}`)
    resolving.add(key)
    const fn = functionData.byId.get(functionId)
    const capture = fn.descriptor.captures[captureIndex]
    let result
    if (capture.kind === 'local') {
      const owner = functionData.byId.get(fn.parentFunctionId)
      if (!owner || capture.index >= owner.regCount) {
        decline(
          'incomplete-capture',
          `Local capture ${key} has no parent register owner`,
        )
      }
      result = {
        bindingId: bindingId(owner.id, capture.index),
        ownerFunctionId: owner.id,
        ownerRegister: capture.index,
        source: {
          kind: 'local',
          parentFunctionId: owner.id,
          register: register(capture.index),
        },
      }
    } else if (capture.kind === 'upvalue') {
      const parent = functionData.byId.get(fn.parentFunctionId)
      if (
        !parent ||
        parent.kind !== 'closure' ||
        capture.index >= parent.captureCount
      ) {
        decline(
          'incomplete-capture',
          `Upvalue capture ${key} has no parent upvalue owner`,
        )
      }
      const parentBinding = resolve(parent.id, capture.index)
      result = {
        bindingId: parentBinding.bindingId,
        ownerFunctionId: parentBinding.ownerFunctionId,
        ownerRegister: parentBinding.ownerRegister,
        source: {
          kind: 'upvalue',
          parentFunctionId: parent.id,
          upvalueIndex: capture.index,
        },
      }
    }
    resolving.delete(key)
    resolved.set(key, result)
    if (!bindings.has(result.bindingId)) {
      bindings.set(result.bindingId, {
        id: result.bindingId,
        ownerFunctionId: result.ownerFunctionId,
        ownerRegister: result.ownerRegister,
        capturePairIds: [],
        useIds: [],
      })
    }
    return result
  }

  return { resolve, bindings }
}

export function buildCapturePairs(functionData, bindingData, cfgData) {
  const capturePairs = []
  const closureSites = []
  for (const site of functionData.closureSitesByPc.values()) {
    const child = functionData.byId.get(site.childFunctionId)
    const siteId = closureId(site)
    const siteReachable = cfgData.reachableByFunction
      .get(site.parentFunctionId)
      .has(site.creationPc)
    const pairIds = []
    child.descriptor.captures.forEach((capture, captureIndex) => {
      const binding = bindingData.resolve(child.id, captureIndex)
      const pairId = `capture:${site.parentFunctionId}:${site.creationPc}:${captureIndex}`
      const pair = {
        id: pairId,
        creationPc: site.creationPc,
        reachable: siteReachable,
        parentFunctionId: site.parentFunctionId,
        childFunctionId: site.childFunctionId,
        childStartPc: site.childStartPc,
        childClosureId: siteId,
        captureIndex,
        source: cloneData(binding.source),
        bindingId: binding.bindingId,
        bindingOwnerFunctionId: binding.ownerFunctionId,
        bindingRegister: register(binding.ownerRegister),
      }
      capturePairs.push(pair)
      pairIds.push(pairId)
      bindingData.bindings.get(binding.bindingId).capturePairIds.push(pairId)
    })
    closureSites.push({
      id: siteId,
      creationPc: site.creationPc,
      parentFunctionId: site.parentFunctionId,
      childFunctionId: site.childFunctionId,
      childStartPc: site.childStartPc,
      destinationRegister: register(site.destinationRegister),
      reachable: siteReachable,
      capturePairIds: pairIds,
      escapeEvents: [],
    })
  }
  return { capturePairs, closureSites }
}

export function collectUses(wordcodeData, functionData, cfgData, bindingData) {
  const uses = []
  for (const fn of functionData.functions) {
    for (const pc of fn.instructionPcs) {
      const instruction = wordcodeData.byPc.get(pc)
      if (!UPVALUE_NAMES.has(instruction.name)) continue
      const upvalueIndex =
        instruction.operands[instruction.name === 'LOAD_UPVALUE' ? 1 : 0]?.index
      if (upvalueIndex >= fn.captureCount) {
        decline(
          'use-without-owner',
          `Upvalue use at PC ${pc} has no capture owner`,
        )
      }
      const resolved = bindingData.resolve(fn.id, upvalueIndex)
      const use = {
        id: `use:${fn.id}:${pc}`,
        pc,
        functionId: fn.id,
        operation: instruction.name === 'LOAD_UPVALUE' ? 'read' : 'write',
        upvalueIndex,
        register: register(
          instruction.operands[instruction.name === 'LOAD_UPVALUE' ? 0 : 1]
            .index,
        ),
        bindingId: resolved.bindingId,
        reachable: cfgData.reachableByFunction.get(fn.id).has(pc),
        state: null,
        possibleStates: [],
      }
      uses.push(use)
      bindingData.bindings.get(resolved.bindingId).useIds.push(use.id)
    }
  }
  return uses
}

export function terminalEvents(cfgData, bindingData) {
  for (const binding of bindingData.bindings.values()) {
    const closeEvents = cfgData.edges
      .filter(
        ({ functionId, targetPc, kind }) =>
          functionId === binding.ownerFunctionId &&
          targetPc === null &&
          (kind === 'return' || kind === 'throw'),
      )
      .map((edge) => ({
        sourcePc: edge.sourcePc,
        functionId: edge.functionId,
        kind: edge.kind,
        completion: edge.kind === 'return' ? 'return' : 'throw',
        route: edge.route,
        mode: edge.mode,
        callSitePc: edge.callSitePc ?? null,
      }))
    if (closeEvents.length === 0) {
      decline(
        'unknown-lifetime',
        `Binding ${binding.id} has no proved close event`,
      )
    }
    binding.closeEvents = closeEvents
    binding.lifecycle = {
      initialState: 'open-upvalue',
      closeEvents,
      afterCloseState: 'closed-captured-value',
      runtimeIdentity: 'owner-function-register-slot',
    }
  }
}

function emptyValue() {
  return { precise: true, sites: new Set() }
}

function unknownValue() {
  return { precise: false, sites: new Set() }
}

function closureValue(siteId) {
  return { precise: true, sites: new Set([siteId]) }
}

function joinValues(left, right) {
  return {
    precise: left.precise && right.precise,
    sites: new Set([...left.sites, ...right.sites]),
  }
}

function joinEnvironments(left, right, regCount) {
  const result = new Map()
  for (let index = 0; index < regCount; index += 1) {
    result.set(
      index,
      joinValues(
        left.get(index) ?? unknownValue(),
        right.get(index) ?? unknownValue(),
      ),
    )
  }
  return result
}

function cloneEnvironment(environment) {
  return new Map(
    [...environment].map(([index, value]) => [
      index,
      { precise: value.precise, sites: new Set(value.sites) },
    ]),
  )
}

function readRegister(environment, operand) {
  return operand?.kind === 'register'
    ? (environment.get(operand.index) ?? unknownValue())
    : unknownValue()
}

function instructionInputRegisters(instruction) {
  const operands = instruction.operands
  if (instruction.name === 'BUILD_ARRAY') return operands.slice(2)
  if (instruction.name === 'BUILD_OBJECT') return operands.slice(2)
  if (instruction.name === 'STORE_GLOBAL') return operands.slice(2)
  if (
    instruction.name === 'SET_PROP' ||
    instruction.name === 'DEFINE_GETTER' ||
    instruction.name === 'DEFINE_SETTER'
  )
    return operands.slice(2)
  if (instruction.name === 'CALL') return [operands[1], ...operands.slice(3)]
  if (instruction.name === 'CALL_METHOD')
    return [operands[0], operands[1], ...operands.slice(4)]
  if (instruction.name === 'NEW') return [operands[1], ...operands.slice(3)]
  if (instruction.name === 'RETURN' || instruction.name === 'THROW')
    return [operands[0]]
  if (instruction.name === 'MOVE') return [operands[1]]
  return []
}

function callArgumentOperands(callSite, instruction) {
  if (callSite.arguments?.kind === 'fixed') {
    const registers = callSite.arguments.registers ?? []
    return registers.map((item) => ({ kind: 'register', index: item.index }))
  }
  if (callSite.arguments?.kind === 'spread') {
    return [{ kind: 'register', index: callSite.arguments.arrayRegister.index }]
  }
  return instructionInputRegisters(instruction).slice(
    instruction.name === 'CALL_METHOD' ? 2 : 1,
  )
}

function unionInputValues(environment, operands) {
  if (operands.length === 0) return emptyValue()
  return operands
    .map((operand) => readRegister(environment, operand))
    .reduce((left, right) => joinValues(left, right), emptyValue())
}

function emitClosureEvents(events, siteIds, event) {
  for (const siteId of siteIds) {
    const key = `${siteId}:${event.kind}:${event.functionId}:${event.pc}:${event.provenEscape}`
    if (!events.has(key)) events.set(key, { siteId, ...event })
  }
}

function transferInstruction(
  environment,
  instruction,
  edge,
  callFrameData,
  summaries,
  events,
) {
  const next = cloneEnvironment(environment)
  const addUseEvent = (value, event) => {
    if (value.precise) emitClosureEvents(events, value.sites, event)
  }
  const callSite = CALL_NAMES.has(instruction.name)
    ? callFrameData.callSiteByPc.get(instruction.pc)
    : null
  if (callSite) {
    const calleeValue = readRegister(
      environment,
      instruction.operands[instruction.name === 'CALL_METHOD' ? 2 : 1],
    )
    addUseEvent(calleeValue, {
      kind:
        callSite.calleeFunctions.length > 0
          ? 'invoke-internal'
          : 'invoke-external',
      functionId: callSite.functionId,
      pc: instruction.pc,
      provenEscape: false,
      targetFunctions: [...callSite.calleeFunctions],
    })
    const argumentValue = unionInputValues(
      environment,
      callArgumentOperands(callSite, instruction),
    )
    addUseEvent(argumentValue, {
      kind:
        callSite.calleeFunctions.length > 0
          ? 'internal-call-argument'
          : 'external-call-argument',
      functionId: callSite.functionId,
      pc: instruction.pc,
      provenEscape: false,
      targetFunctions: [...callSite.calleeFunctions],
    })
    if (instruction.name === 'CALL_METHOD') {
      addUseEvent(readRegister(environment, instruction.operands[0]), {
        kind:
          callSite.calleeFunctions.length > 0
            ? 'internal-call-receiver'
            : 'external-call-receiver',
        functionId: callSite.functionId,
        pc: instruction.pc,
        provenEscape: false,
        targetFunctions: [...callSite.calleeFunctions],
      })
    }
    if (edge.kind === 'call') {
      const returnValue = callSite.calleeFunctions
        .map((id) => summaries.get(id) ?? unknownValue())
        .reduce((left, right) => joinValues(left, right), emptyValue())
      next.set(callSite.destination.index, returnValue)
    } else {
      next.set(callSite.destination.index, unknownValue())
    }
    return next
  }

  if (instruction.name === 'MAKE_CLOSURE') {
    next.set(
      destinationFor(instruction).index,
      closureValue(
        closureId({
          parentFunctionId: edge.functionId,
          creationPc: instruction.pc,
        }),
      ),
    )
  } else if (instruction.name === 'MOVE') {
    next.set(
      destinationFor(instruction).index,
      readRegister(environment, instruction.operands[1]),
    )
  } else if (
    instruction.name === 'BUILD_ARRAY' ||
    instruction.name === 'BUILD_OBJECT'
  ) {
    next.set(
      destinationFor(instruction).index,
      unionInputValues(environment, instructionInputRegisters(instruction)),
    )
  } else if (
    instruction.name === 'LOAD_THIS' ||
    instruction.name === 'LOAD_INT' ||
    instruction.name === 'LOAD_CONST'
  ) {
    next.set(destinationFor(instruction).index, emptyValue())
  } else if (REGISTER_RESULT_NAMES.has(instruction.name)) {
    next.set(destinationFor(instruction).index, unknownValue())
  }

  if (instruction.name === 'STORE_GLOBAL') {
    addUseEvent(readRegister(environment, instruction.operands.at(-1)), {
      kind: 'global-store',
      functionId: edge.functionId,
      pc: instruction.pc,
      provenEscape: true,
      targetFunctions: [],
    })
  }
  if (
    instruction.name === 'SET_PROP' ||
    instruction.name === 'DEFINE_GETTER' ||
    instruction.name === 'DEFINE_SETTER'
  ) {
    addUseEvent(readRegister(environment, instruction.operands.at(-1)), {
      kind: 'property-store',
      functionId: edge.functionId,
      pc: instruction.pc,
      provenEscape: false,
      targetFunctions: [],
    })
  }
  if (instruction.name === 'RETURN') {
    addUseEvent(readRegister(environment, instruction.operands[0]), {
      kind: 'return',
      functionId: edge.functionId,
      pc: instruction.pc,
      provenEscape: true,
      targetFunctions: [],
    })
  }
  return next
}

export function analyzeProvenance(
  wordcodeData,
  functionData,
  cfgData,
  callFrameData,
) {
  let summaries = new Map(
    functionData.functions.map((fn) => [fn.id, unknownValue()]),
  )
  let finalStates = new Map()
  let finalEvents = new Map()
  let converged = false
  const maxIterations = functionData.functions.length * 4 + 4
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const states = new Map()
    const events = new Map()
    const nextSummaries = new Map()
    for (const fn of functionData.functions) {
      const entry = new Map()
      for (let index = 0; index < fn.regCount; index += 1)
        entry.set(index, unknownValue())
      const stateAt = new Map([[fn.startPc, entry]])
      const queue = [fn.startPc]
      const fnEdges = cfgData.edgesByFunction.get(fn.id)
      while (queue.length > 0) {
        const pc = queue.shift()
        const environment = stateAt.get(pc)
        const instruction = wordcodeData.byPc.get(pc)
        for (const edge of fnEdges.filter(({ sourcePc }) => sourcePc === pc)) {
          const outgoing = transferInstruction(
            environment,
            instruction,
            edge,
            callFrameData,
            summaries,
            events,
          )
          if (edge.targetPc === null) continue
          const previous = stateAt.get(edge.targetPc)
          const joined = previous
            ? joinEnvironments(previous, outgoing, fn.regCount)
            : outgoing
          if (!previous || !sameEnvironment(previous, joined, fn.regCount)) {
            stateAt.set(edge.targetPc, joined)
            queue.push(edge.targetPc)
          }
        }
      }
      states.set(fn.id, stateAt)
      const returnRecords = callFrameData.functions[fn.id].returns.filter(
        ({ reachable }) => reachable,
      )
      if (returnRecords.length === 0) {
        nextSummaries.set(fn.id, unknownValue())
      } else {
        let summary = emptyValue()
        for (const record of returnRecords) {
          const environment = stateAt.get(record.pc) ?? new Map()
          summary = joinValues(
            summary,
            readRegister(environment, record.sourceRegister),
          )
        }
        nextSummaries.set(fn.id, summary)
      }
    }
    const stable = functionData.functions.every((fn) =>
      sameAbstractValue(summaries.get(fn.id), nextSummaries.get(fn.id)),
    )
    summaries = nextSummaries
    finalStates = states
    finalEvents = events
    if (stable) {
      converged = true
      break
    }
  }
  if (!converged)
    decline(
      'nonconvergent-dataflow',
      'Closure provenance did not reach a finite fixed point',
    )
  return { summaries, states: finalStates, events: finalEvents }
}
