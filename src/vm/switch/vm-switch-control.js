// Build a source-independent control plan from typed VM switch cases. A frontend
// may supply a stronger qualified plan; this constructor never reads source
// opcodes, word widths, or rendered switch text.

function successors(item) {
  const { operation: op, nextPc } = item
  if (op.kind === 'jump') return [{ kind: 'branch', targetPc: op.target }]
  if (op.kind === 'branch')
    return [
      { kind: 'conditional', targetPc: op.target },
      { kind: 'fallthrough', targetPc: nextPc },
    ]
  if (op.kind === 'for-in-next')
    return [
      { kind: 'branch', targetPc: op.exit },
      { kind: 'fallthrough', targetPc: nextPc },
    ]
  if (op.kind === 'return' || op.kind === 'throw')
    return [{ kind: op.kind, targetPc: null }]
  return [{ kind: 'fallthrough', targetPc: nextPc }]
}

function reachable(entry, adjacency) {
  const visited = new Set([entry])
  const queue = [entry]
  while (queue.length) {
    for (const target of adjacency.get(queue.shift()) ?? []) {
      if (visited.has(target)) continue
      visited.add(target)
      queue.push(target)
    }
  }
  return visited
}

function distances(start, adjacency) {
  const result = new Map([[start, 0]])
  const queue = [start]
  while (queue.length) {
    const source = queue.shift()
    for (const target of adjacency.get(source) ?? []) {
      if (result.has(target)) continue
      result.set(target, result.get(source) + 1)
      queue.push(target)
    }
  }
  return result
}

function dominators(nodes, entry, predecessors) {
  const dom = new Map(
    [...nodes].map((node) => [
      node,
      node === entry ? new Set([entry]) : new Set(nodes),
    ]),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node === entry) continue
      const incoming = (predecessors.get(node) ?? []).filter((pc) =>
        nodes.has(pc),
      )
      const intersection = incoming.length
        ? new Set(
            [...dom.get(incoming[0])].filter((candidate) =>
              incoming.every((pc) => dom.get(pc).has(candidate)),
            ),
          )
        : new Set()
      intersection.add(node)
      const previous = dom.get(node)
      if (
        previous.size !== intersection.size ||
        [...previous].some((value) => !intersection.has(value))
      ) {
        dom.set(node, intersection)
        changed = true
      }
    }
  }
  return dom
}

function naturalLoop(header, source, predecessors, live) {
  const members = new Set([header, source])
  const queue = [source]
  while (queue.length) {
    for (const pc of predecessors.get(queue.pop()) ?? []) {
      if (!live.has(pc) || members.has(pc)) continue
      members.add(pc)
      if (pc !== header) queue.push(pc)
    }
  }
  return members
}

function regions(fn, edges, blockId, adjacency, predecessors, live) {
  const result = []
  const bySource = new Map()
  for (const edge of edges) {
    const list = bySource.get(edge.sourcePc) ?? []
    list.push(edge)
    bySource.set(edge.sourcePc, list)
  }
  if (
    edges.every((edge) =>
      ['fallthrough', 'return', 'throw'].includes(edge.kind),
    )
  ) {
    result.push({
      kind: 'linear',
      blockIds: [...live].map(blockId),
      proof: 'typed cases have only normal fallthrough or terminal completion',
    })
    return result
  }
  for (const pc of live) {
    const outgoing = bySource.get(pc) ?? []
    const branch = outgoing.find(({ kind }) => kind === 'conditional')
    const fallthrough = outgoing.find(({ kind }) => kind === 'fallthrough')
    if (!branch || !fallthrough) continue
    const left = distances(branch.targetPc, adjacency)
    const right = distances(fallthrough.targetPc, adjacency)
    const common = [...left.keys()].filter((target) => right.has(target))
    if (!common.length) continue
    const score = Math.min(
      ...common.map((target) => Math.max(left.get(target), right.get(target))),
    )
    const nearest = common.filter(
      (target) => Math.max(left.get(target), right.get(target)) === score,
    )
    if (nearest.length !== 1) continue
    result.push({
      kind: 'conditional',
      testBlockId: blockId(pc),
      branchEdgeId: branch.id,
      branchTargetPc: branch.targetPc,
      fallthroughEdgeId: fallthrough.id,
      fallthroughTargetPc: fallthrough.targetPc,
      mergeBlockId: blockId(nearest[0]),
      proof: 'both typed successors have one nearest reconvergence',
    })
  }
  const dom = dominators(live, fn.startPc, predecessors)
  const loopKeys = new Set()
  for (const edge of edges) {
    const { sourcePc, targetPc } = edge
    if (
      targetPc === null ||
      sourcePc === targetPc ||
      !live.has(sourcePc) ||
      !live.has(targetPc) ||
      !dom.get(sourcePc).has(targetPc)
    )
      continue
    const members = naturalLoop(targetPc, sourcePc, predecessors, live)
    const exits = edges.filter(
      (candidate) =>
        members.has(candidate.sourcePc) &&
        (candidate.targetPc === null || !members.has(candidate.targetPc)),
    )
    if (!exits.length) continue
    const key = `${targetPc}:${[...members].sort((a, b) => a - b).join(',')}`
    if (loopKeys.has(key)) continue
    loopKeys.add(key)
    result.push({
      kind: 'natural-loop',
      headerBlockId: blockId(targetPc),
      backEdgeIds: [edge.id],
      bodyBlockIds: [...members].sort((a, b) => a - b).map(blockId),
      exitEdgeIds: exits.map(({ id }) => id),
      proof: 'loop header dominates its back edge and has explicit exits',
    })
  }
  return result
}

export function buildVmSwitchControl(model) {
  const controlByFunction = new Map()
  const edges = []
  for (const fn of model.functions.functions) {
    const cases = model.instructionsByFunction.get(fn.id)
    const blockId = (pc) => `${fn.id}:b@${pc}`
    const needsDispatch = cases.some(({ operation: { kind } }) =>
      ['indirect-jump', 'catch-setup', 'finally-setup', 'handler-pop'].includes(
        kind,
      ),
    )
    if (needsDispatch) {
      controlByFunction.set(fn.id, { mode: 'state-machine' })
      continue
    }
    const functionEdges = cases.flatMap((item) =>
      successors(item).map((edge, index) => ({
        id: `switch:${fn.id}:${item.pc}:${index}`,
        functionId: fn.id,
        sourcePc: item.pc,
        ...edge,
      })),
    )
    edges.push(...functionEdges)
    const adjacency = new Map(cases.map(({ pc }) => [pc, []]))
    const predecessors = new Map(cases.map(({ pc }) => [pc, []]))
    for (const edge of functionEdges) {
      if (edge.targetPc === null) continue
      adjacency.get(edge.sourcePc).push(edge.targetPc)
      predecessors.get(edge.targetPc).push(edge.sourcePc)
    }
    const live = reachable(fn.startPc, adjacency)
    const blocks = [...cases]
      .sort((left, right) =>
        left.pc === fn.startPc
          ? -1
          : right.pc === fn.startPc
            ? 1
            : left.pc - right.pc,
      )
      .map((item) => ({
        id: blockId(item.pc),
        functionId: fn.id,
        startPc: item.pc,
        endPc: item.nextPc,
        leaves: [{ ...item, reachable: live.has(item.pc) }],
        successorEdgeIds: functionEdges
          .filter(({ sourcePc }) => sourcePc === item.pc)
          .map(({ id }) => id),
      }))
    controlByFunction.set(fn.id, {
      mode: 'structured',
      blocks,
      control: {
        kind: 'structured',
        regions: regions(
          fn,
          functionEdges,
          blockId,
          adjacency,
          predecessors,
          live,
        ),
      },
    })
  }
  return { controlByFunction, structuredControl: { edges } }
}
