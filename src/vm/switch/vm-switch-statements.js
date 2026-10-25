import { VmSwitchDecline, isJumpStep } from './vm-switch-model.js'

// Statement recovery for one structured function of a VM switch model: the regions the
// structured emitter renders (loops, conditionals, a linear run, or the nodes no region covers).
// A node is one case; it reads only the typed operations and the control solver's result (its
// edges, reachability and handler stacks), so it needs no knowledge of the encoder that produced
// them (vm-switch-boundary.md, section 1).

function fail(message) {
  throw new VmSwitchDecline('invalid-structured-control', message)
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

function reachableBlockIds(entry, adjacency) {
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

function dominators(blockIds, entry, adjacency) {
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
function findStatementRegions(entry, blocks, edges, graph, control) {
  const blockById = new Map(blocks.map((block) => [block.id, block]))
  const leafByPc = new Map(
    blocks.map((block) => [block.startPc, block.instruction]),
  )
  const { reachable } = control
  const { dom, predecessors } = dominators(reachable, entry, graph.adjacency)
  const dominates = (ancestor, id) => dom.get(id)?.has(ancestor) ?? false
  const lastLeaf = (id) => blockById.get(id).instruction
  const outgoing = (pc) => edges.filter((edge) => edge.sourcePc === pc)
  const fallthroughPc = (pc) => {
    const next = outgoing(pc)
    return next.length === 1 && next[0].kind === 'fallthrough'
      ? next[0].targetPc
      : null
  }
  const membersOf = (head, continuation, cuts = []) =>
    new Set(
      [...reachable].filter(
        (id) =>
          dominates(head, id) &&
          ![continuation, ...cuts].some(
            (cut) => cut && dominates(cut, id) && !dominates(cut, head),
          ),
      ),
    )
  const closed = (head, members, kind) =>
    [...members].every((id) =>
      predecessors
        .get(id)
        .every(
          (pred) =>
            !reachable.has(pred) ||
            members.has(pred) ||
            (id === head && (kind === 'try' || !dominates(head, pred))),
        ),
    )
  const normalNext = (id) =>
    graph.adjacency
      .get(id)
      .filter(({ edge }) => edge.route !== 'exceptional')
      .map(({ target }) => target)
  const jumpOnly = (id) => isJumpStep(blockById.get(id))
  const throughJumps = jumpStepResolver(
    blocks,
    normalAdjacency(graph.adjacency),
  )
  const normalPredecessors = (id) =>
    (predecessors.get(id) ?? []).filter(
      (pred) => reachable.has(pred) && normalNext(pred).includes(id),
    )
  // A conditional that closes at `merge` and is one expression: its test's two arms reach only
  // blocks it dominates, share none of them (so they first meet at the merge: an `if` whose arms
  // meet earlier is a statement before the merge), leave only to the merge, every entry into the
  // merge comes from them, and none of its blocks runs a statement (a try's head or tail, a
  // return, a throw).
  const statementKinds = new Set([
    'catch-setup',
    'finally-setup',
    'handler-pop',
    'indirect-jump',
    'return',
    'throw',
    'for-in-next',
  ])
  const expressionConditional = (merge, head) => {
    const test = [...dom.get(merge)]
      .filter((id) => id !== merge)
      .sort((left, right) => dom.get(right).size - dom.get(left).size)[0]
    if (!test || test === head || normalNext(test).length !== 2) return null
    const blocks = new Set([test])
    const armOf = new Map()
    for (const start of normalNext(test)) {
      const work = start === merge ? [] : [start]
      while (work.length) {
        const id = work.pop()
        if (armOf.get(id) === start) continue
        if (armOf.has(id) || id === head || !dominates(test, id)) return null
        armOf.set(id, start)
        blocks.add(id)
        for (const next of normalNext(id)) if (next !== merge) work.push(next)
      }
    }
    if (
      normalPredecessors(merge).some((pred) => !blocks.has(pred)) ||
      [...blocks].some(
        (id) =>
          (id !== test &&
            normalPredecessors(id).some((pred) => !blocks.has(pred))) ||
          statementKinds.has(blockById.get(id).instruction.operation.kind),
      )
    )
      return null
    return [...blocks]
  }
  // The run that ends at a loop's only back edge, when several paths enter it: where a continue
  // that skips the rest of the body arrives (a for's update, or a do-while's test, which the walk
  // starts from), unless a merge explains every entry. It walks back over straight blocks and
  // over conditionals that are one expression (an update `i = x ? i + 2 : i + 1`), so it begins
  // where the update or the test does.
  const trailingRun = (head) => {
    const latches = [...reachable].filter(
      (id) => dominates(head, id) && normalNext(id).includes(head),
    )
    if (latches.length !== 1) return []
    const run = bottomTests.has(head)
      ? [bottomTests.get(head), latches[0]]
      : [latches[0]]
    for (;;) {
      const preds = normalPredecessors(run[0])
      if (run[0] === head) return []
      if (preds.length > 1) {
        const conditional = expressionConditional(run[0], head)
        if (!conditional) return run
        run.unshift(...conditional)
        continue
      }
      if (preds.length !== 1 || normalNext(preds[0]).length !== 1) return []
      run.unshift(preds[0])
    }
  }
  const normalEdges = normalAdjacency(graph.adjacency)
  const nestedClose = (id, head) => {
    const outgoing = graph.adjacency.get(id)
    const branch = outgoing.find(({ edge }) => edge.kind === 'conditional')
    const fallthrough = outgoing.find(({ edge }) => edge.kind === 'fallthrough')
    if (!branch || !fallthrough) return null
    const stops = new Set([
      head,
      ...regions
        .filter((region) => region.kind === 'loop' && region.members.has(head))
        .flatMap((region) => [region.head, region.continuation])
        .filter(Boolean),
    ])
    const { merge } = closeConditional(
      id,
      branch.target,
      fallthrough.target,
      normalEdges,
      stops,
      throughJumps,
    )
    return merge && merge !== head ? merge : null
  }
  // Where a loop closes: its test's target outside the cycle, through jump-only blocks.
  // A loop whose test is the branch its back edge falls from (a do-while), by its header.
  const bottomTests = new Map()
  const loopEnd = (head) => {
    const latches = [...reachable].filter(
      (id) => dominates(head, id) && normalNext(id).includes(head),
    )
    const cycle = new Set([head])
    const work = [...latches]
    while (work.length) {
      const id = work.pop()
      if (cycle.has(id)) continue
      cycle.add(id)
      for (const pred of predecessors.get(id) ?? [])
        if (reachable.has(pred)) work.push(pred)
    }
    const exitOf = (id) => {
      const next = normalNext(id)
      const kind = blockById.get(id).instruction.operation.kind
      if (!['branch', 'for-in-next'].includes(kind) || next.length !== 2)
        return null
      const outside = next.filter((target) => !cycle.has(target))
      if (outside.length !== 1) return null
      let target = outside[0]
      const seen = new Set()
      while (jumpOnly(target) && !seen.has(target)) {
        seen.add(target)
        const following = normalNext(target)
        if (following.length !== 1 || cycle.has(following[0])) break
        target = following[0]
      }
      return target
    }
    let at = head
    const walked = new Set()
    while (!walked.has(at)) {
      walked.add(at)
      const next = normalNext(at)
      if (next.length !== 1) {
        const end = exitOf(at)
        if (end) return end
        // A branch whose arms close inside the cycle is nested in the test (a short-circuit
        // operand, say): the walk continues where it closes.
        const close = nestedClose(at, head)
        if (!close) break
        at = close
        continue
      }
      at = next[0]
    }
    if (latches.length !== 1) return null
    const before = (predecessors.get(latches[0]) ?? []).filter((id) =>
      cycle.has(id),
    )
    const end = before.length === 1 ? exitOf(before[0]) : null
    if (end) bottomTests.set(head, before[0])
    return end
  }
  // The pops of a try's own handler record: `[pc, record]` for each.
  const popsOf = (head) => {
    const setupPc = lastLeaf(head).pc
    return [...leafByPc]
      .filter(
        ([pc, leaf]) =>
          leaf.operation.kind === 'handler-pop' &&
          control.stateIn.get(pc)?.at(-1)?.setupPc === setupPc,
      )
      .map(([pc]) => [pc, control.stateIn.get(pc).at(-1)])
  }
  // The block a route leads to through jump steps only it enters: a jump step that several
  // routes enter is where they meet, a location (a try nested in a catch ends at the jump that
  // its own pops and its catch share).
  const ownSteps = (id) => {
    const seen = new Set()
    while (
      jumpOnly(id) &&
      !seen.has(id) &&
      normalNext(id).length === 1 &&
      normalPredecessors(id).length === 1
    ) {
      seen.add(id)
      id = normalNext(id)[0]
    }
    return id
  }
  // Where a catch-only try completes when its catch completes normally: a native try statement
  // ends where its block's normal end and its catch's normal end meet. Each pop is followed
  // through its own jump steps to the block it leads to; of those the catch's own normal walk
  // (never passing the setup again, so a loop's next iteration is not the catch completing)
  // reaches, the end is the one it reaches first, which dominates the others over that walk. A
  // pop of a break or continue crossing the try leads to a block the catch reaches only through
  // the end, or to an enclosing loop's head or end, which is never the end. Null when the catch
  // never completes normally.
  const catchEnd = (head, enclosing) => {
    const setup = lastLeaf(head).operation
    const handler = graph.byPc.get(setup.target)?.id
    if (setup.kind !== 'catch-setup' || !handler) return null
    const walk = new Set()
    const queue = [handler]
    for (const id of queue) {
      if (walk.has(id) || id === head) continue
      walk.add(id)
      queue.push(...normalNext(id))
    }
    const reached = [
      ...new Set(
        popsOf(head)
          .map(([pc]) => fallthroughPc(pc))
          .filter((pc) => pc != null)
          .map((pc) => ownSteps(graph.byPc.get(pc).id)),
      ),
    ].filter((id) => walk.has(id) && !enclosing.has(id))
    const { dom } = dominators(walk, handler, normalEdges)
    return (
      reached.find((id) => reached.every((other) => dom.get(other).has(id))) ??
      null
    )
  }
  // Targets of a try's normal exit tails, found from the pops of its own handler record.
  const exitTails = (head) => {
    const targets = new Set()
    for (const [pc, record] of popsOf(head)) {
      const next = leafByPc.get(fallthroughPc(pc))
      if (record.kind === 'catch') {
        // A catch that never completes normally: the target of the compiler's exit jump. A pop
        // that falls into code (a return crossing the try) ends nothing; a reordered normal exit
        // of such a catch that dropped the jump has the same graph.
        const jump =
          next?.operation.kind === 'jump' ? outgoing(next.pc)[0] : null
        if (jump?.targetPc != null) targets.add(jump.targetPc)
        continue
      }
      const jump = next && leafByPc.get(fallthroughPc(next.pc))
      if (
        next?.operation.kind === 'assign' &&
        next.operation.destination === record.continuation &&
        next.operation.value.kind === 'literal' &&
        jump?.operation.kind === 'jump' &&
        outgoing(jump.pc)[0]?.targetPc === record.target
      )
        targets.add(next.operation.value.value)
    }
    return new Set(
      [...targets].map((pc) => graph.byPc.get(pc)?.id).filter(Boolean),
    )
  }
  const entries = []
  for (const [source, successors] of graph.adjacency)
    for (const { target } of successors)
      if (
        reachable.has(source) &&
        dominates(target, source) &&
        !entries.some((item) => item.head === target)
      )
        entries.push({ kind: 'loop', head: target })
  for (const id of reachable) {
    const kind = lastLeaf(id).operation.kind
    if (kind === 'catch-setup' || kind === 'finally-setup')
      entries.push({ kind: 'try', head: id })
  }
  // Outermost first; a loop whose header is a try's setup encloses that try.
  entries.sort(
    (left, right) => dom.get(left.head).size - dom.get(right.head).size,
  )
  const regions = []
  for (const item of entries) {
    let continuation = null
    let layoutEnd = null
    let cuts = []
    let loopsOutside = []
    if (item.kind === 'loop') {
      continuation = loopEnd(item.head)
    } else {
      // A break or continue crossing the try has the same tail as its normal end.
      const enclosing = new Set(
        regions
          .filter(
            (region) => region.kind === 'loop' && region.members.has(item.head),
          )
          .flatMap((region) => [region.head, region.continuation]),
      )
      const ended = catchEnd(item.head, enclosing)
      let tails = ended ? [ended] : [...exitTails(item.head)]
      if (tails.length > 1) tails = tails.filter((id) => !enclosing.has(id))
      // A continue to an enclosing loop's trailing run is a transfer too (a catch's tail, or a
      // finally's routed pad), unless the try's normal end arrives there as well.
      loopsOutside = regions.filter(
        (region) =>
          region.kind === 'loop' &&
          region.members.has(item.head) &&
          region.trailing.length &&
          !dominates(region.trailing[0], item.head),
      )
      cuts = loopsOutside.map((region) => region.trailing[0])
      const continued = (id) =>
        loopsOutside.find((region) => region.trailing[0] === throughJumps(id))
      if (tails.length > 1) {
        const rest = tails.filter((id) => !continued(id))
        if (rest.length) tails = rest
      }
      // The compiler emits one normal tail per try; another (a reachable injected copy, say)
      // leaves through the first, and the rest are walked as routed exits.
      if (tails.length)
        continuation = tails.sort(
          (left, right) =>
            blockById.get(left).startPc - blockById.get(right).startPc,
        )[0]
    }
    if (
      continuation &&
      !closed(item.head, membersOf(item.head, continuation, cuts), item.kind)
    )
      continuation = null
    // A catch whose block never completes normally has no reachable end; the frontend's layout
    // end places one where the catch's own normal walk arrives inside the catch.
    const setup = lastLeaf(item.head).operation
    if (
      item.kind === 'try' &&
      !continuation &&
      setup.kind === 'catch-setup' &&
      setup.layoutEnd !== undefined
    ) {
      const handler = graph.byPc.get(setup.target)?.id
      const end = graph.byPc.get(setup.layoutEnd)?.id
      if (
        handler &&
        end &&
        reachable.has(end) &&
        dominates(handler, end) &&
        reachableBlockIds(handler, normalEdges).has(end)
      )
        layoutEnd = end
    }
    if (continuation)
      for (const loop of loopsOutside) {
        const target = loop.trailing[0]
        if (
          target !== continuation &&
          [...membersOf(item.head, continuation, cuts)].some((id) =>
            normalNext(id).includes(target),
          )
        )
          loop.continues.push(item.head)
      }
    regions.push({
      ...item,
      continuation,
      members: membersOf(item.head, continuation ?? layoutEnd, cuts),
      ...(item.kind === 'try' ? { layoutEnd } : {}),
      ...(item.kind === 'loop'
        ? {
            trailing: trailingRun(item.head),
            trailingIsTest: bottomTests.has(item.head),
            continues: [],
          }
        : {}),
    })
  }
  return regions
}

function findNaturalLoops(
  entry,
  blocks,
  edges,
  graph,
  statementRegions,
  control,
) {
  const startPc = new Map(blocks.map((block) => [block.id, block.startPc]))
  const { reachable } = control
  const { dom } = dominators(reachable, entry, graph.adjacency)
  const statements = new Map(
    statementRegions
      .filter(({ kind }) => kind === 'loop')
      .map((region) => [region.head, region]),
  )
  const loops = []
  for (const [source, successors] of graph.adjacency) {
    for (const { target } of successors) {
      if (
        !reachable.has(source) ||
        !reachable.has(target) ||
        !dom.get(source)?.has(target) ||
        source === target
      )
        continue
      const region = statements.get(target)
      const members = region.members
      const exitEdges = edges.filter((candidate) => {
        const candidateSource = graph.byPc.get(candidate.sourcePc)?.id
        const candidateTarget =
          candidate.targetPc === null
            ? null
            : graph.byPc.get(candidate.targetPc)?.id
        return (
          members.has(candidateSource) &&
          (candidateTarget === null || !members.has(candidateTarget))
        )
      })
      const headerEdges = edges.filter(
        (candidate) =>
          graph.byPc.get(candidate.sourcePc)?.id === target &&
          candidate.targetPc !== null &&
          members.has(graph.byPc.get(candidate.targetPc)?.id),
      )
      if (!exitEdges.length || !headerEdges.length) continue
      const key = `${target}:${[...members].sort().join(',')}`
      if (loops.some((loop) => loop.key === key)) continue
      loops.push({
        key,
        kind: 'natural-loop',
        headerBlockId: target,
        bodyBlockIds: [...members].sort(
          (left, right) => startPc.get(left) - startPc.get(right),
        ),
        continuationBlockId: region.continuation,
        trailing: region.trailing,
        trailingIsTest: region.trailingIsTest,
        continues: region.continues,
        headerCondition:
          headerEdges.find((candidate) => candidate.kind === 'conditional')
            ?.condition ?? null,
        proof:
          'header dominates the back-edge source, the body is the header statement region, and the loop has an explicit exit',
      })
    }
  }
  return loops.map((loop) => {
    const result = { ...loop }
    delete result.key
    return result
  })
}

// Where flow entering `id` arrives once it has passed its jump steps.
function jumpStepResolver(blocks, normal) {
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
function normalAdjacency(adjacency) {
  return new Map(
    [...adjacency].map(([id, successors]) => [
      id,
      successors.filter(({ edge }) => edge.route !== 'exceptional'),
    ]),
  )
}

// Where a control statement opened at a two-way branch closes: the first block both arms reach,
// each arm walking forward over normal edges and stopping at a transfer (an edge into one of
// `stops`, an enclosing loop's head or end). "First" is dominance over paths from the test through
// its arms only, so code the arms share with paths from outside the statement does not hide where
// they meet. If the arms never meet, an arm that starts at a stop closes the statement there;
// otherwise the fallthrough arm is the consequent and the branch target, the else-or-end, is the
// end. Arms that meet without a first block close nowhere.
function closeConditional(
  testId,
  branchId,
  fallthroughId,
  normal,
  stops,
  throughJumps,
) {
  const reached = new Map()
  const arm = (start) => {
    const seen = new Set()
    const ends = new Set(stops.has(start) ? [start] : [])
    const work = stops.has(start) ? [] : [start]
    while (work.length) {
      const id = work.pop()
      if (seen.has(id)) continue
      seen.add(id)
      for (const { target } of normal.get(id) ?? [])
        if (stops.has(target)) ends.add(target)
        else work.push(target)
    }
    reached.set(start, ends)
    return seen
  }
  const branchArm = arm(branchId)
  const fallthroughArm = arm(fallthroughId)
  const common = [...branchArm].filter((id) => fallthroughArm.has(id))
  const sharedStops = [...reached.get(branchId)].filter((id) =>
    reached.get(fallthroughId).has(id),
  )
  if (!common.length && sharedStops.length === 1)
    return {
      merge: sharedStops[0],
      proof: 'the arms meet only at a stop, so the statement closes there',
    }
  // The branch target is the else-or-end, at the stop its jump steps lead straight to.
  const end = stops.has(throughJumps(branchId))
    ? throughJumps(branchId)
    : branchId
  if (!common.length)
    return {
      merge: stops.has(fallthroughId) ? fallthroughId : end,
      proof:
        'the arms never meet: the transferring arm ends inside the statement',
    }
  const inside = new Set([testId, ...branchArm, ...fallthroughArm])
  const { dom } = dominators(
    inside,
    testId,
    new Map(
      [...inside].map((id) => [
        id,
        (normal.get(id) ?? []).filter(({ target }) => inside.has(target)),
      ]),
    ),
  )
  return {
    merge:
      common.find((candidate) =>
        common.every((id) => dom.get(id)?.has(candidate)),
      ) ?? null,
    proof: 'the merge is the first block both arms reach before a transfer',
  }
}

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
function findSwitchRegions(blocks, edges, graph, loops, control) {
  const normal = normalAdjacency(graph.adjacency)
  const throughJumps = jumpStepResolver(blocks, normal)
  const blockById = new Map(blocks.map((block) => [block.id, block]))
  const startPc = new Map(blocks.map((block) => [block.id, block.startPc]))
  const { reachable } = control
  const predecessors = new Map(blocks.map((block) => [block.id, []]))
  for (const [source, successors] of normal)
    if (reachable.has(source))
      for (const { target } of successors) predecessors.get(target).push(source)
  const captured = new Set(
    blocks.flatMap(({ instruction: { operation } }) =>
      operation.kind === 'closure'
        ? operation.captures
            .filter(({ kind }) => kind === 'local')
            .map(({ index }) => index)
        : [],
    ),
  )
  const stopsOf = (id) =>
    new Set(
      loops
        .filter((loop) => loop.bodyBlockIds.includes(id))
        .flatMap((loop) => [
          loop.headerBlockId,
          loop.continuationBlockId,
          loop.trailing[0],
        ])
        .filter(Boolean),
    )
  const next = (id) =>
    normal.get(id)?.length === 1 ? normal.get(id)[0].target : null
  const routes = (id) => {
    const kind = blockById.get(id).instruction.operation.kind
    return kind === 'catch-setup' || kind === 'finally-setup'
      ? graph.adjacency.get(id)
      : (normal.get(id) ?? [])
  }
  const stepsTo = (id) => {
    const steps = []
    while (
      isJumpStep(blockById.get(id)) &&
      !steps.includes(id) &&
      next(id) !== null
    ) {
      steps.push(id)
      id = next(id)
    }
    return { entry: id, steps }
  }
  const twoWay = (id) => {
    const leaf = blockById.get(id).instruction
    if (!reachable.has(id) || leaf.operation.kind !== 'branch') return null
    const outgoing = edges.filter((edge) => edge.sourcePc === leaf.pc)
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
    return {
      testBlockId: id,
      condition: leaf.operation.condition,
      match: graph.byPc.get(match.targetPc).id,
      miss: graph.byPc.get(miss.targetPc).id,
      branchId: graph.byPc.get(conditional.targetPc).id,
      fallthroughId: graph.byPc.get(fallthrough.targetPc).id,
    }
  }
  // The operands of the `===` whose result the branch reads, when nothing after it writes the
  // result or either operand.
  const compared = (operations, condition) => {
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
    if (
      operations
        .slice(index + 1)
        .some((later) =>
          writtenRegisters(later).some(
            (register) => register === condition || operands.includes(register),
          ),
        )
    )
      return null
    return operands
  }
  // The head's comparison may come from the straight run that enters its test.
  const headOperands = (test) => {
    let operations = []
    let current = test.testBlockId
    for (;;) {
      const operands = compared(operations, test.condition)
      if (operands) return operands
      const preds = predecessors.get(current)
      if (preds.length !== 1 || next(preds[0]) !== current) return null
      current = preds[0]
      operations = [blockById.get(current).instruction.operation, ...operations]
    }
  }
  // The next case: the straight run from a miss route to the next test, entered only from it.
  const nextCase = (test) => {
    const runBlockIds = []
    let current = test.miss
    let from = test.testBlockId
    while (!runBlockIds.includes(current)) {
      const preds = predecessors.get(current)
      if (preds.length !== 1 || preds[0] !== from) return null
      const following = twoWay(current)
      if (following) {
        const operations = [
          ...runBlockIds.map((id) => blockById.get(id).instruction.operation),
        ]
        if (operations.some(({ kind }) => RUN_BREAKING_KINDS.has(kind)))
          return null
        const operands = compared(operations, following.condition)
        return operands
          ? { ...following, runBlockIds, operands, operations }
          : null
      }
      if (next(current) === null) return null
      runBlockIds.push(current)
      from = current
      current = next(current)
    }
    return null
  }
  // The longest chain from `head` whose tests share one compared register and never write it.
  const chainFrom = (head) => {
    const operands = headOperands(head)
    if (!operands) return null
    const chain = [{ ...head, runBlockIds: [], operands, operations: [] }]
    let candidates = new Set(operands)
    for (;;) {
      const following = nextCase(chain.at(-1))
      if (!following) break
      const shared = following.operands.filter((register) =>
        candidates.has(register),
      )
      if (!shared.length) break
      candidates = new Set(shared)
      chain.push(following)
    }
    // The discriminant is the compared register the chain never writes; a case value register is
    // written by the runs, often one register reused for every value.
    while (chain.length >= 2) {
      const written = new Set(
        chain.flatMap(({ operations }) =>
          operations.flatMap((operation) => writtenRegisters(operation)),
        ),
      )
      const unwritten = [...candidates].filter(
        (register) => !written.has(register),
      )
      const discriminant = unwritten.length === 1 ? unwritten[0] : null
      if (
        discriminant !== null &&
        (!captured.has(discriminant) ||
          chain.every(({ operations }) =>
            operations.every(({ kind }) => kind === 'assign'),
          ))
      )
        return { chain, discriminant }
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

  const tests = blocks.map(({ id }) => twoWay(id)).filter(Boolean)
  const chains = tests
    .map((test) => ({ head: test, found: chainFrom(test) }))
    .filter(({ found }) => found)
  const continued = new Set(
    chains.flatMap(({ found }) =>
      found.chain.slice(1).map(({ testBlockId }) => testBlockId),
    ),
  )
  const regions = []
  for (const { head, found } of chains) {
    if (continued.has(head.testBlockId)) continue
    const { chain, discriminant } = found
    const stops = stopsOf(head.testBlockId)
    const unmerged = chain.some(
      (test) =>
        !closeConditional(
          test.testBlockId,
          test.branchId,
          test.fallthroughId,
          normal,
          stopsOf(test.testBlockId),
          throughJumps,
        ).merge,
    )
    if (!unmerged) continue
    const cases = chain.map((test) => {
      const { entry: entryBlockId, steps } = stepsTo(test.match)
      return {
        testBlockId: test.testBlockId,
        value: test.operands.find((register) => register !== discriminant),
        runBlockIds: test.runBlockIds,
        stepBlockIds: steps,
        entryBlockId,
      }
    })
    if (cases.some(({ value }) => value === undefined)) continue
    const miss = stepsTo(chain.at(-1).miss)
    const chainBlocks = new Set([
      ...cases.flatMap(({ testBlockId, runBlockIds, stepBlockIds }) => [
        testBlockId,
        ...runBlockIds,
        ...stepBlockIds,
      ]),
      ...miss.steps,
    ])
    const entries = [
      ...new Set([
        ...cases.map(({ entryBlockId }) => entryBlockId),
        miss.entry,
      ]),
    ]
    // Members for an end: what the bodies reach before it or a stop, closed against entry from
    // anywhere but the chain. A try inside a body is a member with its catch or finalizer, which
    // its setup's own handler route enters.
    const membersFor = (end) => {
      const members = new Set()
      const work = entries.filter((id) => id !== end && !stops.has(id))
      while (work.length) {
        const id = work.pop()
        if (members.has(id)) continue
        members.add(id)
        for (const { target } of routes(id))
          if (target !== end && !stops.has(target)) work.push(target)
      }
      const closed = [...members].every(
        (id) =>
          !chainBlocks.has(id) &&
          predecessors
            .get(id)
            .every((pred) => members.has(pred) || chainBlocks.has(pred)),
      )
      return closed ? members : null
    }
    const everything = membersFor(null)
    const candidates = [
      ...new Set([
        ...[...(everything ?? [])].flatMap((id) =>
          (normal.get(id) ?? []).map(({ target }) => target),
        ),
        ...entries,
      ]),
    ]
    // The end is the nearest such block: the one leaving the fewest members. With none, every
    // body leaves by a transfer.
    let end = null
    let members = everything
    for (const candidate of candidates) {
      const found = membersFor(candidate)
      if (!found || found.has(candidate)) continue
      if (end === null || found.size < members.size) {
        end = candidate
        members = found
      }
    }
    if (members === null) continue
    // Which entry each body falls into: the one other entry its walk reaches before the end.
    const fallsInto = new Map()
    let shared = false
    for (const start of entries) {
      if (start === end) continue
      const reached = new Set()
      const seen = new Set()
      const work = [start]
      while (work.length) {
        const id = work.pop()
        if (seen.has(id)) continue
        seen.add(id)
        for (const { target } of normal.get(id) ?? []) {
          if (target === end || stops.has(target)) continue
          if (entries.includes(target) && target !== start) reached.add(target)
          else work.push(target)
        }
      }
      if (reached.size > 1) shared = true
      if (reached.size === 1) fallsInto.set(start, [...reached][0])
    }
    if (shared) continue
    const caseClauses = cases.map(({ entryBlockId }, caseIndex) => ({
      caseIndex,
      entryBlockId,
    }))
    const hasDefault = miss.entry !== end
    const fits = (clauses) => {
      const groups = []
      for (const clause of clauses)
        if (groups.at(-1)?.entryBlockId === clause.entryBlockId)
          groups.at(-1).clauses.push(clause)
        else
          groups.push({ entryBlockId: clause.entryBlockId, clauses: [clause] })
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
    let clauses = null
    for (let position = caseClauses.length; position >= 0; position -= 1) {
      const candidate = hasDefault
        ? [
            ...caseClauses.slice(0, position),
            { caseIndex: null, entryBlockId: miss.entry },
            ...caseClauses.slice(position),
          ]
        : caseClauses
      if (fits(candidate)) {
        clauses = candidate
        break
      }
      if (!hasDefault) break
    }
    if (!clauses) continue
    regions.push({
      kind: 'switch',
      testBlockId: head.testBlockId,
      discriminant,
      cases,
      defaultEntryBlockId: hasDefault ? miss.entry : null,
      defaultStepBlockIds: miss.steps,
      clauses,
      continuationBlockId: end,
      memberBlockIds: [...members].sort(
        (left, right) => startPc.get(left) - startPc.get(right),
      ),
      proof:
        'a chain of === tests on one unchanged register whose case bodies share routes; each body falling into another is followed by it',
    })
  }
  return regions
}

// A conditional closes where the walk returns to its depth: the first block both arms reach,
// each arm's walk stopping at a transfer (a return or throw, or an edge to an enclosing loop's
// head or end). If the arms never meet, an arm that starts at such a head or end (a loop's own
// test leaving it) closes there; otherwise the fallthrough arm is the consequent and the branch
// target, the else-or-end, is the end. An exceptional route into a handler or finalizer leaves
// the statement rather than joining its arms, so it is never followed.
function findConditionalRegions(blocks, edges, graph, loops, switches) {
  const normal = normalAdjacency(graph.adjacency)
  const throughJumps = jumpStepResolver(blocks, normal)
  const switchTests = new Set(
    switches.flatMap(({ cases }) =>
      cases.map(({ testBlockId }) => testBlockId),
    ),
  )
  const regions = []
  for (const block of blocks) {
    if (switchTests.has(block.id)) continue
    const outgoing = edges.filter((edge) => edge.sourcePc === block.startPc)
    const conditional = outgoing.find((edge) => edge.kind === 'conditional')
    const fallthrough = outgoing.find((edge) => edge.kind === 'fallthrough')
    if (
      !conditional ||
      !fallthrough ||
      conditional.targetPc === null ||
      fallthrough.targetPc === null
    )
      continue
    const branchBlock = graph.byPc.get(conditional.targetPc)
    const fallthroughBlock = graph.byPc.get(fallthrough.targetPc)
    if (!branchBlock || !fallthroughBlock) continue
    const stops = new Set(
      loops
        .filter((loop) => loop.bodyBlockIds.includes(block.id))
        .flatMap((loop) => [
          loop.headerBlockId,
          loop.continuationBlockId,
          loop.trailing[0],
        ])
        .filter(Boolean),
    )
    // Inside a switch body, its end is a break and another clause's entry a fallthrough.
    for (const region of switches)
      if (region.memberBlockIds.includes(block.id))
        for (const id of [
          region.continuationBlockId,
          ...region.clauses.map(({ entryBlockId }) => entryBlockId),
        ])
          if (id) stops.add(id)
    const { merge, proof } = closeConditional(
      block.id,
      branchBlock.id,
      fallthroughBlock.id,
      normal,
      stops,
      throughJumps,
    )
    if (!merge) continue
    regions.push({
      kind: 'conditional',
      testBlockId: block.id,
      condition: conditional.condition,
      branchTargetPc: conditional.targetPc,
      fallthroughTargetPc: fallthrough.targetPc,
      mergeBlockId: merge,
      proof,
    })
  }
  return regions
}

// A loop's trailing run is where its continues arrive when a statement inside the loop jumps
// there without closing there: a try that closes elsewhere while one of its blocks jumps to the
// run, or a conditional whose arm reaches the run while the conditional closes elsewhere and no
// inner loop holding it ends at the run. Only then is the run the loop's update, published as its
// continue target; otherwise the run is ordinary body code.
function publishContinueTargets(loops, conditionals, graph) {
  const normal = normalAdjacency(graph.adjacency)
  const reaches = (start, blocked, goal) => {
    const seen = new Set()
    const work = [start]
    while (work.length) {
      const id = work.pop()
      if (id === goal) return true
      if (seen.has(id) || blocked.has(id)) continue
      seen.add(id)
      for (const { target } of normal.get(id) ?? []) work.push(target)
    }
    return false
  }
  for (const loop of loops) {
    const target = loop.trailing[0] ?? null
    const stopsOf = (testBlockId) =>
      new Set(
        loops
          .filter((other) => other.bodyBlockIds.includes(testBlockId))
          .flatMap((other) => [
            other.headerBlockId,
            other.continuationBlockId,
            other.trailing[0],
          ])
          .filter(Boolean),
      )
    const routed =
      target !== null &&
      (loop.continues.length > 0 ||
        conditionals.some((conditional) => {
          if (!loop.bodyBlockIds.includes(conditional.testBlockId)) return false
          // An inner loop that ends at the run explains a jump to it from inside: its break.
          if (
            loops.some(
              (inner) =>
                inner !== loop &&
                inner.continuationBlockId === target &&
                inner.bodyBlockIds.includes(conditional.testBlockId),
            )
          )
            return false
          const stops = stopsOf(conditional.testBlockId)
          if (stops.has(conditional.mergeBlockId)) return false
          const blocked = new Set([...stops, conditional.mergeBlockId])
          blocked.delete(target)
          return conditional.startIds.some((start) =>
            reaches(start, blocked, target),
          )
        }))
    loop.continueBlockId = routed ? target : null
    loop.updateBlockIds = routed && !loop.trailingIsTest ? loop.trailing : null
    loop.testBlockIds = routed && loop.trailingIsTest ? loop.trailing : null
  }
  for (const loop of loops) {
    delete loop.trailing
    delete loop.trailingIsTest
    delete loop.continues
  }
}

// The regions of one structured function, in the order the emitter indexes them: a linear run
// when every edge falls through or returns; otherwise conditionals, then loops, then one opaque
// row listing every block that is neither a conditional test nor a loop header. Reachability and
// handler state come from the control solver's result (`solveControl`).
export function planStatements(functionRecord, cases, solved) {
  const blocks = [...cases]
    .sort((left, right) => left.pc - right.pc)
    .map((instruction) => ({
      id: `${functionRecord.id}:b@${instruction.pc}`,
      startPc: instruction.pc,
      instruction,
    }))
  const { edges } = solved
  const blockOrder = blocks.map(({ id }) => id)
  if (
    edges.every(
      (edge) => edge.kind === 'fallthrough' || edge.kind === 'return',
    ) &&
    !blocks.some((block) =>
      ['catch-setup', 'finally-setup'].includes(
        block.instruction.operation.kind,
      ),
    )
  )
    return [
      {
        kind: 'linear',
        blockIds: blockOrder,
        proof:
          'every reachable successor is the next serialized block or an explicit return',
      },
    ]
  const entry = `${functionRecord.id}:b@${functionRecord.startPc}`
  const graph = blockGraph(blocks, edges)
  const reachablePcs = new Set(solved.reachablePcs)
  const control = {
    reachable: new Set(
      blocks
        .filter((block) => reachablePcs.has(block.startPc))
        .map(({ id }) => id),
    ),
    stateIn: solved.stateIn,
  }
  const statements = findStatementRegions(entry, blocks, edges, graph, control)
  const loops = findNaturalLoops(
    entry,
    blocks,
    edges,
    graph,
    statements,
    control,
  )
  const startPc = new Map(blocks.map((block) => [block.id, block.startPc]))
  const tries = statements
    .filter(({ kind }) => kind === 'try')
    .map((statement) => ({
      kind: 'try',
      setupBlockId: statement.head,
      continuationBlockId: statement.continuation,
      layoutEndBlockId: statement.layoutEnd,
      memberBlockIds: [...statement.members].sort(
        (left, right) => startPc.get(left) - startPc.get(right),
      ),
      proof:
        'the setup dominates every member; the continuation is where its normal exit tail leads',
    }))
  const switches = findSwitchRegions(blocks, edges, graph, loops, control)
  const conditionals = findConditionalRegions(
    blocks,
    edges,
    graph,
    loops,
    switches,
  )
  // A switch takes part as a statement whose arms are its clause bodies and the default route.
  publishContinueTargets(
    loops,
    [
      ...conditionals.map((conditional) => ({
        testBlockId: conditional.testBlockId,
        mergeBlockId: conditional.mergeBlockId,
        startIds: [
          conditional.branchTargetPc,
          conditional.fallthroughTargetPc,
        ].map((pc) => graph.byPc.get(pc).id),
      })),
      ...switches.map((region) => ({
        testBlockId: region.testBlockId,
        mergeBlockId: region.continuationBlockId,
        startIds: region.clauses.map(({ entryBlockId }) => entryBlockId),
      })),
    ],
    graph,
  )
  const regions = [...conditionals, ...switches, ...loops]
  const covered = new Set(
    regions.flatMap((region) =>
      region.kind === 'conditional'
        ? [region.testBlockId]
        : region.kind === 'switch'
          ? region.cases.map(({ testBlockId }) => testBlockId)
          : [region.headerBlockId],
    ),
  )
  const unsupported = blockOrder.filter((id) => !covered.has(id))
  if (unsupported.length)
    regions.push({
      kind: 'opaque',
      blockIds: unsupported,
      reason: 'control shape not structurally proved by the accepted CFG',
    })
  regions.push(...tries)
  return regions
}
