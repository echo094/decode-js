export function indexCfg(cfg) {
  return {
    cfg,
    functions: cfg.functions,
    ownerByPc: new Map(
      cfg.ownership.map(({ pc, functionId }) => [pc, functionId]),
    ),
    edgesByFunction: new Map(cfg.functions.map((fn) => [fn.id, fn.edges])),
    allEdges: cfg.edges,
    functionBlocks: new Map(
      cfg.functions.map((fn) => [
        fn.id,
        new Map(fn.blocks.map((block) => [block.id, block])),
      ]),
    ),
    indirectByFunction: new Map(
      cfg.functions.map((fn) => [
        fn.id,
        new Map(fn.indirectTargets.map((entry) => [entry.pc, entry])),
      ]),
    ),
    irreducibleByFunction: new Map(
      cfg.functions.map((fn) => [fn.id, fn.irreducible.regions]),
    ),
  }
}
