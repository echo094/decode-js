export function indexExceptionFinally(exceptionFinally) {
  return {
    exceptionFinally,
    recordsByFunction: new Map(
      exceptionFinally.functions.map((fn) => [
        fn.id,
        [...fn.handlerRecords, ...fn.finallyRecords],
      ]),
    ),
    statesByFunction: new Map(
      exceptionFinally.functions.map((fn) => [
        fn.id,
        new Map(fn.instructionStates.map((state) => [state.pc, state])),
      ]),
    ),
    hEdgesByFunction: new Map(
      exceptionFinally.functions.map((fn) => [fn.id, fn.edgeStates]),
    ),
    transitionsByFunction: new Map(
      exceptionFinally.functions.map((fn) => [
        fn.id,
        new Map(
          fn.transitions.map((transition) => [transition.pc, transition]),
        ),
      ]),
    ),
    mergesByFunction: new Map(
      exceptionFinally.functions.map((fn) => [fn.id, fn.merges]),
    ),
    jumpsByFunction: new Map(
      exceptionFinally.functions.map((fn) => [fn.id, fn.jumpRegChecks]),
    ),
  }
}
