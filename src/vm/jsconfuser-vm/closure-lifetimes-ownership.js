export function indexFunctions(functionsResult) {
  const functions = functionsResult.functions
  return {
    functions,
    byId: new Map(functions.map((fn) => [fn.id, fn])),
    ownerByPc: new Map(
      functionsResult.ownership.map(({ pc, functionId }) => [pc, functionId]),
    ),
    closureSitesByPc: new Map(
      functions
        .flatMap((fn) => fn.closureSites)
        .map((site) => [site.creationPc, site]),
    ),
  }
}

export function indexCfg(cfg) {
  const edgesByFunction = new Map(cfg.functions.map((fn) => [fn.id, fn.edges]))
  const reachableByFunction = new Map()
  for (const fn of cfg.functions) {
    const reached = new Set([fn.startPc])
    const queue = [fn.startPc]
    while (queue.length) {
      const pc = queue.shift()
      for (const edge of fn.edges) {
        if (
          edge.sourcePc === pc &&
          edge.targetPc !== null &&
          !reached.has(edge.targetPc)
        ) {
          reached.add(edge.targetPc)
          queue.push(edge.targetPc)
        }
      }
    }
    reachableByFunction.set(fn.id, reached)
  }
  return {
    edges: cfg.edges,
    edgesByFunction,
    reachableByFunction,
    callSites: cfg.callSites,
  }
}

export function indexCallFrames(callFrames) {
  return {
    frames: callFrames.frames,
    functions: callFrames.functions,
    callSites: callFrames.callSites,
    callSiteByPc: new Map(callFrames.callSites.map((site) => [site.pc, site])),
  }
}
