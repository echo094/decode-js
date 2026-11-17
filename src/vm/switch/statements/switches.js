import { closeConditional, loopStops } from './conditionals.js'
import {
  armAdjacency,
  jumpStepResolver,
  laterEnds,
  successorMap,
  normalAdjacency,
  walkForward,
} from './graph.js'
import { isJumpStep } from '../model/model.js'

// Switch regions: a chain of strict-equality tests on one discriminant, read back as a `switch`.

// The registers an operation writes.
function writtenRegisters(operation) {
  if (operation.kind === 'catch-setup') return [operation.exceptionRegister]
  if (operation.kind === 'finally-setup')
    return [operation.continuation, operation.payload]
  return Number.isSafeInteger(operation.destination)
    ? [operation.destination]
    : []
}

const RUN_BREAKING_KINDS = new Set([
  'branch',
  'indirect-jump',
  'for-in-next',
  'return',
  'throw',
  'catch-setup',
  'finally-setup',
  'handler-pop',
])

// A switch is a chain of two-way tests that compare one register, the discriminant, with `===`
// against each case's value, in order, while nothing in the chain writes it: a test's match route
// enters its case body, its miss route runs the next case's value into the next test, and the
// last miss enters the default body or the end. That is how a native switch selects a clause, so
// the chain is one when its case bodies share routes a conditional cannot express (a body falling
// into the next one, a default in the middle): a test in it whose arms meet without a first
// block. The switch ends at the block every body's normal exit reaches; its clauses are ordered so
// that each body falling into another is followed by it, a default placed where that holds.
export function findSwitchRegions(blocks, edges, graph, loops, control) {
  return new SwitchFinder(blocks, edges, graph, loops, control).find()
}

// The operands of the `===` whose result the branch reads, when nothing after it writes the result
// or either operand.
function compared(operations, condition) {
  const index = operations.findLastIndex((operation) =>
    writtenRegisters(operation).includes(condition),
  )
  const operation = operations[index]
  if (
    operation?.kind !== 'assign' ||
    operation.value.kind !== 'binary' ||
    operation.value.operator !== '==='
  )
    return null
  const operands = [operation.value.left, operation.value.right]
  const rewritten = operations
    .slice(index + 1)
    .some((later) =>
      writtenRegisters(later).some(
        (register) => register === condition || operands.includes(register),
      ),
    )
  return rewritten ? null : operands
}

// Whether clauses in this order keep each body that falls into another right before it, with each
// entry's clauses together.
function clausesFit(clauses, fallsInto) {
  const groups = []
  for (const clause of clauses)
    if (groups.at(-1)?.entryBlockId === clause.entryBlockId)
      groups.at(-1).clauses.push(clause)
    else groups.push({ entryBlockId: clause.entryBlockId, clauses: [clause] })
  if (
    new Set(groups.map(({ entryBlockId }) => entryBlockId)).size !==
    groups.length
  )
    return false
  return groups.every(
    ({ entryBlockId }, index) =>
      !fallsInto.has(entryBlockId) ||
      groups[index + 1]?.entryBlockId === fallsInto.get(entryBlockId),
  )
}

// The clauses in case order, a default placed at the last position that fits; null when none fits.
function orderClauses(cases, defaultEntry, fallsInto) {
  const caseClauses = cases.map(({ entryBlockId }, caseIndex) => ({
    caseIndex,
    entryBlockId,
  }))
  if (defaultEntry === null)
    return clausesFit(caseClauses, fallsInto) ? caseClauses : null
  for (let position = caseClauses.length; position >= 0; position -= 1) {
    const candidate = [
      ...caseClauses.slice(0, position),
      { caseIndex: null, entryBlockId: defaultEntry },
      ...caseClauses.slice(position),
    ]
    if (clausesFit(candidate, fallsInto)) return candidate
  }
  return null
}

// One function's switch chains: its two-way tests, the chains they head, and each chain's region.
class SwitchFinder {
  constructor(blocks, edges, graph, loops, control) {
    this.blocks = blocks
    this.edges = edges
    this.graph = graph
    this.loops = loops
    this.normal = normalAdjacency(graph.adjacency)
    this.arms = armAdjacency(graph, blocks, this.normal)
    this.throughJumps = jumpStepResolver(blocks, this.normal)
    this.blockById = new Map(blocks.map((block) => [block.id, block]))
    this.startPc = new Map(blocks.map((block) => [block.id, block.startPc]))
    this.reachable = control.reachable
    this.predecessors = new Map(blocks.map((block) => [block.id, []]))
    for (const [source, successors] of this.normal)
      if (this.reachable.has(source))
        for (const { target } of successors)
          this.predecessors.get(target).push(source)
    this.captured = new Set(
      blocks.flatMap(({ instruction: { operation } }) =>
        operation.kind === 'closure'
          ? operation.captures
              .filter(({ kind }) => kind === 'local')
              .map(({ index }) => index)
          : [],
      ),
    )
  }

  stopsOf(id) {
    return new Set(loopStops(this.loops, id))
  }

  next(id) {
    const successors = this.normal.get(id)
    return successors?.length === 1 ? successors[0].target : null
  }

  // A try setup's routes include its handler's, so a try inside a body is a member with its catch
  // or finalizer.
  routes(id) {
    const kind = this.blockById.get(id).instruction.operation.kind
    return kind === 'catch-setup' || kind === 'finally-setup'
      ? this.graph.adjacency.get(id)
      : (this.normal.get(id) ?? [])
  }

  operationOf(id) {
    return this.blockById.get(id).instruction.operation
  }

  stepsTo(id) {
    const steps = []
    while (
      isJumpStep(this.blockById.get(id)) &&
      !steps.includes(id) &&
      this.next(id) !== null
    ) {
      steps.push(id)
      id = this.next(id)
    }
    return { entry: id, steps }
  }

  twoWay(id) {
    const leaf = this.blockById.get(id).instruction
    if (!this.reachable.has(id) || leaf.operation.kind !== 'branch') return null
    const outgoing = this.edges.filter((edge) => edge.sourcePc === leaf.pc)
    const conditional = outgoing.find(({ kind }) => kind === 'conditional')
    const fallthrough = outgoing.find(({ kind }) => kind === 'fallthrough')
    if (
      !conditional ||
      !fallthrough ||
      conditional.targetPc === null ||
      fallthrough.targetPc === null
    )
      return null
    const [match, miss] =
      leaf.operation.when === 'false'
        ? [fallthrough, conditional]
        : [conditional, fallthrough]
    const blockAt = (pc) => this.graph.byPc.get(pc).id
    return {
      testBlockId: id,
      condition: leaf.operation.condition,
      match: blockAt(match.targetPc),
      miss: blockAt(miss.targetPc),
      branchId: blockAt(conditional.targetPc),
      fallthroughId: blockAt(fallthrough.targetPc),
    }
  }

  // The head's comparison may come from the straight run that enters its test.
  headOperands(test) {
    let operations = []
    let current = test.testBlockId
    for (;;) {
      const operands = compared(operations, test.condition)
      if (operands) return operands
      const preds = this.predecessors.get(current)
      if (preds.length !== 1 || this.next(preds[0]) !== current) return null
      current = preds[0]
      operations = [this.operationOf(current), ...operations]
    }
  }

  // The next case: the straight run from a miss route to the next test, entered only from it.
  nextCase(test) {
    const runBlockIds = []
    let current = test.miss
    let from = test.testBlockId
    while (!runBlockIds.includes(current)) {
      const preds = this.predecessors.get(current)
      if (preds.length !== 1 || preds[0] !== from) return null
      const following = this.twoWay(current)
      if (following) {
        const operations = runBlockIds.map((id) => this.operationOf(id))
        if (operations.some(({ kind }) => RUN_BREAKING_KINDS.has(kind)))
          return null
        const operands = compared(operations, following.condition)
        return operands
          ? { ...following, runBlockIds, operands, operations }
          : null
      }
      if (this.next(current) === null) return null
      runBlockIds.push(current)
      from = current
      current = this.next(current)
    }
    return null
  }

  // The discriminant is the compared register the chain never writes; a case value register is
  // written by the runs, often one register reused for every value. A captured discriminant holds
  // only while the runs are plain assignments.
  discriminantOf(chain, candidates) {
    const written = new Set(
      chain.flatMap(({ operations }) =>
        operations.flatMap((operation) => writtenRegisters(operation)),
      ),
    )
    const unwritten = [...candidates].filter(
      (register) => !written.has(register),
    )
    const discriminant = unwritten.length === 1 ? unwritten[0] : null
    if (discriminant === null) return null
    return !this.captured.has(discriminant) ||
      chain.every(({ operations }) =>
        operations.every(({ kind }) => kind === 'assign'),
      )
      ? discriminant
      : null
  }

  // The longest chain from `head` whose tests share one compared register and never write it.
  chainFrom(head) {
    const operands = this.headOperands(head)
    if (!operands) return null
    const chain = [{ ...head, runBlockIds: [], operands, operations: [] }]
    let candidates = new Set(operands)
    for (;;) {
      const following = this.nextCase(chain.at(-1))
      if (!following) break
      const shared = following.operands.filter((register) =>
        candidates.has(register),
      )
      if (!shared.length) break
      candidates = new Set(shared)
      chain.push(following)
    }
    while (chain.length >= 2) {
      const discriminant = this.discriminantOf(chain, candidates)
      if (discriminant !== null) return { chain, discriminant }
      chain.pop()
      candidates = new Set(
        chain
          .map(({ operands }) => operands)
          .reduce((left, right) =>
            left.filter((value) => right.includes(value)),
          ),
      )
    }
    return null
  }

  // A chain is a switch only when a test's arms meet without a first block.
  unmerged(chain) {
    return chain.some(
      (test) =>
        !closeConditional(
          test,
          { adjacency: this.arms, throughJumps: this.throughJumps },
          { stops: this.stopsOf(test.testBlockId) },
        ).merge,
    )
  }

  // The switch region a chain heads, and the labeled block its later ends need; null when the
  // chain is no switch.
  regionOf(head, { chain, discriminant }) {
    if (!this.unmerged(chain)) return null
    const cases = chain.map((test) => {
      const { entry: entryBlockId, steps } = this.stepsTo(test.match)
      return {
        testBlockId: test.testBlockId,
        value: test.operands.find((register) => register !== discriminant),
        runBlockIds: test.runBlockIds,
        stepBlockIds: steps,
        entryBlockId,
      }
    })
    if (cases.some(({ value }) => value === undefined)) return null
    const miss = this.stepsTo(chain.at(-1).miss)
    const bodies = new SwitchBodies(
      this,
      cases,
      miss,
      this.stopsOf(head.testBlockId),
    )
    const bounds = bodies.bounds()
    if (!bounds) return null
    const { end, members, blockEnds } = bounds
    const fallsInto = bodies.fallsInto(end)
    if (!fallsInto) return null
    const hasDefault = miss.entry !== end
    const clauses = orderClauses(
      cases,
      hasDefault ? miss.entry : null,
      fallsInto,
    )
    if (!clauses) return null
    return {
      region: {
        kind: 'switch',
        testBlockId: head.testBlockId,
        discriminant,
        cases,
        defaultEntryBlockId: hasDefault ? miss.entry : null,
        defaultStepBlockIds: miss.steps,
        clauses,
        continuationBlockId: end,
        memberBlockIds: [...members].sort(
          (left, right) => this.startPc.get(left) - this.startPc.get(right),
        ),
        proof:
          'a chain of === tests on one unchanged register whose case bodies share routes; each body falling into another is followed by it',
      },
      labeled: blockEnds.length
        ? {
            kind: 'labeled-block',
            headBlockId: head.testBlockId,
            endBlockIds: blockEnds,
            innerStopBlockIds: [],
            proof:
              'a labeled exit leaves the switch past its end, code every clause body runs',
          }
        : null,
    }
  }

  find() {
    const chains = this.blocks
      .map(({ id }) => this.twoWay(id))
      .filter(Boolean)
      .map((test) => ({ head: test, found: this.chainFrom(test) }))
      .filter(({ found }) => found)
    const continued = new Set(
      chains.flatMap(({ found }) =>
        found.chain.slice(1).map(({ testBlockId }) => testBlockId),
      ),
    )
    const regions = []
    const labeled = []
    for (const { head, found } of chains) {
      if (continued.has(head.testBlockId)) continue
      const result = this.regionOf(head, found)
      if (!result) continue
      regions.push(result.region)
      if (result.labeled) labeled.push(result.labeled)
    }
    return { regions, labeled }
  }
}

// The case bodies of one switch chain: where they end, the members they hold and which body falls
// into which.
class SwitchBodies {
  constructor(finder, cases, miss, stops) {
    this.finder = finder
    this.stops = stops
    this.chainBlocks = new Set([
      ...cases.flatMap(({ testBlockId, runBlockIds, stepBlockIds }) => [
        testBlockId,
        ...runBlockIds,
        ...stepBlockIds,
      ]),
      ...miss.steps,
    ])
    this.entries = [
      ...new Set([
        ...cases.map(({ entryBlockId }) => entryBlockId),
        miss.entry,
      ]),
    ]
  }

  targets(id) {
    return (this.finder.normal.get(id) ?? []).map(({ target }) => target)
  }

  // Members for an end: what the bodies reach before it or a stop. A labeled exit's later ends are
  // stops as well, so the members end at the switch's own end.
  reachedBefore(end, laterEnds = []) {
    const open = (id) =>
      id !== end && !this.stops.has(id) && !laterEnds.includes(id)
    const members = new Set()
    const work = this.entries.filter(open)
    while (work.length) {
      const id = work.pop()
      if (members.has(id)) continue
      members.add(id)
      for (const { target } of this.finder.routes(id))
        if (open(target)) work.push(target)
    }
    return members
  }

  // The members for an end, closed against entry from anywhere but the chain; null when not.
  membersFor(end, laterEnds = []) {
    const members = this.reachedBefore(end, laterEnds)
    const closed = [...members].every(
      (id) =>
        !this.chainBlocks.has(id) &&
        this.finder.predecessors
          .get(id)
          .every((pred) => members.has(pred) || this.chainBlocks.has(pred)),
    )
    return closed ? members : null
  }

  // The switch's end, its members and its labeled later ends; null when the bodies are not closed.
  // The end is the nearest block the bodies leave to: the one leaving the fewest members. With none,
  // every body leaves by a transfer.
  bounds() {
    const everything = this.membersFor(null)
    const candidates = [
      ...new Set([
        ...[...(everything ?? [])].flatMap((id) => this.targets(id)),
        ...this.entries,
      ]),
    ]
    let end = null
    let members = everything
    for (const candidate of candidates) {
      const found = this.membersFor(candidate)
      if (!found || found.has(candidate)) continue
      if (end === null || found.size < members.size) {
        end = candidate
        members = found
      }
    }
    if (members === null) return null
    if (end === null) return { end, members, blockEnds: [] }
    return this.labeledBounds(end, members, candidates)
  }

  // Whether the walk from `entry` reaches `candidate` before `end` or a stop.
  reaches(entry, candidate, end) {
    const seen = new Set()
    const work = [entry]
    while (work.length) {
      const id = work.pop()
      if (id === candidate) return true
      if (seen.has(id) || this.stops.has(id) || id === end) continue
      seen.add(id)
      work.push(...this.targets(id))
    }
    return false
  }

  // A labeled exit past the switch's tail leaves the tail's members open, so the end found first is
  // past the tail. The end is then the nearest block every clause body reaches, and the blocks a
  // body jumps to past it are later ends, each a labeled block headed by the switch.
  labeledBounds(end, members, candidates) {
    const targets = successorMap(this.finder.normal)
    let blockEnds = []
    for (const candidate of candidates) {
      if (candidate === end || this.stops.has(candidate)) continue
      if (!this.entries.every((entry) => this.reaches(entry, candidate, end)))
        continue
      // What the bodies reach and the end's own walk does not: the code a labeled exit leaves.
      const after = new Set(
        walkForward(candidate, targets, new Set(), this.stops),
      )
      const inside = new Set(
        [...this.reachedBefore(candidate)].filter((id) => !after.has(id)),
      )
      const ends = laterEnds(inside, candidate, targets, this.stops)
      if (!ends.length) continue
      const found = this.membersFor(candidate, ends)
      if (!found || found.has(candidate)) continue
      if (!blockEnds.length || found.size < members.size) {
        end = candidate
        members = found
        blockEnds = ends
      }
    }
    return { end, members, blockEnds }
  }

  // Which entry each body falls into: the one other entry its walk reaches before the end; null
  // when a body reaches several.
  fallsInto(end) {
    const fallsInto = new Map()
    for (const start of this.entries) {
      if (start === end) continue
      const reached = this.entriesReached(start, end)
      if (reached.size > 1) return null
      if (reached.size === 1) fallsInto.set(start, [...reached][0])
    }
    return fallsInto
  }

  // The other entries the clause at `start` reaches before `end` or a stop.
  entriesReached(start, end) {
    const reached = new Set()
    const seen = new Set()
    const work = [start]
    while (work.length) {
      const id = work.pop()
      if (seen.has(id)) continue
      seen.add(id)
      for (const target of this.targets(id)) {
        if (target === end || this.stops.has(target)) continue
        if (this.entries.includes(target) && target !== start)
          reached.add(target)
        else work.push(target)
      }
    }
    return reached
  }
}
