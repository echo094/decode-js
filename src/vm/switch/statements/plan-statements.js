import {
  armWalk,
  closeConditionals,
  enclosingStops,
  twoWayTests,
} from './conditionals.js'
import { FunctionGraph, normalAdjacency } from './graph.js'
import { findStatementRegions } from './statement-regions.js'
import { findSwitchRegions } from './switches.js'

// Statement recovery for one structured function of a VM switch model: the regions the
// structured emitter renders (loops, conditionals, a linear run, or the nodes no region covers).
// A node is one case; it reads only the typed operations and the control solver's result (its
// edges, reachability and handler stacks), so it needs no knowledge of the encoder that produced
// them.

// One row per loop header, its body the header's statement region.
function findNaturalLoops(view, statementRegions) {
  const { edges, graph, reachable, dom } = view
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
        bodyBlockIds: view.sortedByPc(members),
        continuationBlockId: region.continuation,
        trailing: region.trailing,
        trailingIsTest: region.trailingIsTest,
        continues: region.continues,
        exitTestBlockId: region.exitTest?.test ?? null,
        exitTestAtBottom: region.exitTest?.bottom ?? false,
        exitTestRunBlockIds:
          region.exitTest && !region.exitTest.bottom
            ? region.exitTest.run
            : null,
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

// Step 1: a function whose edges all fall through or return and which sets up no try is one run.
function linearRegion(blocks, edges) {
  if (
    !edges.every(
      (edge) => edge.kind === 'fallthrough' || edge.kind === 'return',
    ) ||
    blocks.some((block) =>
      ['catch-setup', 'finally-setup'].includes(
        block.instruction.operation.kind,
      ),
    )
  )
    return null
  return {
    kind: 'linear',
    blockIds: blocks.map(({ id }) => id),
    proof:
      'every reachable successor is the next serialized block or an explicit return',
  }
}

// Steps 2-5: statement regions, natural loops and switch rows. A try in a clause body cannot tell
// the switch's end, where a break out of the switch lands, from its own: switch rows are found
// after the statements. Once they are, a function with such a try is planned again with those ends
// as breaks.
function findRegions(view) {
  const pass = (switchEnds) => {
    const statements = findStatementRegions(view, switchEnds)
    const loops = findNaturalLoops(view, statements)
    const switchRows = findSwitchRegions(
      view.blocks,
      view.edges,
      view.graph,
      loops,
      view.control,
    )
    return { statements, loops, switchRows }
  }
  const first = pass()
  const switchEnds = (head) =>
    first.switchRows.regions
      .filter(
        ({ continuationBlockId, memberBlockIds }) =>
          continuationBlockId && memberBlockIds.includes(head),
      )
      .map(({ continuationBlockId }) => continuationBlockId)
  return first.statements.some(
    ({ kind, head }) => kind === 'try' && switchEnds(head).length,
  )
    ? pass(switchEnds)
    : first
}

function tryRows(view, statements) {
  return statements
    .filter(({ kind }) => kind === 'try')
    .map((statement) => ({
      kind: 'try',
      setupBlockId: statement.head,
      continuationBlockId: statement.continuation,
      layoutEndBlockId: statement.layoutEnd,
      memberBlockIds: view.sortedByPc(statement.members),
      proof:
        'the setup dominates every member; the continuation is where its normal exit tail leads',
    }))
}

// Step 6: a statement region with labeled later ends heads a labeled block.
function labeledRows(statements) {
  return statements
    .filter(({ blockEnds }) => blockEnds.length)
    .map(({ head, blockEnds }) => ({
      kind: 'labeled-block',
      headBlockId: head,
      endBlockIds: blockEnds,
      innerStopBlockIds: [],
      proof:
        'a labeled exit leaves the statement past code no other layout can hold',
    }))
}

// Step 7: the conditionals, given every earlier end as a stop, and the labeled rows they leave.
function findConditionals(view, statements, loops, switches, switchBlocks) {
  const tests = twoWayTests(view.blocks, view.edges, view.graph, switches)
  return closeConditionals(
    tests,
    enclosingStops(tests, loops, switches, statements),
    armWalk(view.blocks, view.graph),
    [...labeledRows(statements), ...switchBlocks],
    view.dom,
  )
}

// The statements whose arms may jump to a loop's trailing run: each conditional, and a switch as a
// statement whose arms are its clause bodies and the default route.
function continueStatements(conditionals, switches, graph) {
  return [
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
  ]
}

// Step 9: every block that is neither a conditional test, a switch test nor a loop header.
function opaqueRow(regions, blocks) {
  const covered = new Set(
    regions.flatMap((region) =>
      region.kind === 'conditional'
        ? [region.testBlockId]
        : region.kind === 'switch'
          ? region.cases.map(({ testBlockId }) => testBlockId)
          : [region.headerBlockId],
    ),
  )
  const unsupported = blocks
    .map(({ id }) => id)
    .filter((id) => !covered.has(id))
  return unsupported.length
    ? {
        kind: 'opaque',
        blockIds: unsupported,
        reason: 'control shape not structurally proved by the accepted CFG',
      }
    : null
}

// The regions of one structured function, in the order the emitter indexes them: a linear run
// when every edge falls through or returns; otherwise conditionals, then switches, then loops,
// then one opaque row listing every block that is neither a conditional test nor a loop header,
// then the tries and the labeled blocks. Reachability and handler state come from the control
// solver's result (`solveControl`).
export function planStatements(functionRecord, cases, solved) {
  const blocks = [...cases]
    .sort((left, right) => left.pc - right.pc)
    .map((instruction) => ({
      id: `${functionRecord.id}:b@${instruction.pc}`,
      startPc: instruction.pc,
      instruction,
    }))
  const linear = linearRegion(blocks, solved.edges)
  if (linear) return [linear]
  const view = new FunctionGraph(
    `${functionRecord.id}:b@${functionRecord.startPc}`,
    blocks,
    solved.edges,
    solved,
  )
  const { statements, loops, switchRows } = findRegions(view)
  const { regions: switches, labeled: switchBlocks } = switchRows
  const { conditionals, labeled } = findConditionals(
    view,
    statements,
    loops,
    switches,
    switchBlocks,
  )
  publishContinueTargets(
    loops,
    continueStatements(conditionals, switches, view.graph),
    view.graph,
  )
  const regions = [...conditionals, ...switches, ...loops]
  const opaque = opaqueRow(regions, blocks)
  if (opaque) regions.push(opaque)
  regions.push(...tryRows(view, statements), ...labeled)
  return regions
}
