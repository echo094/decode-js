import { CANONICAL_OPCODES } from './opcode-table.js'
export const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
export const REFERENCE_SCHEMA = 'jsconfuser-vm-references.v1'
export const FUNCTION_SCHEMA = 'jsconfuser-vm-functions.v1'
export const CFG_SCHEMA = 'jsconfuser-vm-cfg.v1'
export const CALL_FRAME_SCHEMA = 'jsconfuser-vm-call-frames.v1'
export const CLOSURE_SCHEMA = 'jsconfuser-vm-closure-lifetimes.v1'
export const EXCEPTION_SCHEMA = 'jsconfuser-vm-exception-finally.v1'
export const EMISSION_SCHEMA = 'jsconfuser-vm-closure-exception-emission.v1'

export { CANONICAL_OPCODES }

export const SETUP_NAMES = new Set(['TRY_SETUP', 'FINALLY_SETUP'])
export const COMPLETION_NAMES = new Set(['RETURN', 'THROW'])

export const SEMANTIC_BOUNDARY = 'later-packet'

export class ClosureExceptionDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ClosureExceptionDecline'
    this.code = code
  }
}

export function decline(code, message) {
  throw new ClosureExceptionDecline(code, message)
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

export function cloneData(value) {
  if (Array.isArray(value)) return value.map((child) => cloneData(child))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneData(child)]),
    )
  }
  return value
}

export function register(index) {
  return { kind: 'register', index }
}

export function functionMaps(functions) {
  const functionById = new Map()
  const ownerByPc = new Map()
  for (const fn of functions.functions) {
    functionById.set(fn.id, fn)
    for (const pc of fn.instructionPcs) ownerByPc.set(pc, fn.id)
  }

  return { functionById, ownerByPc }
}

export function stateKey(functionId, pc) {
  return `${functionId}:${pc}`
}

function hStateMaps(exceptionFinally) {
  const instructionStates = new Map()
  for (const state of exceptionFinally.instructionStates) {
    const key = stateKey(state.functionId, state.pc)

    instructionStates.set(key, state)
  }
  return { instructionStates }
}

export function edgeKey(edge) {
  return JSON.stringify({
    functionId: edge.functionId,
    kind: edge.kind,
    sourcePc: edge.sourcePc,
    targetPc: edge.targetPc,
    route: edge.route,
    mode: edge.mode,
    callSitePc: edge.callSitePc,
    continuationPc: edge.continuationPc,
    payload: edge.payload,
  })
}

function routeIdentity(edge) {
  return `route:${edgeKey(edge)}`
}

export function routeRecords(exceptionFinally) {
  const edgeRecords = exceptionFinally.edgeStates.map((edge) => ({
    id: routeIdentity(edge),
    ...cloneData(edge),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const byKey = new Map()
  for (const edge of edgeRecords) {
    const key = edgeKey(edge)

    byKey.set(key, edge.id)
  }
  const completionRoutes = exceptionFinally.completionRoutes.map((route) => {
    const id = byKey.get(edgeKey(route))

    return { id, ...cloneData(route), semanticBoundary: SEMANTIC_BOUNDARY }
  })
  return { edgeRecords, completionRoutes }
}

function instructionKind(name) {
  if (name === 'MAKE_CLOSURE') return 'closure-creation'
  if (name === 'TRY_SETUP') return 'handler-setup'
  if (name === 'TRY_END') return 'handler-finally-end'
  if (name === 'FINALLY_SETUP') return 'finally-setup'
  if (COMPLETION_NAMES.has(name)) return 'completion'
  return 'opaque-opcode'
}

export function instructionRecords(wordcode, functions, exceptionFinally) {
  const { ownerByPc } = functionMaps(functions)
  const { instructionStates } = hStateMaps(exceptionFinally)
  const records = wordcode.instructions.map((instruction) => {
    const functionId = ownerByPc.get(instruction.pc)
    const state = instructionStates.get(stateKey(functionId, instruction.pc))

    return {
      id: `instruction:${functionId}:${instruction.pc}`,
      kind: instructionKind(instruction.name),
      functionId,
      ...cloneData(instruction),
      reachable: state.reachable,
      handlerStateBefore: cloneData(state.handlerStateBefore),
      handlerStateAfter: cloneData(state.handlerStateAfter),
      semanticBoundary: SEMANTIC_BOUNDARY,
    }
  })
  const keys = records.map(({ functionId, pc }) => stateKey(functionId, pc))
  if (new Set(keys).size !== keys.length) {
    decline(
      'duplicated-instruction',
      'Instruction emission records are duplicated',
    )
  }
  if (
    records.length !== wordcode.instructions.length ||
    !wordcode.instructions.every(({ pc }) =>
      records.some((record) => record.pc === pc),
    )
  ) {
    decline(
      'incomplete-instruction',
      'Instruction emission coverage is incomplete',
    )
  }
  return records
}

export function closureRecords(closureLifetimes) {
  const pairsById = new Map()
  for (const pair of closureLifetimes.capturePairs) {
    pairsById.set(pair.id, pair)
  }
  const sites = closureLifetimes.closureSites.map((site) => {
    const captures = site.capturePairIds.map((pairId) => {
      const pair = pairsById.get(pairId)

      return cloneData(pair)
    })
    return {
      id: site.id,
      kind: 'lexical-closure-creation',
      creationPc: site.creationPc,
      parentFunctionId: site.parentFunctionId,
      childFunctionId: site.childFunctionId,
      childStartPc: site.childStartPc,
      destinationRegister: cloneData(site.destinationRegister),
      reachable: site.reachable,
      capturePairIds: [...site.capturePairIds],
      captures,
      escapeEvents: cloneData(site.escapeEvents),
      semanticBoundary: SEMANTIC_BOUNDARY,
    }
  })
  const captures = closureLifetimes.capturePairs.map((pair) => ({
    id: pair.id,
    kind: 'capture-edge',
    creationPc: pair.creationPc,
    parentFunctionId: pair.parentFunctionId,
    childFunctionId: pair.childFunctionId,
    childStartPc: pair.childStartPc,
    childClosureId: pair.childClosureId,
    captureIndex: pair.captureIndex,
    source: cloneData(pair.source),
    bindingId: pair.bindingId,
    bindingOwnerFunctionId: pair.bindingOwnerFunctionId,
    bindingRegister: cloneData(pair.bindingRegister),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const bindings = closureLifetimes.bindings.map((binding) => ({
    id: binding.id,
    kind: 'lexical-binding',
    ownerFunctionId: binding.ownerFunctionId,
    register: cloneData(binding.register),
    capturePairIds: [...binding.capturePairIds],
    useIds: [...binding.useIds],
    lifecycle: cloneData(binding.lifecycle),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const uses = closureLifetimes.uses.map((use) => ({
    id: use.id,
    kind: 'upvalue-use',
    ...cloneData(use),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  const terminations = closureLifetimes.terminationEvents.map((event) => ({
    id: `lifetime:${event.bindingId}:${event.functionId}:${event.sourcePc}`,
    kind: 'closure-lifetime-transition',
    fromState: 'open-upvalue',
    toState: 'closed-captured-value',
    ...cloneData(event),
    semanticBoundary: SEMANTIC_BOUNDARY,
  }))
  return {
    sites,
    captures,
    bindings,
    uses,
    terminations,
  }
}
