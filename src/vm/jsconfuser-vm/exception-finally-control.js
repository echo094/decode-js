export function indexRecords(cfg) {
  const recordsByFunction = new Map(
    cfg.functions.map((fn) => [
      fn.id,
      new Map(
        [...fn.handlerRecords, ...fn.finallyRecords].map((record) => [
          record.id,
          record,
        ]),
      ),
    ]),
  )
  return {
    recordsByFunction,
    allRecords: new Map(
      [...recordsByFunction.values()].flatMap((records) => [...records]),
    ),
  }
}

export function indexCfg(cfg) {
  return {
    cfgFunctions: cfg.functions,
    edgesByFunction: new Map(cfg.functions.map((fn) => [fn.id, fn.edges])),
    indirectByFunction: new Map(
      cfg.functions.map((fn) => [fn.id, fn.indirectTargets]),
    ),
    callSites: cfg.callSites,
  }
}

export function indexCallFrames(callFrames) {
  return {
    fnRecords: callFrames.functions,
    calls: callFrames.callSites,
    returns: callFrames.returns,
    throws: callFrames.throws,
    completionRoutes: callFrames.completionRoutes,
  }
}
