// Control over one function's typed cases: which cases run, the handler stack each one runs under,
// the edges between them, the finite targets of each indirect jump and the register definitions
// reaching each case. Reachability and handler-state flow need no knowledge of the encoder: it
// reads only the typed operations and the frontend's facts, so every VM frontend shares it.
import { decline } from './model.js'

const MAX_ROUNDS = 32

// The typed operations whose JavaScript can complete abruptly. A strict comparison, `!`, typeof
// of a register and the moves between registers, captures and fresh arrays or closures cannot;
// a global read through an accessor, a coercing operator or a property operation can.
export function mayThrow(operation) {
  switch (operation.kind) {
    case 'call':
    case 'throw':
    case 'global-read':
    case 'global-write':
    case 'safe-typeof':
    case 'property-read':
    case 'property-write':
    case 'property-delete':
    case 'object':
    case 'accessor':
    case 'for-in-setup':
      return true
    case 'assign':
      if (operation.value.kind === 'binary')
        return !['===', '!=='].includes(operation.value.operator)
      if (operation.value.kind === 'unary')
        return operation.value.operator !== '!'
      return false
    default:
      return false
  }
}

function makeRecords(cases) {
  const records = new Map()
  for (const { pc, operation } of cases) {
    if (operation.kind === 'catch-setup')
      records.set(pc, {
        kind: 'catch',
        setupPc: pc,
        target: operation.target,
        exceptionRegister: operation.exceptionRegister,
      })
    else if (operation.kind === 'finally-setup')
      records.set(pc, {
        kind: 'finally',
        setupPc: pc,
        target: operation.target,
        continuation: operation.continuation,
        payload: operation.payload,
        throwPad: operation.throwPad,
      })
  }
  return records
}

function sameStack(left, right) {
  return (
    left.length === right.length &&
    left.every((record, index) => record === right[index])
  )
}

// Edge kinds by where they lead. Every edge is a fallthrough, a call's continuation (call), a jump
// (branch), a branch arm (conditional), a return, a throw, a catch handler's entry (handler) or a
// finalizer's entry (finally).
// Straight on to the case after: a fallthrough or a call's continuation.
export const CONTINUING_EDGES = new Set(['fallthrough', 'call'])
// On to one other case whatever the state: continuing, or a jump.
export const UNCONDITIONAL_EDGES = new Set([...CONTINUING_EDGES, 'branch'])
// Every way a case completes and goes on to another case: unconditional, or a branch arm.
export const NORMAL_EDGES = new Set([...UNCONDITIONAL_EDGES, 'conditional'])

function edge(kind, sourcePc, targetPc, options = {}) {
  return {
    kind,
    sourcePc,
    targetPc,
    route: options.route ?? 'direct',
    mode: options.mode ?? 'direct',
    condition: options.condition ?? null,
    callSitePc: options.callSitePc ?? null,
    continuationPc: options.continuationPc ?? null,
    writes: options.writes ?? [],
  }
}

// An abrupt completion at `pc` goes to the innermost active record, which it pops: a catch
// receives the exception in its register, a finalizer resumes at its throw pad with the exception
// as payload. With nothing active it leaves the function.
function abruptRoute(pc, stack, callSitePc) {
  const top = stack.at(-1)
  if (!top)
    return {
      edge: edge('throw', pc, null, { route: 'propagate', callSitePc }),
      after: [],
    }
  const after = stack.slice(0, -1)
  if (top.kind === 'catch')
    return {
      edge: edge('handler', pc, top.target, {
        route: 'exceptional',
        callSitePc,
        writes: [{ register: top.exceptionRegister, kind: 'unknown' }],
      }),
      after,
    }
  return {
    edge: edge('finally', pc, top.target, {
      route: 'exceptional',
      callSitePc,
      writes: [
        {
          register: top.continuation,
          kind: 'literal',
          value: top.throwPad,
          origin: `exception@${pc}`,
        },
        { register: top.payload, kind: 'unknown' },
      ],
    }),
    after,
  }
}

// A step's fallthrough to the next case under the handler stack `after`; a function's last case
// has none, and may end only with no handler active.
function fallthroughOf(step, after = step.stack) {
  const { item, next, context } = step
  if (next !== null)
    return [{ edge: edge('fallthrough', item.pc, next), after }]
  if (after.length)
    decline(
      'unbalanced-handler-stack',
      `Function ${context.frame.id} ends with an active handler at ${item.pc}`,
    )
  return []
}

function setupSuccessors(step) {
  const { item, stack, context } = step
  const active = [...stack, context.records.get(item.pc)]
  // Whether a try body throws cannot be decided (a call into imported code, an accessor), so
  // the handler may run whenever its try is entered: the setup routes to it.
  return [...fallthroughOf(step, active), abruptRoute(item.pc, active, null)]
}

function popSuccessors(step) {
  const { item, stack, context } = step
  if (!stack.length)
    decline(
      'handler-stack-underflow',
      `Function ${context.frame.id}: handler-pop@${item.pc} has nothing active`,
    )
  return fallthroughOf(step, stack.slice(0, -1))
}

function jumpSuccessors({ item: { pc, operation }, stack, context }) {
  return [
    {
      edge: context.finallyTargets.has(operation.target)
        ? edge('finally', pc, operation.target, { route: 'normal' })
        : edge('branch', pc, operation.target),
      after: stack,
    },
  ]
}

function branchSuccessors(step) {
  const { pc, operation } = step.item
  const taken = edge('conditional', pc, operation.target, {
    condition: {
      register: operation.condition,
      truthy: operation.when === 'true',
    },
  })
  return [{ edge: taken, after: step.stack }, ...fallthroughOf(step)]
}

function forInSuccessors(step) {
  const { pc, operation } = step.item
  const exit = edge('branch', pc, operation.exit, {
    condition: {
      kind: 'iterator',
      register: operation.iterator,
      available: false,
    },
  })
  return [{ edge: exit, after: step.stack }, ...fallthroughOf(step)]
}

function indirectSuccessors({ item: { pc }, stack, context }) {
  return (context.jumpTargets.get(pc) ?? []).map((target) => ({
    edge: edge('branch', pc, target, { mode: 'indirect' }),
    after: stack,
  }))
}

function callSuccessors({ item: { pc }, stack, context, next }) {
  if (next === null)
    decline(
      'missing-call-continuation',
      `Function ${context.frame.id}: call@${pc} has no continuation`,
    )
  return [
    {
      edge: edge('call', pc, next, {
        route: 'normal',
        callSitePc: pc,
        continuationPc: next,
      }),
      after: stack,
    },
    abruptRoute(pc, stack, pc),
  ]
}

function throwSuccessors({ item: { pc }, stack }) {
  return [abruptRoute(pc, stack, null)]
}

// The runtime's return closes the frame without running a finalizer; the compiler routes a
// return out of a protected region through the finalizer explicitly.
function returnSuccessors({ item: { pc } }) {
  return [{ edge: edge('return', pc, null, { route: 'propagate' }), after: [] }]
}

// Any other operation falls through, and may throw to the active handler.
function ordinarySuccessors(step) {
  const { item, stack } = step
  return [
    ...fallthroughOf(step),
    ...(stack.length && mayThrow(item.operation)
      ? [abruptRoute(item.pc, stack, null)]
      : []),
  ]
}

const SUCCESSORS = Object.freeze({
  'catch-setup': setupSuccessors,
  'finally-setup': setupSuccessors,
  'handler-pop': popSuccessors,
  jump: jumpSuccessors,
  branch: branchSuccessors,
  'for-in-next': forInSuccessors,
  'indirect-jump': indirectSuccessors,
  call: callSuccessors,
  throw: throwSuccessors,
  return: returnSuccessors,
})

// A case's outgoing edges, each with the handler stack after it (`{ edge, after }`).
function successors(item, stack, context) {
  const next = context.casesByPc.has(item.nextPc) ? item.nextPc : null
  const step = { item, stack, context, next }
  const kind = item.operation.kind
  return Object.hasOwn(SUCCESSORS, kind)
    ? SUCCESSORS[kind](step)
    : ordinarySuccessors(step)
}

function solveStacks(cases, context) {
  const startPc = context.frame.startPc
  const stateIn = new Map([[startPc, []]])
  const queue = [startPc]
  const edges = []
  while (queue.length) {
    const pc = queue.shift()
    const before = stateIn.get(pc)
    for (const { edge: item, after } of successors(
      context.casesByPc.get(pc),
      before,
      context,
    )) {
      edges.push({ ...item, stackBefore: before, stackAfter: after })
      if (item.targetPc === null) continue
      const prior = stateIn.get(item.targetPc)
      if (!prior) {
        stateIn.set(item.targetPc, after)
        queue.push(item.targetPc)
      } else if (!sameStack(prior, after))
        decline(
          'handler-stack-merge-disagreement',
          `Function ${context.frame.id}: incompatible handler stacks at ${item.targetPc}`,
        )
    }
  }
  return { stateIn, edges }
}

// A definition is one write of a register: a case's destination, a route's write on its edge or
// the register's value at function entry. Each case's in-state names, per register, the
// definitions reaching it; a definition's value is a literal, a copy of the definitions reaching
// its source, or unknown.
function definitionOf(item) {
  const { operation } = item
  if (operation.destination === undefined) return null
  const value =
    operation.kind === 'assign' && operation.value.kind === 'literal'
      ? { kind: 'literal', value: operation.value.value }
      : operation.kind === 'assign' && operation.value.kind === 'register'
        ? { kind: 'copy', source: operation.value.index }
        : { kind: 'unknown' }
  return {
    id: String(item.pc),
    pc: item.pc,
    register: operation.destination,
    value,
    origin: item.pc,
  }
}

function solveDefinitions(stacks, context) {
  const { frame, casesByPc } = context
  const definitions = new Map()
  const entry = Array.from({ length: frame.regCount }, (_, register) => {
    const id = `entry:${register}`
    definitions.set(id, {
      id,
      pc: null,
      register,
      value: { kind: 'unknown' },
      origin: null,
    })
    return new Set([id])
  })
  const caseDefinitions = new Map()
  for (const pc of stacks.stateIn.keys()) {
    const definition = definitionOf(casesByPc.get(pc))
    if (definition) {
      definitions.set(definition.id, definition)
      caseDefinitions.set(pc, definition)
    }
  }
  const routed = stacks.edges.filter((item) => item.targetPc !== null)
  const edgesBySource = Map.groupBy(routed, (item) => item.sourcePc)
  for (const item of routed) {
    item.writes.forEach((write, index) => {
      const id = `route@${item.sourcePc}:${item.kind}:${index}`
      definitions.set(id, {
        id,
        pc: item.sourcePc,
        register: write.register,
        value:
          write.kind === 'literal'
            ? { kind: 'literal', value: write.value }
            : { kind: 'unknown' },
        origin: write.origin ?? null,
      })
      write.definition = id
    })
  }

  const reaching = new Map([[frame.startPc, entry]])
  const queue = [frame.startPc]
  while (queue.length) {
    const pc = queue.shift()
    const output = reaching.get(pc).map((set) => new Set(set))
    const own = caseDefinitions.get(pc)
    // A for-in advance writes its key only when one is available: on its fallthrough, not its exit.
    const ownOnFallthrough =
      own && casesByPc.get(pc).operation.kind === 'for-in-next'
    if (own && !ownOnFallthrough) output[own.register] = new Set([own.id])
    for (const item of edgesBySource.get(pc) ?? []) {
      const state = output.map((set) => new Set(set))
      if (ownOnFallthrough && item.kind === 'fallthrough')
        state[own.register] = new Set([own.id])
      for (const write of item.writes)
        state[write.register] = new Set([write.definition])
      const prior = reaching.get(item.targetPc)
      if (!prior) {
        reaching.set(item.targetPc, state)
        queue.push(item.targetPc)
        continue
      }
      let changed = false
      prior.forEach((set, register) => {
        for (const id of state[register])
          if (!set.has(id)) {
            set.add(id)
            changed = true
          }
      })
      if (changed) queue.push(item.targetPc)
    }
  }
  return { definitions, reaching }
}

// Adds every value of `from` with its origins into `into` (value -> origin set); true when an
// origin was new.
function mergeValues(into, from) {
  let changed = false
  for (const [value, origins] of from) {
    const known = into.get(value) ?? new Set()
    for (const origin of origins)
      if (!known.has(origin)) {
        known.add(origin)
        changed = true
      }
    into.set(value, known)
  }
  return changed
}

// A copy's cell takes what the definitions reaching its source hold; true when it grew.
function absorbCopy(values, copy, reaching) {
  const cell = values.get(copy.id)
  let changed = false
  for (const id of reaching.get(copy.pc)[copy.value.source]) {
    const source = values.get(id)
    if (source.unknown && !cell.unknown) {
      cell.unknown = true
      changed = true
    }
    if (mergeValues(cell.values, source.values)) changed = true
  }
  return changed
}

// The values a definition can hold, each with the origin PCs that wrote it; a copy holds what the
// definitions reaching its source hold, solved to a fixed point over copy cycles.
function solveDefinitionValues({ definitions, reaching }) {
  const values = new Map()
  for (const definition of definitions.values())
    values.set(definition.id, {
      unknown: definition.value.kind === 'unknown',
      values: new Map(
        definition.value.kind === 'literal'
          ? [[definition.value.value, new Set([String(definition.origin)])]]
          : [],
      ),
    })
  const copies = [...definitions.values()].filter(
    ({ value }) => value.kind === 'copy',
  )
  let changed = true
  while (changed) {
    changed = false
    for (const copy of copies)
      if (absorbCopy(values, copy, reaching)) changed = true
  }
  return values
}

// An indirect jump's targets, each with the origin PCs that wrote it: a finite set of the
// function's cases.
function indirectJump(pc, operation, reaching, values, context) {
  const { frame, casesByPc } = context
  const origins = new Map()
  let unknown = false
  for (const id of reaching.get(pc)[operation.source]) {
    const cell = values.get(id)
    unknown = unknown || cell.unknown
    mergeValues(origins, cell.values)
  }
  if (unknown || origins.size === 0)
    decline(
      'unresolved-indirect-jump',
      `Function ${frame.id}: indirect-jump@${pc} has no finite target set`,
    )
  const targets = [...origins.keys()]
  for (const target of targets)
    if (!casesByPc.has(target))
      decline(
        'indirect-target-outside-function',
        `Function ${frame.id}: indirect-jump@${pc} targets ${String(target)}, not a case of the function`,
      )
  targets.sort((left, right) => left - right)
  return {
    pc,
    sourceRegister: operation.source,
    targets,
    origins: Object.fromEntries(
      targets.map((target) => [target, [...origins.get(target)].sort()]),
    ),
  }
}

function indirectTargets(stacks, flow, values, context) {
  const jumps = []
  for (const pc of stacks.stateIn.keys()) {
    const { operation } = context.casesByPc.get(pc)
    if (operation.kind === 'indirect-jump')
      jumps.push(indirectJump(pc, operation, flow.reaching, values, context))
  }
  return jumps.sort((left, right) => left.pc - right.pc)
}

function sameTargets(left, right) {
  if (left.size !== right.size) return false
  for (const [pc, targets] of left) {
    const other = right.get(pc)
    if (
      !other ||
      other.length !== targets.length ||
      other.some((target, index) => target !== targets[index])
    )
      return false
  }
  return true
}

// Indirect targets feed the edges the stack solve follows, and the edges feed the definitions
// that give the targets, so the two solve together until the targets stop changing.
export function solveControl(frame, cases) {
  const casesByPc = new Map(cases.map((item) => [item.pc, item]))
  const records = makeRecords(cases)
  const context = {
    frame,
    casesByPc,
    records,
    finallyTargets: new Set(
      [...records.values()]
        .filter(({ kind }) => kind === 'finally')
        .map(({ target }) => target),
    ),
    jumpTargets: new Map(
      cases
        .filter(({ operation }) => operation.kind === 'indirect-jump')
        .map(({ pc }) => [pc, []]),
    ),
  }
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const stacks = solveStacks(cases, context)
    const flow = solveDefinitions(stacks, context)
    const values = solveDefinitionValues(flow)
    const jumps = indirectTargets(stacks, flow, values, context)
    const next = new Map(jumps.map(({ pc, targets }) => [pc, targets]))
    for (const pc of context.jumpTargets.keys())
      if (!next.has(pc)) next.set(pc, [])
    if (sameTargets(context.jumpTargets, next)) {
      const reachablePcs = [...stacks.stateIn.keys()].sort(
        (left, right) => left - right,
      )
      return {
        functionId: frame.id,
        reachablePcs,
        stateIn: stacks.stateIn,
        edges: stacks.edges,
        indirectTargets: jumps,
        definitions: flow.definitions,
        reachingDefinitions: flow.reaching,
        definitionValues: values,
      }
    }
    context.jumpTargets = next
  }
  decline(
    'control-nonconvergence',
    `Function ${frame.id}: indirect targets did not converge`,
  )
}
