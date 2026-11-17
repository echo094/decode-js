import { decline, isJumpStep } from '../model/model.js'

// The control graph of one function's cases: blocks, reachability, dominators and the walks
// region recovery uses.

function fail(message) {
  decline('invalid-structured-control', message)
}

function blockGraph(blocks, edges) {
  const byPc = new Map(blocks.map((block) => [block.startPc, block]))
  const adjacency = new Map(blocks.map((block) => [block.id, []]))
  for (const edge of edges) {
    const sourceBlock = byPc.get(edge.sourcePc)
    if (!sourceBlock) fail(`No block owns edge source ${edge.sourcePc}`)
    if (edge.targetPc !== null) {
      const targetBlock = byPc.get(edge.targetPc)
      if (!targetBlock) fail(`No block owns edge target ${edge.targetPc}`)
      adjacency.get(sourceBlock.id).push({ target: targetBlock.id, edge })
    }
  }
  return { byPc, adjacency }
}

export function reachableBlockIds(entry, adjacency) {
  const visited = new Set([entry])
  const queue = [entry]
  while (queue.length) {
    const id = queue.shift()
    for (const { target } of adjacency.get(id) ?? []) {
      if (!visited.has(target)) {
        visited.add(target)
        queue.push(target)
      }
    }
  }
  return visited
}

export function dominators(blockIds, entry, adjacency) {
  const all = new Set(blockIds)
  const predecessors = new Map([...all].map((id) => [id, []]))
  for (const [source, successors] of adjacency) {
    for (const { target } of successors)
      if (predecessors.has(target)) predecessors.get(target).push(source)
  }
  const dom = new Map(
    [...all].map((id) => [id, id === entry ? new Set([entry]) : new Set(all)]),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const id of all) {
      if (id === entry) continue
      const preds = predecessors.get(id).filter((pred) => all.has(pred))
      const intersection = preds.length
        ? new Set(
            preds.reduce(
              (left, pred) =>
                [...left].filter((candidate) => dom.get(pred).has(candidate)),
              [...all],
            ),
          )
        : new Set()
      intersection.add(id)
      if (!sameSet(dom.get(id), intersection)) {
        dom.set(id, intersection)
        changed = true
      }
    }
  }
  return { dom, predecessors }
}

function sameSet(left, right) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  )
}

// The statements a function nests: a loop entered at its header, a try at its setup. Statements
// are found walking forward: a case with more than one next step opens a control statement one
// level deeper, and a statement closes where the walk returns to its depth, so its end never
// depends on how the function ends. A statement's members are the blocks its entry dominates and
// its continuation does not. A loop closes where its own test exits: the first two-way branch on
// the header's straight run (while, for, for-in), or else the branch the back edge falls from
// (do-while), followed through jump-only blocks; a return or throw inside it is a transfer. A try
// closes where its own normal exit tail leads (a catch: the pop target its catch's completion
// reaches first, else the jump after a pop of this try; a finally: the literal a pop-first tail
// loads before jumping to its finalizer); a break or continue crossing it has the same tail, so a
// tail into an enclosing loop's head or end is a transfer when the try has several. Either
// continuation must leave a closed region: every edge into a member other than the entry comes
// from a member.
// The blocks reached from `start` over `successors` (block id -> successor ids) in breadth-first
// order, never entering `inside` nor going past a block of `stops`, which is listed itself.
export function walkForward(start, successors, inside, stops) {
  const order = []
  const seen = new Set()
  const work = [start]
  while (work.length) {
    const id = work.shift()
    if (seen.has(id) || inside.has(id)) continue
    seen.add(id)
    order.push(id)
    if (!stops.has(id)) work.push(...(successors.get(id) ?? []))
  }
  return order
}

// Where a statement's other exits meet the walk from its end, past that end, nearest first: each is
// the target of a labeled exit that skips code the statement's own exit runs. `inside` is what the
// exits leave (a loop's cycle; a try's members its end's walk does not reach). `transfers` are the
// enclosing statements' heads and ends, which a jump reaches as a transfer, so nothing meets beyond
// them.
export function laterEnds(inside, end, successors, transfers) {
  const fromEnd = walkForward(end, successors, inside, transfers)
  const ends = new Set()
  for (const id of inside)
    for (const target of successors.get(id) ?? []) {
      if (inside.has(target)) continue
      const meet = walkForward(target, successors, inside, transfers).find(
        (other) => fromEnd.includes(other),
      )
      if (meet && meet !== end && !transfers.has(meet)) ends.add(meet)
    }
  return [...ends].sort(
    (left, right) => fromEnd.indexOf(left) - fromEnd.indexOf(right),
  )
}

// Where flow entering `id` arrives once it has passed its jump steps.
export function jumpStepResolver(blocks, normal) {
  const blockById = new Map(blocks.map((block) => [block.id, block]))
  return (id) => {
    const seen = new Set()
    while (
      isJumpStep(blockById.get(id)) &&
      !seen.has(id) &&
      normal.get(id)?.length === 1
    ) {
      seen.add(id)
      id = normal.get(id)[0].target
    }
    return id
  }
}

// A conditional's arms reconverge along normal control flow. An exceptional route into a
// handler or finalizer leaves the statement instead of joining its arms, as
// terminalBranchBlocks treats it, so the reconvergence search does not follow one.
export function normalAdjacency(adjacency) {
  return new Map(
    [...adjacency].map(([id, successors]) => [
      id,
      successors.filter(({ edge }) => edge.route !== 'exceptional'),
    ]),
  )
}

// An adjacency's successor ids by block: the data the walks read.
export function successorMap(adjacency) {
  return new Map(
    [...adjacency].map(([id, successors]) => [
      id,
      successors.map(({ target }) => target),
    ]),
  )
}

// Normal edges plus each catch-setup's own route into its catch: a try is one statement, so an arm
// holding one that always throws goes on through the catch.
export function armAdjacency(graph, blocks, normal) {
  const arms = new Map(normal)
  for (const { id, instruction } of blocks) {
    const { kind, target } = instruction.operation
    if (kind === 'catch-setup')
      arms.set(id, [
        ...(normal.get(id) ?? []),
        ...graph.adjacency
          .get(id)
          .filter(({ edge }) => edge.targetPc === target),
      ])
  }
  return arms
}

/**
 * One structured function's block graph, built once per plan: its blocks and edges, the control
 * solver's reachability and handler stacks, dominators over the reachable blocks, and the read-only
 * questions every region finder asks of them.
 */
export class FunctionGraph {
  constructor(entry, blocks, edges, solved) {
    this.entry = entry
    this.blocks = blocks
    this.edges = edges
    this.graph = blockGraph(blocks, edges)
    const reachablePcs = new Set(solved.reachablePcs)
    this.reachable = new Set(
      blocks
        .filter((block) => reachablePcs.has(block.startPc))
        .map(({ id }) => id),
    )
    this.stateIn = solved.stateIn
    this.control = { reachable: this.reachable, stateIn: this.stateIn }
    this.blockById = new Map(blocks.map((block) => [block.id, block]))
    this.leafByPc = new Map(
      blocks.map((block) => [block.startPc, block.instruction]),
    )
    const { dom, predecessors } = dominators(
      this.reachable,
      entry,
      this.graph.adjacency,
    )
    this.dom = dom
    this.predecessors = predecessors
    this.normalEdges = normalAdjacency(this.graph.adjacency)
    this.throughJumps = jumpStepResolver(blocks, this.normalEdges)
    // The walks read the normal successors by block.
    this.normalSuccessors = successorMap(this.normalEdges)
  }

  dominates(ancestor, id) {
    return this.dom.get(id)?.has(ancestor) ?? false
  }

  lastLeaf(id) {
    return this.blockById.get(id).instruction
  }

  // Block ids in program order.
  sortedByPc(ids) {
    return [...ids].sort(
      (left, right) =>
        this.blockById.get(left).startPc - this.blockById.get(right).startPc,
    )
  }

  outgoing(pc) {
    return this.edges.filter((edge) => edge.sourcePc === pc)
  }

  fallthroughPc(pc) {
    const next = this.outgoing(pc)
    return next.length === 1 && next[0].kind === 'fallthrough'
      ? next[0].targetPc
      : null
  }

  membersOf(head, continuation, cuts = []) {
    return new Set(
      [...this.reachable].filter(
        (id) =>
          this.dominates(head, id) &&
          ![continuation, ...cuts].some(
            (cut) =>
              cut && this.dominates(cut, id) && !this.dominates(cut, head),
          ),
      ),
    )
  }

  closed(head, members, kind) {
    return [...members].every((id) =>
      this.predecessors
        .get(id)
        .every(
          (pred) =>
            !this.reachable.has(pred) ||
            members.has(pred) ||
            (id === head && (kind === 'try' || !this.dominates(head, pred))),
        ),
    )
  }

  normalNext(id) {
    return this.graph.adjacency
      .get(id)
      .filter(({ edge }) => edge.route !== 'exceptional')
      .map(({ target }) => target)
  }

  jumpOnly(id) {
    return isJumpStep(this.blockById.get(id))
  }

  normalPredecessors(id) {
    return (this.predecessors.get(id) ?? []).filter(
      (pred) => this.reachable.has(pred) && this.normalNext(pred).includes(id),
    )
  }

  latchesOf(head) {
    return [...this.reachable].filter(
      (id) => this.dominates(head, id) && this.normalNext(id).includes(head),
    )
  }

  cycleOf(head) {
    const latches = this.latchesOf(head)
    const cycle = new Set([head])
    const work = [...latches]
    while (work.length) {
      const id = work.pop()
      if (cycle.has(id)) continue
      cycle.add(id)
      for (const pred of this.predecessors.get(id) ?? [])
        if (this.reachable.has(pred)) work.push(pred)
    }
    return { latches, cycle }
  }
}
