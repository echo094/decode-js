import {
  armAdjacency,
  dominators,
  jumpStepResolver,
  laterEnds,
  successorMap,
  normalAdjacency,
  walkForward,
} from './graph.js'

// Conditional regions: where a test's two arms close, and the `if` statements they form.

const NO_HOLDING = Object.freeze({ ends: new Set(), inner: new Set() })

// The heads, ends and trailing-run heads of every loop whose body holds `id`.
export function loopStops(loops, id) {
  return loops
    .filter((loop) => loop.bodyBlockIds.includes(id))
    .flatMap((loop) => [
      loop.headerBlockId,
      loop.continuationBlockId,
      loop.trailing[0],
    ])
    .filter(Boolean)
}

// Every two-way test that is no switch's test, with its arm targets.
export function twoWayTests(blocks, edges, graph, switches) {
  const switchTests = new Set(
    switches.flatMap(({ cases }) =>
      cases.map(({ testBlockId }) => testBlockId),
    ),
  )
  const outgoing = Map.groupBy(edges, (edge) => edge.sourcePc)
  return blocks
    .filter((block) => !switchTests.has(block.id))
    .map((block) => testAt(block, outgoing.get(block.startPc) ?? [], graph))
    .filter(Boolean)
}

function testAt(block, outgoing, graph) {
  const conditional = outgoing.find((edge) => edge.kind === 'conditional')
  const fallthrough = outgoing.find((edge) => edge.kind === 'fallthrough')
  if (
    !conditional ||
    !fallthrough ||
    conditional.targetPc === null ||
    fallthrough.targetPc === null
  )
    return null
  const branchBlock = graph.byPc.get(conditional.targetPc)
  const fallthroughBlock = graph.byPc.get(fallthrough.targetPc)
  if (!branchBlock || !fallthroughBlock) return null
  return {
    testBlockId: block.id,
    branchId: branchBlock.id,
    fallthroughId: fallthroughBlock.id,
    condition: conditional.condition,
    branchTargetPc: conditional.targetPc,
    fallthroughTargetPc: fallthrough.targetPc,
  }
}

// The stops each test's enclosing loops, switches and tries give it; these statements are fixed
// while conditionals are found. Inside a switch body, its end is a break and another clause's
// entry a fallthrough. The end of the innermost try holding the test is that statement's end, a
// stop like a loop's: an arm reaching it leaves the try, never running on into the code after it.
// A catch whose block never completes normally ends at its layout end, a stop too; only a
// reachable end closes an arm that alone reaches it.
export function enclosingStops(tests, loops, switches, statements) {
  const tries = statements.filter(({ kind }) => kind === 'try')
  return new Map(
    tests.map(({ testBlockId: id }) => {
      const tryEnd = innermostTryEnd(tries, id)
      return [
        id,
        {
          stops: [
            ...loopStops(loops, id),
            ...switchStops(switches, id),
            ...(tryEnd ? [tryEnd] : []),
            ...layoutEnds(tries, id),
          ],
          tryEnd,
        },
      ]
    }),
  )
}

function switchStops(switches, id) {
  return switches
    .filter((region) => region.memberBlockIds.includes(id))
    .flatMap((region) => [
      region.continuationBlockId,
      ...region.clauses.map(({ entryBlockId }) => entryBlockId),
    ])
    .filter(Boolean)
}

// Statements run outermost first, so the last try holding the test is the innermost.
function innermostTryEnd(tries, id) {
  return (
    tries
      .filter(
        ({ members, continuation }) =>
          members.has(id) && continuation && !members.has(continuation),
      )
      .at(-1)?.continuation ?? null
  )
}

function layoutEnds(tries, id) {
  return tries
    .filter(
      ({ members, continuation, layoutEnd }) =>
        members.has(id) &&
        !continuation &&
        layoutEnd &&
        !members.has(layoutEnd),
    )
    .map(({ layoutEnd }) => layoutEnd)
}

// The arms' walk: normal edges plus each catch setup's edge to its catch, and the jump-step
// resolver over normal edges.
export function armWalk(blocks, graph) {
  const normal = normalAdjacency(graph.adjacency)
  return {
    adjacency: armAdjacency(graph, blocks, normal),
    throughJumps: jumpStepResolver(blocks, normal),
  }
}

// A test's bounds: its enclosing stops, and those of the labeled blocks holding it. Inside a
// labeled block its end is a break, and inside its conditional that one's merge is a stop as well,
// so a test there closes without reading through the block's end.
function holdingStops(id, enclosing, labeled, dom) {
  const { stops, tryEnd } = enclosing.get(id)
  const holding = { ends: new Set(), inner: new Set() }
  const blockStops = []
  for (const row of labeled) {
    if (!dom.get(id)?.has(row.headBlockId)) continue
    const inner = row.headBlockId === id ? [] : row.innerStopBlockIds
    blockStops.push(
      ...[...row.endBlockIds, ...inner].filter(
        (stop) => !dom.get(id).has(stop),
      ),
    )
    for (const end of row.endBlockIds) holding.ends.add(end)
    for (const stop of inner) holding.inner.add(stop)
  }
  return { stops: new Set([...stops, ...blockStops]), tryEnd, holding }
}

// The blocks an arm reaches from `start` without entering a stop, and the stops it reaches; an
// arm starting at a stop is empty and reaches that stop.
function walkArm(start, adjacency, stops) {
  const blocks = new Set()
  const ends = new Set(stops.has(start) ? [start] : [])
  const work = stops.has(start) ? [] : [start]
  while (work.length) {
    const id = work.pop()
    if (blocks.has(id)) continue
    blocks.add(id)
    for (const { target } of adjacency.get(id) ?? [])
      if (stops.has(target)) ends.add(target)
      else work.push(target)
  }
  return { blocks, ends }
}

// Where a control statement opened at a two-way branch closes: the first block both arms reach,
// each arm walking forward over `walk.adjacency` and stopping at a transfer (an edge into one of
// `bounds.stops`, an enclosing statement's end, among them `bounds.tryEnd`, the end of the
// innermost try holding the test). "First" is dominance over paths from the test through its arms
// only, so code the arms share with paths from outside the statement does not hide where they
// meet. Arms that never meet close as `closeApart` says; arms that meet without a first block
// close nowhere.
export function closeConditional(test, walk, bounds) {
  const arms = {
    branch: walkArm(test.branchId, walk.adjacency, bounds.stops),
    fallthrough: walkArm(test.fallthroughId, walk.adjacency, bounds.stops),
  }
  const common = [...arms.branch.blocks].filter((id) =>
    arms.fallthrough.blocks.has(id),
  )
  if (!common.length) return closeApart(test, arms, walk.throughJumps, bounds)
  return firstShared(test.testBlockId, arms, common, walk)
}

// Arms that never meet: an arm that starts at a stop closes the statement there; a fallthrough arm
// that reaches `tryEnd` while the other does not, does not end inside the statement, so the
// statement closes at that end; otherwise the fallthrough arm is the consequent and the branch
// target, the else-or-end, is the end.
function closeApart(test, { branch, fallthrough }, throughJumps, bounds) {
  const { stops, tryEnd = null, holding = NO_HOLDING } = bounds
  const sharedStops = [...branch.ends].filter((id) => fallthrough.ends.has(id))
  if (sharedStops.length === 1)
    return {
      merge: sharedStops[0],
      proof: 'the arms meet only at a stop, so the statement closes there',
    }
  if (fallthrough.ends.has(tryEnd) && !branch.ends.has(tryEnd))
    return {
      merge: tryEnd,
      proof:
        'the arms never meet: one leaves for the end of the try holding them',
    }
  // The branch target is the else-or-end, at the stop its jump steps lead straight to.
  const end = stops.has(throughJumps(test.branchId))
    ? throughJumps(test.branchId)
    : test.branchId
  const fallback = stops.has(test.fallthroughId) ? test.fallthroughId : end
  // Inside a labeled block, an else-or-end at the block's end is a `break`, never where the
  // test closes: when the arms reach the block's inner stop, where the conditional heading it
  // closes, the test closes there and the arm reaching the end breaks.
  const completes = [
    ...new Set(
      [branch, fallthrough].flatMap((arm) =>
        [...arm.ends].filter((stop) => holding.inner.has(stop)),
      ),
    ),
  ]
  if (holding.ends.has(fallback) && completes.length === 1)
    return {
      merge: completes[0],
      proof:
        'the arms never meet: one breaks the labeled block holding them, the other completes',
    }
  return {
    merge: fallback,
    proof:
      'the arms never meet: the transferring arm ends inside the statement',
  }
}

// The common block dominating every other, over the test and its arms only.
function firstShared(testBlockId, { branch, fallthrough }, common, walk) {
  const inside = new Set([testBlockId, ...branch.blocks, ...fallthrough.blocks])
  const { dom } = dominators(
    inside,
    testBlockId,
    new Map(
      [...inside].map((id) => [
        id,
        (walk.adjacency.get(id) ?? []).filter(({ target }) =>
          inside.has(target),
        ),
      ]),
    ),
  )
  const firstOf = (shared) =>
    shared.find((candidate) =>
      shared.every((id) => dom.get(id)?.has(candidate)),
    ) ?? null
  // A jump step runs nothing: on one route into the merge it hides no statement.
  return {
    merge:
      firstOf(common) ??
      firstOf(common.filter((id) => walk.throughJumps(id) === id)),
    proof: 'the merge is the first block both arms reach before a transfer',
  }
}

// Arms that meet without a first block, on no switch's chain: a labeled exit skips code another
// route runs. The block ends at the nearest shared block whose removal gives the arms a first
// block, that block closing the conditional, and that a route from the test skipping that block
// reaches: where the exit lands, past the code it skips. Over the arms' own adjacency, so a route
// through a catch reaches where its exit lands. Null when no shared block does.
function labeledExit(test, walk, bounds) {
  const { stops } = bounds
  const next = successorMap(walk.adjacency)
  const reach = (start, avoid) => walkForward(start, next, avoid, new Set())
  const starts = [test.branchId, test.fallthroughId]
  const other = new Set(reach(test.fallthroughId, stops))
  for (const end of reach(test.branchId, stops)) {
    if (!other.has(end)) continue
    const closed = closeConditional(test, walk, {
      ...bounds,
      stops: new Set([...stops, end]),
    })
    if (!closed.merge || closed.merge === end) continue
    const skipping = new Set([...stops, closed.merge])
    if (!starts.some((start) => reach(start, skipping).includes(end))) continue
    return { ...closed, row: exitRow(test, end, closed.merge, next, stops) }
  }
  return null
}

// Further labeled exits leave past this end, as a loop's or a try's do: what the arms reach before
// the merge and the end, less the end's own walk, meets that walk later.
function exitRow(test, end, merge, next, stops) {
  const after = new Set(walkForward(end, next, new Set(), stops))
  const skipped = new Set([...stops, merge, end])
  const inside = new Set(
    [test.branchId, test.fallthroughId].flatMap((start) =>
      walkForward(start, next, skipped, new Set()).filter(
        (id) => !after.has(id),
      ),
    ),
  )
  return {
    kind: 'labeled-block',
    headBlockId: test.testBlockId,
    endBlockIds: [end, ...laterEnds(inside, end, next, stops)],
    innerStopBlockIds: [merge],
    proof:
      'the arms have no first shared block until this block closes a statement around them',
  }
}

// A conditional closes where the walk returns to its depth. A test that infers a labeled exit adds
// its row; a new block's end is a stop for the tests inside it, so the passes repeat until no row
// is added. A row added in a pass bounds the tests after it in that pass.
export function closeConditionals(tests, enclosing, walk, labeled, dom) {
  const rows = [...labeled]
  let conditionals
  let count
  do {
    count = rows.length
    conditionals = []
    for (const test of tests) {
      const bounds = holdingStops(test.testBlockId, enclosing, rows, dom)
      const closed = closeConditional(test, walk, bounds)
      const exit = closed.merge ? null : labeledExit(test, walk, bounds)
      if (exit) rows.push(exit.row)
      const { merge, proof } = exit ?? closed
      if (merge) conditionals.push(conditionalRegion(test, merge, proof))
    }
  } while (rows.length !== count)
  return { conditionals, labeled: rows }
}

function conditionalRegion(test, merge, proof) {
  return {
    kind: 'conditional',
    testBlockId: test.testBlockId,
    condition: test.condition,
    branchTargetPc: test.branchTargetPc,
    fallthroughTargetPc: test.fallthroughTargetPc,
    mergeBlockId: merge,
    proof,
  }
}
