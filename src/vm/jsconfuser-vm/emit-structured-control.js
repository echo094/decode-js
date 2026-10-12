import { indexWordcode } from './wordcode-index.js'
import {
  CFG_SCHEMA,
  EXCEPTION_FINALLY_SCHEMA,
  STRUCTURED_CONTROL_SCHEMA,
  StructuredControlDecline,
  WORDCODE_SCHEMA,
  arrayEqual,
  cloneData,
  decline,
  deepFreeze,
} from './structured-control-contract.js'
import { edgeKey } from './structured-control-input.js'
import { indexCfg } from './structured-control-cfg.js'
import { indexExceptionFinally } from './structured-control-exceptions.js'

function blockGraph(fn, edges, blockById) {
  const byPc = new Map(
    fn.instructionPcs.map((pc) => [
      pc,
      [...blockById.values()].find((block) =>
        block.instructionPcs.includes(pc),
      ),
    ]),
  )
  const adjacency = new Map(
    [...blockById.values()].map((block) => [block.id, []]),
  )
  for (const edge of edges) {
    const sourceBlock = byPc.get(edge.sourcePc)
    if (!sourceBlock)
      decline(
        'invalid-basic-block',
        `No block owns edge source ${edge.sourcePc}`,
      )
    if (edge.targetPc !== null) {
      const targetBlock = byPc.get(edge.targetPc)
      if (!targetBlock)
        decline(
          'invalid-basic-block',
          `No block owns edge target ${edge.targetPc}`,
        )
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

function naturalLoop(header, source, predecessors) {
  const loop = new Set([header, source])
  const work = [source]
  while (work.length) {
    const node = work.pop()
    for (const predecessor of predecessors.get(node) ?? []) {
      if (!loop.has(predecessor)) {
        loop.add(predecessor)
        if (predecessor !== header) work.push(predecessor)
      }
    }
  }
  return loop
}

function findNaturalLoops(fn, edges, blockById, edgeIdsByKey) {
  const graph = blockGraph(fn, edges, blockById)
  const reachable = reachableBlockIds(
    `${fn.id}:b@${fn.startPc}`,
    graph.adjacency,
  )
  const { dom, predecessors } = dominators(
    reachable,
    `${fn.id}:b@${fn.startPc}`,
    graph.adjacency,
  )
  const loops = []
  for (const [source, successors] of graph.adjacency) {
    for (const { target, edge } of successors) {
      if (
        !reachable.has(source) ||
        !reachable.has(target) ||
        !dom.get(source)?.has(target) ||
        source === target
      )
        continue
      const members = naturalLoop(target, source, predecessors)
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
        backEdgeIds: [edgeIdsByKey.get(edgeKey(edge))],
        bodyBlockIds: [...members].sort(
          (left, right) =>
            blockById.get(left).startPc - blockById.get(right).startPc,
        ),
        exitEdgeIds: exitEdges.map((candidate) =>
          edgeIdsByKey.get(edgeKey(candidate)),
        ),
        headerCondition:
          headerEdges.find((candidate) => candidate.kind === 'conditional')
            ?.condition ?? null,
        proof:
          'header dominates the back-edge source and the loop has an explicit exit',
      })
    }
  }
  return loops.map((loop) => {
    const result = { ...loop }
    delete result.key
    return result
  })
}

function bfsDistances(start, adjacency) {
  const distances = new Map([[start, 0]])
  const queue = [start]
  while (queue.length) {
    const current = queue.shift()
    for (const { target } of adjacency.get(current) ?? []) {
      if (!distances.has(target)) {
        distances.set(target, distances.get(current) + 1)
        queue.push(target)
      }
    }
  }
  return distances
}

function terminalBranchBlocks(start, graph, edges) {
  const visiting = new Set()
  const visited = new Set()
  const handlerTargets = new Set()
  function walk(id) {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    const block = [...graph.byPc.values()].find((item) => item.id === id)
    if (!block) return false
    const outgoing = edges.filter(
      (edge) => edge.sourcePc === block.instructionPcs.at(-1),
    )
    if (!outgoing.length) return false
    visiting.add(id)
    for (const edge of outgoing) {
      if (edge.kind === 'handler' && edge.targetPc !== null) {
        const target = graph.byPc.get(edge.targetPc)
        if (!target) return false
        handlerTargets.add(target.id)
        continue
      }
      if (edge.targetPc === null) {
        if (edge.kind !== 'return' && edge.kind !== 'throw') return false
      } else {
        if (
          !['fallthrough', 'conditional', 'branch', 'call'].includes(edge.kind)
        )
          return false
        const target = graph.byPc.get(edge.targetPc)
        if (!target || !walk(target.id)) return false
      }
    }
    visiting.delete(id)
    visited.add(id)
    return true
  }
  return walk(start) ? { blocks: visited, handlerTargets } : null
}

function findConditionalRegions(fn, edges, blockById, edgeIdsByKey) {
  const graph = blockGraph(fn, edges, blockById)
  const regions = []
  for (const block of blockById.values()) {
    const outgoing = edges.filter(
      (edge) => edge.sourcePc === block.instructionPcs.at(-1),
    )
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
    const left = bfsDistances(branchBlock.id, graph.adjacency)
    const right = bfsDistances(fallthroughBlock.id, graph.adjacency)
    const candidates = [...left.keys()].filter((candidate) =>
      right.has(candidate),
    )
    if (!candidates.length) {
      const branchTerminal = terminalBranchBlocks(branchBlock.id, graph, edges)
      const fallthroughTerminal = terminalBranchBlocks(
        fallthroughBlock.id,
        graph,
        edges,
      )
      if (
        !branchTerminal ||
        !fallthroughTerminal ||
        [...branchTerminal.blocks].some((id) =>
          fallthroughTerminal.blocks.has(id),
        )
      )
        continue
      const handlerTargets = new Set([
        ...branchTerminal.handlerTargets,
        ...fallthroughTerminal.handlerTargets,
      ])
      if (handlerTargets.size > 1) continue
      regions.push({
        kind: 'conditional',
        testBlockId: block.id,
        condition: cloneData(conditional.condition),
        branchEdgeId: edgeIdsByKey.get(edgeKey(conditional)),
        branchTargetPc: conditional.targetPc,
        fallthroughEdgeId: edgeIdsByKey.get(edgeKey(fallthrough)),
        fallthroughTargetPc: fallthrough.targetPc,
        mergeBlockId: null,
        branchTerminalBlockIds: [...branchTerminal.blocks],
        fallthroughTerminalBlockIds: [...fallthroughTerminal.blocks],
        handlerTargetBlockId: [...handlerTargets][0] ?? null,
        proof: handlerTargets.size
          ? 'disjoint successors terminate through normal or one handler route'
          : 'both disjoint successor subgraphs terminate without a control merge',
      })
      continue
    }
    const bestScore = Math.min(
      ...candidates.map((candidate) =>
        Math.max(left.get(candidate), right.get(candidate)),
      ),
    )
    const best = candidates.filter(
      (candidate) =>
        Math.max(left.get(candidate), right.get(candidate)) === bestScore,
    )
    if (best.length !== 1) continue
    const mergeBlock = blockById.get(best[0])
    if (!mergeBlock) continue
    regions.push({
      kind: 'conditional',
      testBlockId: block.id,
      condition: cloneData(conditional.condition),
      branchEdgeId: edgeIdsByKey.get(edgeKey(conditional)),
      branchTargetPc: conditional.targetPc,
      fallthroughEdgeId: edgeIdsByKey.get(edgeKey(fallthrough)),
      fallthroughTargetPc: fallthrough.targetPc,
      mergeBlockId: mergeBlock.id,
      proof:
        'both proven successors have one unique nearest reconvergence block',
    })
  }
  return regions
}

function structuredControl(
  fn,
  edges,
  blockById,
  irreducibleRegions,
  edgeIdsByKey,
) {
  const blocks = [...blockById.values()].sort(
    (left, right) => left.startPc - right.startPc,
  )
  const blockOrder = blocks.map(({ id }) => id)
  if (irreducibleRegions.length) {
    return {
      mode: 'state-machine',
      control: {
        kind: 'state-machine',
        stateVariable: '__jsconfuserVmState',
        entryBlockId: `${fn.id}:b@${fn.startPc}`,
        blockOrder,
        dispatch: blocks.map((block) => ({
          state: block.id,
          blockId: block.id,
          successorEdgeIds: edges
            .filter(({ sourcePc }) => sourcePc === block.instructionPcs.at(-1))
            .map((edge) => edgeIdsByKey.get(edgeKey(edge))),
        })),
        proof: {
          irreducible: cloneData(fn.irreducible),
          exactBlockGraph: true,
          explicitLeaves: true,
        },
      },
    }
  }
  const allFallthrough = edges.every(
    (edge) => edge.kind === 'fallthrough' || edge.kind === 'return',
  )
  const regions = []
  if (allFallthrough) {
    regions.push({
      kind: 'linear',
      blockIds: blockOrder,
      proof:
        'every reachable successor is the next serialized block or an explicit return',
    })
  } else {
    regions.push(...findConditionalRegions(fn, edges, blockById, edgeIdsByKey))
    regions.push(...findNaturalLoops(fn, edges, blockById, edgeIdsByKey))
    const coveredControlSources = new Set(
      regions.flatMap((region) => {
        if (region.kind === 'conditional') return [region.testBlockId]
        if (region.kind === 'natural-loop') return [region.headerBlockId]
        return []
      }),
    )
    const unsupported = blocks
      .filter((block) => !coveredControlSources.has(block.id))
      .map(({ id }) => id)
    if (unsupported.length) {
      regions.push({
        kind: 'opaque',
        blockIds: unsupported,
        reason: 'control shape not structurally proved by the accepted CFG',
      })
    }
  }
  return {
    mode: 'structured',
    control: {
      kind: 'structured',
      blockOrder,
      regions,
      proof:
        'structured nodes are emitted only from CFG edges, dominance, and unique reconvergence',
    },
  }
}

function buildResult(wordcodeData, cfgData, hData) {
  const globalEdges = cfgData.allEdges.map((edge, index) => ({
    id: `e${index}`,
    ...cloneData(edge),
  }))
  const edgeIdsByKey = new Map(
    cfgData.allEdges.map((edge, index) => [edgeKey(edge), `e${index}`]),
  )
  const functionResults = []
  let structuredCount = 0
  let stateMachineCount = 0
  const emittedPcs = []
  for (const fn of cfgData.functions) {
    const blockById = cfgData.functionBlocks.get(fn.id)
    const fnEdges = cfgData.edgesByFunction.get(fn.id)
    const control = structuredControl(
      fn,
      fnEdges,
      blockById,
      cfgData.irreducibleByFunction.get(fn.id),
      edgeIdsByKey,
    )
    if (control.mode === 'structured') structuredCount += 1
    else stateMachineCount += 1
    const states = hData.statesByFunction.get(fn.id)
    const blocks = [...blockById.values()]
      .sort((left, right) => left.startPc - right.startPc)
      .map((block) => {
        const leaves = block.instructionPcs.map((pc) => {
          const instruction = wordcodeData.byPc.get(pc)
          const state = states.get(pc)
          emittedPcs.push(pc)
          return {
            kind: 'opcode',
            ...cloneData(instruction),
            reachable: state.reachable,
            semanticBoundary: 'later-packet',
          }
        })
        return {
          id: block.id,
          functionId: fn.id,
          startPc: block.startPc,
          endPc: block.endPc,
          leaves,
          handlerStateIn: cloneData(block.handlerStateIn),
          successorEdgeIds: fnEdges
            .filter(({ sourcePc }) => sourcePc === block.instructionPcs.at(-1))
            .map((edge) => edgeIdsByKey.get(edgeKey(edge))),
        }
      })
    const instructionCount = blocks.reduce(
      (count, block) => count + block.leaves.length,
      0,
    )
    functionResults.push({
      id: fn.id,
      kind: fn.kind,
      startPc: fn.startPc,
      endPc: fn.endPc,
      parentFunctionId: fn.parentFunctionId,
      regCount: fn.regCount,
      paramCount: fn.paramCount,
      captureCount: fn.captureCount,
      hasRest: fn.hasRest,
      instructionCount,
      blockCount: blocks.length,
      mode: control.mode,
      control: control.control,
      blocks,
    })
  }
  const overallMode =
    stateMachineCount === 0
      ? 'structured'
      : structuredCount === 0
        ? 'state-machine'
        : 'mixed'
  return deepFreeze({
    schemaVersion: STRUCTURED_CONTROL_SCHEMA,
    encoding: 'numeric-u32',
    parseOnly: true,
    targetExecution: false,
    wordCount: wordcodeData.words.length,
    instructionCount: wordcodeData.instructions.length,
    functionCount: functionResults.length,
    mode: overallMode,
    modeCounts: {
      structured: structuredCount,
      stateMachine: stateMachineCount,
    },
    predecessorSchemas: {
      wordcode: WORDCODE_SCHEMA,
      cfg: CFG_SCHEMA,
      exceptionFinally: EXCEPTION_FINALLY_SCHEMA,
    },
    functions: functionResults,
    edges: globalEdges,
    coverage: {
      instructions: {
        expected: wordcodeData.instructions.length,
        emitted: emittedPcs.length,
        unique: new Set(emittedPcs).size === emittedPcs.length,
        complete: arrayEqual(
          [...emittedPcs].sort((left, right) => left - right),
          [...wordcodeData.boundaries].sort((left, right) => left - right),
        ),
      },
      edges: {
        expected: cfgData.allEdges.length,
        emitted: globalEdges.length,
        unique:
          new Set(globalEdges.map(({ id }) => id)).size === globalEdges.length,
        complete: globalEdges.length === cfgData.allEdges.length,
      },
    },
    omissions: {
      targetSemantics:
        'not-emitted; opcode leaves retain exact typed B records',
      callsPropertiesScalarsClosuresCompletion:
        'not-reclassified; owned by later packets',
      exceptionEmission:
        'not-emitted; exact Packet H states and routes are carried',
      sourceReplacement: 'not performed',
      visitorCliIntegration: 'not performed',
      targetExecution: 'not performed',
    },
  })
}

function recognize(wordcode, cfg, exceptionFinally) {
  const wordcodeData = indexWordcode(wordcode)
  const cfgData = indexCfg(cfg)
  const hData = indexExceptionFinally(exceptionFinally)
  return buildResult(wordcodeData, cfgData, hData)
}

export function diagnoseStructuredControl(wordcode, cfg, exceptionFinally) {
  try {
    return deepFreeze({
      ok: true,
      result: recognize(wordcode, cfg, exceptionFinally),
      diagnostic: null,
    })
  } catch (error) {
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof StructuredControlDecline
            ? error.code
            : 'structured-control-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function emitStructuredControl(wordcode, cfg, exceptionFinally) {
  return diagnoseStructuredControl(wordcode, cfg, exceptionFinally).result
}

export default emitStructuredControl
