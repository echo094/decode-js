import {
  destinationRegister,
  expressionProducer,
  sameStack,
  valueSlots,
} from '../model/operations.js'
import { casesBetween, flowView, reachingAt } from './case-flow.js'
import { unitSlots } from './object-literals.js'
import { CONTINUING_EDGES, UNCONDITIONAL_EDGES } from '../model/control.js'

// Values the planner writes as one expression where they are read: a conditional value (`a ? b : c`)
// and a logical value (`a && b`, `a || b`, `a ?? b`).

// The cases the run walk writes as one expression each (a planned conditional's test aside).
const EXPRESSION_WRITES = new Set([
  'property-write',
  'global-write',
  'upvalue-write',
])

// Conditional values: a planned conditional (`conditionals`: test PC -> its arm and merge PCs)
// whose two arms each end writing one register v, read once, in a slot that takes a fold (a unit
// case's literal slot or any other use's), every case between its test and its merge one expression and nothing else it writes read
// outside it. Single-use folding takes it as a producer of v (`test ? X : Y`). Returns test PC ->
// { register, pcs, mergePc, usePc, definitions, writers }.
export function conditionalValues(args) {
  const view = flowView(args)
  const context = {
    ...args,
    destination: (pc) =>
      args.copyPlan.get(pc) ?? destinationRegister(view.byPc.get(pc)),
  }
  const values = new Map()
  for (const [testPc, { mergePc }] of args.conditionals) {
    const value = conditionalValueAt(view, testPc, mergePc, context)
    if (value) values.set(testPc, value)
  }
  return values
}

function conditionalValueAt(view, testPc, mergePc, context) {
  const pcs = expressionRegion(view, testPc, mergePc, context.conditionals)
  if (!pcs) return null
  const arms = armWriters(view, testPc, mergePc, pcs)
  if (!arms) return null
  const { writers, emptyArms } = arms
  const register = sharedRegister(view, writers, context)
  if (register === null) return null
  let logical = null
  if (emptyArms) {
    logical = logicalShape(view, {
      testPc,
      mergePc,
      register,
      destination: context.destination,
      stack: view.solved.stateIn.get(testPc),
    })
    if (!logical) return null
    for (const pc of logical.pcs) pcs.add(pc)
  }
  const use = containedUse(view, pcs, register, context.keptRegisters)
  if (!use || !foldableUse(view, use, register, context.unitCases)) return null
  return {
    testPc,
    // The case a walk meets first: a logical value's left producer, else its test.
    entryPc: logical?.leftPc ?? testPc,
    register,
    pcs,
    mergePc,
    usePc: use.usePc,
    definitions: use.definitions,
    writers,
    logical: logical && {
      operator: logical.operator,
      leftPc: logical.leftPc,
      armPc: logical.armPc,
    },
  }
}

// The test and every case between it and the merge, when each renders as one expression on the
// test's stack, or null.
function expressionRegion(view, testPc, mergePc, conditionals) {
  const region = casesBetween(view.outgoing, testPc, mergePc)
  if (!region) return null
  const stack = view.solved.stateIn.get(testPc)
  const expression = (pc) => {
    const { operation } = view.byPc.get(pc)
    return (
      sameStack(view.solved.stateIn.get(pc), stack) &&
      (view.removed.has(pc) ||
        view.isJump(pc) ||
        expressionProducer(operation) ||
        EXPRESSION_WRITES.has(operation.kind) ||
        (operation.kind === 'branch' && conditionals.has(pc)))
    )
  }
  return [...region].every(expression) ? new Set([testPc, ...region]) : null
}

// Each arm's last case: the one entering the merge, through jump steps and removed cases. A
// logical value's empty arm is the test's own edge to the merge. Two arms, or null.
function armWriters(view, testPc, mergePc, pcs) {
  const writers = new Set()
  let emptyArms = 0
  const work = (view.incoming.get(mergePc) ?? []).map(
    ({ sourcePc }) => sourcePc,
  )
  if (!work.every((pc) => pcs.has(pc))) return null
  while (work.length) {
    const pc = work.pop()
    if (pc === testPc) emptyArms += 1
    else if (view.isJump(pc) || view.removed.has(pc)) {
      const into = view.incoming.get(pc) ?? []
      if (into.length !== 1) return null
      work.push(into[0].sourcePc)
    } else writers.add(pc)
  }
  return writers.size + emptyArms === 2 ? { writers, emptyArms } : null
}

// The one register every arm's writer writes, as an expression, or null.
function sharedRegister(view, writers, context) {
  const [register, other = register] = [...writers].map(context.destination)
  if (
    register === null ||
    register !== other ||
    context.keptRegisters.has(register) ||
    ![...writers].every((pc) => expressionProducer(view.byPc.get(pc).operation))
  )
    return null
  return register
}

// What the conditional writes is read inside it, but v once, at its use: `{ usePc, definitions }`,
// or null.
function containedUse(view, pcs, register, keptRegisters) {
  const definitions = new Set()
  const sites = new Set()
  for (const pc of pcs) {
    const written = destinationRegister(view.byPc.get(pc))
    if (written === null) continue
    if (keptRegisters.has(written)) return null
    for (const site of view.uses.get(String(pc)) ?? []) {
      if (pcs.has(site.pc)) continue
      if (site.register !== register) return null
      definitions.add(String(pc))
      sites.add(site.pc)
    }
  }
  if (sites.size !== 1) return null
  const [usePc] = sites
  return { usePc, definitions }
}

// The use reads v in a slot that takes a fold, and every definition reaching it is the
// conditional's.
function foldableUse(view, { usePc, definitions }, register, unitCases) {
  const reaching = view.solved.reachingDefinitions.get(usePc)?.[register]
  const operation = view.byPc.get(usePc).operation
  const slots = unitCases.has(usePc)
    ? unitSlots(operation)
    : valueSlots(operation)
  return Boolean(
    slots?.some((slot) => slot.register === register && slot.foldable) &&
    reaching &&
    [...reaching].every((id) => definitions.has(id)),
  )
}

// A logical value, as the compiler lowers `a && b`, `a || b` and `a ?? b`: v = a; a branch that
// keeps v (on v itself, or on `v == null` for `??`); v = b on the other arm; the merge reads v.
// The left producer P is the case right before the test, past removed cases, jump steps and, for
// `??`, the null load and the comparison; it writes v (a retarget included), and v's one definition
// reaching the test is P's own or a removed move P was folded into. The empty arm is the test's
// edge that reaches the merge through jump steps alone. Returns `{ operator, leftPc, armPc, pcs }`
// (the cases from P to the test), or null.
function logicalShape(view, { testPc, mergePc, register, destination, stack }) {
  const test = view.byPc.get(testPc)
  if (test.operation.kind !== 'branch') return null
  const edges = logicalEdges(view, testPc, mergePc)
  if (!edges) return null
  const logic = logicalOperator(view, test, register, edges.keptTruthy)
  if (!logic) return null
  const left = leftProducer(view, testPc, register, logic.compare, {
    destination,
    stack,
  })
  if (!left) return null
  return {
    operator: logic.operator,
    leftPc: left.leftPc,
    armPc: edges.armPc,
    pcs: left.pcs,
  }
}

// The solver's two edges of a branch: the taken one (`conditional`, with the condition's truth
// that takes it) and the fallthrough; one reaches the merge through jump steps alone (the empty
// arm), the other is v = b's arm. Returns the arm and the condition's truth that keeps v.
function logicalEdges(view, testPc, mergePc) {
  const reachesMerge = (pc) => {
    const seen = new Set()
    while (pc !== mergePc) {
      if (pc === null || seen.has(pc) || !view.isJump(pc)) return false
      seen.add(pc)
      const out = view.outgoing.get(pc) ?? []
      if (out.length !== 1) return false
      pc = out[0].targetPc
    }
    return true
  }
  const edges = (view.outgoing.get(testPc) ?? []).filter(({ kind }) =>
    ['conditional', 'fallthrough'].includes(kind),
  )
  const taken = edges.find(({ kind }) => kind === 'conditional')
  const empty = edges.filter(({ targetPc }) => reachesMerge(targetPc))
  const arm = edges.filter(({ targetPc }) => !reachesMerge(targetPc))
  if (edges.length !== 2 || !taken || empty.length !== 1 || arm.length !== 1)
    return null
  return {
    armPc: arm[0].targetPc,
    keptTruthy:
      empty[0] === taken ? taken.condition.truthy : !taken.condition.truthy,
  }
}

// `||` or `&&` when the branch tests v itself; `??` when it tests `v == null` against the null the
// compiler loaded for it and keeps v when that is false. Returns `{ operator, compare }` (the
// comparison case for `??`, else null), or null.
function logicalOperator(view, test, register, keptTruthy) {
  const condition = test.operation.condition
  if (condition === register)
    return { operator: keptTruthy ? '||' : '&&', compare: null }
  const [definition, ...more] = reachingAt(view, test.pc, condition)
  const compare =
    definition === undefined ? null : view.byPc.get(Number(definition))
  const value = compare?.operation.value
  if (
    more.length ||
    keptTruthy ||
    compare?.operation.kind !== 'assign' ||
    value?.kind !== 'binary' ||
    value.operator !== '==' ||
    value.left !== register
  )
    return null
  const nullDefinitions = [...reachingAt(view, compare.pc, value.right)].map(
    (id) => view.byPc.get(Number(id))?.operation,
  )
  if (
    nullDefinitions.length !== 1 ||
    nullDefinitions[0]?.kind !== 'assign' ||
    nullDefinitions[0].value.kind !== 'literal' ||
    nullDefinitions[0].value.value !== null
  )
    return null
  return { operator: '??', compare }
}

// A case before the test that renders nothing of its own: removed, a jump step, or for `??` the
// comparison and its null load.
function rendersNothing(view, pc, compare, destination) {
  const operation = view.byPc.get(pc).operation
  const nullLoad =
    compare !== null &&
    destination(pc) === compare.operation.value.right &&
    operation.kind === 'assign' &&
    operation.value.kind === 'literal' &&
    operation.value.value === null
  return (
    view.removed.has(pc) || view.isJump(pc) || pc === compare?.pc || nullLoad
  )
}

// Walk back from the test over the cases that render nothing to P, which writes v and holds v's
// one definition reaching the test (or a removed move folded into it). Returns `{ leftPc, pcs }`
// (P, then the cases walked), or null.
function leftProducer(view, testPc, register, compare, { destination, stack }) {
  const pcs = []
  let pc = testPc
  let leftPc
  for (;;) {
    const into = view.incoming.get(pc) ?? []
    if (into.length !== 1 || !CONTINUING_EDGES.has(into[0].kind)) return null
    const previous = into[0].sourcePc
    const unconditional = (view.outgoing.get(previous) ?? []).filter(
      ({ kind }) => UNCONDITIONAL_EDGES.has(kind),
    )
    if (
      unconditional.length !== 1 ||
      !sameStack(view.solved.stateIn.get(previous), stack)
    )
      return null
    if (!rendersNothing(view, previous, compare, destination)) {
      leftPc = previous
      break
    }
    pcs.push(previous)
    pc = previous
  }
  const definitions = [...reachingAt(view, testPc, register)]
  if (
    destination(leftPc) !== register ||
    !expressionProducer(view.byPc.get(leftPc).operation) ||
    definitions.length !== 1 ||
    ![leftPc, ...pcs].includes(Number(definitions[0]))
  )
    return null
  return { leftPc, pcs: [leftPc, ...pcs] }
}
