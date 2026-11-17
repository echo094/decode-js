import { operationReads, sameStack } from '../model/operations.js'
import { casesBefore, casesBetween, flowView } from './case-flow.js'

// Object literals the planner writes as one expression where they are read, and the literal check
// each unit must pass.

// Object literal units. The compiler builds an object literal in a fresh register d: an `object`
// operation (the fast path's data pairs, or none), then on d alone a property write per data
// property or method, an accessor per getter or setter, and an `Object.assign(d, s)` call per
// spread, with d read by nothing else until the last of them. Nothing can observe d while it is
// built, so the unit is written as one literal where its last operation runs. Each unit is
// `{ objectPc, register, chain, regions, site, spreads }`: `chain` the object then its members in
// the order they run, `regions[i]` the cases between `chain[i]` and `chain[i + 1]`, `site` the
// last, `spreads` call PC -> { source, removedPcs } (the global read and the `assign` read).
export function objectLiteralUnits(args) {
  const view = flowView(args)
  const reachablePcs = new Set(args.solved.reachablePcs)
  const units = []
  for (const { pc, operation } of args.instructions) {
    if (
      operation.kind !== 'object' ||
      !reachablePcs.has(pc) ||
      args.removed.has(pc) ||
      args.excluded.has(pc) ||
      args.keptRegisters.has(operation.destination)
    )
      continue
    const unit = objectUnitAt(view, pc, args)
    if (unit) units.push(unit)
  }
  return units
}

const sameSet = (left, right) =>
  left.length === right.length && left.every((pc) => right.includes(pc))

function objectUnitAt(view, pc, args) {
  const register = view.byPc.get(pc).operation.destination
  const { members, others } = collectMembers(view, pc, register, args)
  const chain = [pc, ...members.keys()]
  const site = chain.at(-1)
  const sitePcs = new Set([...members.keys(), ...others])
  const regions = memberRegions(view, chain, members, sitePcs)
  if (!regions) return null
  // d is read by nothing else before the literal is written.
  const before = site === pc ? new Set() : casesBefore(view.outgoing, pc, site)
  if (others.some((item) => before.has(item) || item === site)) return null
  const keys = chain.flatMap((item) => dataKeys(view, args.literals, item))
  if (keys.filter((key) => key === '__proto__').length > 1) return null
  const spreads = new Map([...members].filter(([, shape]) => shape.removedPcs))
  return { objectPc: pc, register, chain, regions, site, spreads }
}

// The uses of d: a member is a write, accessor or spread on d that only this object's definition
// reaches, on its stack; any other use is one of `others`.
function collectMembers(view, pc, register, args) {
  const stack = view.solved.stateIn.get(pc)
  const members = new Map()
  const others = []
  for (const usePc of view.usePcs(pc).sort((left, right) => left - right)) {
    const shape =
      view.definitionOf(usePc, register) === pc &&
      sameStack(view.solved.stateIn.get(usePc), stack)
        ? memberShape(view, view.byPc.get(usePc), register, args)
        : null
    if (shape) members.set(usePc, shape)
    else others.push(usePc)
  }
  return { members, others }
}

// The cases between each member and the next, or null when a pair does not close, a region holds
// the object or a use of d, or a spread's reads lie outside its region.
function memberRegions(view, chain, members, sitePcs) {
  const regions = []
  for (let index = 1; index < chain.length; index += 1) {
    const region = casesBetween(view.outgoing, chain[index - 1], chain[index])
    if (
      !region ||
      [...region].some((item) => item === chain[0] || sitePcs.has(item))
    )
      return null
    const spread = members.get(chain[index])
    if (spread.removedPcs?.some((item) => !region.has(item))) return null
    regions.push(region)
  }
  return regions
}

function memberShape(view, instruction, register, args) {
  const operation = instruction.operation
  if (operation.kind === 'property-write')
    return operation.object === register &&
      operation.key !== register &&
      operation.value !== register
      ? {}
      : null
  if (operation.kind === 'accessor')
    return operation.object === register &&
      operation.key !== register &&
      operation.callback !== register
      ? {}
      : null
  if (operation.kind === 'call')
    return spreadShape(view, instruction, register, args)
  return null
}

// A spread: `Object.assign(d, s)` through a global read and an `assign` read this call alone
// reads, its result unread.
// eslint-disable-next-line complexity -- one call shape; each `||` is one condition of it
function spreadShape(view, instruction, register, args) {
  const { literals, removed, keptRegisters } = args
  const operation = instruction.operation
  if (
    operation.mode !== 'apply' ||
    operation.receiver.kind !== 'register' ||
    operation.arguments.kind !== 'fixed'
  )
    return null
  const [target, source, ...rest] = operation.arguments.registers
  if (target !== register || source === undefined || source === register)
    return null
  if (rest.length) return null
  const receiver = operation.receiver.index
  const calleePc = view.definitionOf(instruction.pc, operation.callee)
  const globalPc = view.definitionOf(instruction.pc, receiver)
  const callee = view.byPc.get(calleePc)?.operation
  const global = view.byPc.get(globalPc)?.operation
  if (
    callee?.kind !== 'property-read' ||
    callee.object !== receiver ||
    literals.at(calleePc, callee.key)?.value !== 'assign' ||
    view.definitionOf(calleePc, receiver) !== globalPc ||
    global?.kind !== 'global-read' ||
    global.name !== 'Object' ||
    removed.has(calleePc) ||
    removed.has(globalPc) ||
    [receiver, operation.callee, operation.destination].some((item) =>
      keptRegisters.has(item),
    ) ||
    !sameSet(view.usePcs(globalPc), [calleePc, instruction.pc]) ||
    !sameSet(view.usePcs(calleePc), [instruction.pc]) ||
    view.usePcs(instruction.pc).length
  )
    return null
  return { source, removedPcs: [globalPc, calleePc] }
}

// A data key written plain is `__proto__: v`, which sets the prototype as the VM's assignment
// does; a literal holds that form once.
function dataKeys(view, literals, pc) {
  const { operation } = view.byPc.get(pc)
  if (operation.kind === 'object')
    return operation.pairs.map(({ key }) => literals.at(pc, key)?.value)
  if (operation.kind === 'property-write')
    return [literals.at(pc, operation.key)?.value]
  return []
}

// What a unit's case reads as a literal's part, in evaluation order: the pairs' keys and values,
// a property's key and value, an accessor's key and function, a spread's source.
export function unitSlots(operation) {
  const slot = (register) => ({ register, foldable: true })
  if (operation.kind === 'object')
    return operation.pairs.flatMap(({ key, value }) => [slot(key), slot(value)])
  if (operation.kind === 'property-write')
    return [slot(operation.key), slot(operation.value)]
  if (operation.kind === 'accessor')
    return [slot(operation.key), slot(operation.callback)]
  return [slot(operation.source)]
}

// The register a unit case reads as the key it writes, or null (a pair list, a spread).
function unitKey(operation) {
  return ['property-write', 'accessor'].includes(operation.kind)
    ? operation.key
    : null
}

// The literal check. Each part of a unit moves from where it ran to the site, past the statements
// rendered between (cases neither removed, folded, a jump step nor the unit's own). Its folded
// operands must pass each (`mayPass`), else the part is barred and its operands stay statements; a
// register it reads must hold at the site what it held there; a key read from a register converts
// at the site, so no statement between may run code; an accessor's function is the closure folded
// into it. Returns `[{ unit, verdict: 'bar' | 'drop', pc }]`, empty when every unit holds.
export function checkObjectLiterals({
  units,
  instructions,
  solved,
  removedPcs,
  absorbedPcs,
  literals,
  folding,
}) {
  const byPc = new Map(instructions.map((item) => [item.pc, item]))
  const { foldedInto, foldsAt, treeOf, mayPass } = folding
  const at = solved.reachingDefinitions
  const sameIds = (left = new Set(), right = new Set()) =>
    left.size === right.size && [...left].every((id) => right.has(id))
  const verdicts = []
  for (const unit of units) {
    const own = new Set(unit.chain)
    const statement = (pc) =>
      !removedPcs.has(pc) &&
      !absorbedPcs.has(pc) &&
      !foldedInto.has(pc) &&
      !own.has(pc) &&
      byPc.get(pc).operation.kind !== 'jump'
    for (const [index, pc] of unit.chain.entries()) {
      const instruction = byPc.get(pc)
      const { operation } = instruction
      const folds = foldsAt.get(pc) ?? new Map()
      const callback = byPc.get(folds.get(operation.callback))
      if (
        operation.kind === 'accessor' &&
        callback?.operation.kind !== 'closure'
      ) {
        verdicts.push({ unit, verdict: 'drop' })
        break
      }
      if (pc === unit.site) continue
      const between = unit.regions
        .slice(index)
        .flatMap((region) => [...region])
        .filter(statement)
      const stack = solved.stateIn.get(pc) ?? []
      if (
        [...folds.values()].some(
          (producer) =>
            !between.every((item) => mayPass(treeOf(producer), item, stack)),
        )
      ) {
        verdicts.push({ unit, verdict: 'bar', pc })
        break
      }
      const reads = operationReads(operation).filter(
        (register) =>
          register !== unit.register &&
          !folds.has(register) &&
          !literals.read(instruction, register),
      )
      const key = unitKey(operation)
      if (
        reads.some(
          (register) =>
            !sameIds(at.get(pc)?.[register], at.get(unit.site)?.[register]),
        ) ||
        (key !== null &&
          !literals.read(instruction, key) &&
          between.some((item) => treeOf(item).throws))
      ) {
        verdicts.push({ unit, verdict: 'drop' })
        break
      }
    }
  }
  return verdicts
}
