import { reachingDefinitionUses } from '../model/operations.js'
import { NORMAL_EDGES } from '../model/control.js'

// Case-level flow queries the value planners share: the solved graph of one planning step's cases
// under its removals, and the cases between two of them.

// The cases every normal path from `from` passes before `to`, neither included, or null when a
// path returns, throws without a normal successor, comes back to `from`, leaves the function or
// loops among them: then `to` does not close what `from` opens.
export function casesBetween(outgoing, from, to) {
  const seen = new Set()
  const successors = new Map()
  const queue = [from]
  while (queue.length) {
    const pc = queue.shift()
    const edges = outgoing.get(pc) ?? []
    const normal = edges.filter(({ kind }) => NORMAL_EDGES.has(kind))
    if (!normal.length || edges.some(({ kind }) => kind === 'return'))
      return null
    successors.set(pc, [])
    for (const { targetPc } of normal) {
      if (targetPc === null || targetPc === from) return null
      if (targetPc === to) continue
      successors.get(pc).push(targetPc)
      if (!seen.has(targetPc)) {
        seen.add(targetPc)
        queue.push(targetPc)
      }
    }
  }
  // Acyclic: every case is ordered after each case that leads to it.
  const pending = new Map([...successors.keys()].map((pc) => [pc, 0]))
  for (const targets of successors.values())
    for (const pc of targets) pending.set(pc, pending.get(pc) + 1)
  const ready = [from]
  let ordered = 0
  while (ready.length) {
    const pc = ready.pop()
    ordered += 1
    for (const target of successors.get(pc))
      if (pending.set(target, pending.get(target) - 1).get(target) === 0)
        ready.push(target)
  }
  return ordered === successors.size ? seen : null
}

// The cases reachable from `from` by any edge, abrupt ones too, without passing `to`.
export function casesBefore(outgoing, from, to) {
  const seen = new Set()
  const queue = [from]
  while (queue.length) {
    for (const { targetPc } of outgoing.get(queue.shift()) ?? []) {
      if (targetPc === null || targetPc === to || seen.has(targetPc)) continue
      seen.add(targetPc)
      queue.push(targetPc)
    }
  }
  return seen
}

// The solved graph of one planning step's cases, under that step's removals.
export function flowView({ instructions, solved, removed, literals }) {
  const byPc = new Map(instructions.map((item) => [item.pc, item]))
  const uses = reachingDefinitionUses(
    instructions,
    solved.reachingDefinitions,
    removed,
    literals,
  )
  return {
    solved,
    removed,
    byPc,
    uses,
    outgoing: Map.groupBy(solved.edges, (edge) => edge.sourcePc),
    incoming: Map.groupBy(
      solved.edges.filter(({ targetPc }) => targetPc !== null),
      (edge) => edge.targetPc,
    ),
    usePcs: (pc) => [
      ...new Set((uses.get(String(pc)) ?? []).map((site) => site.pc)),
    ],
    // The case PC of the one definition reaching `register` at `pc`, or null.
    definitionOf: (pc, register) => {
      const ids = solved.reachingDefinitions.get(pc)?.[register]
      if (ids?.size !== 1) return null
      const [id] = ids
      return /^\d+$/.test(id) ? Number(id) : null
    },
    isJump: (pc) => byPc.get(pc)?.operation.kind === 'jump',
  }
}

// The definitions reaching `read` at `pc`.
export const reachingAt = (view, pc, read) =>
  view.solved.reachingDefinitions.get(pc)?.[read] ?? new Set()
