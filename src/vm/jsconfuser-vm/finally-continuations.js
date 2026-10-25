// The compiler gives each try/finally a dedicated continuation register (a `local::` register,
// never shared) that only label loads write and only the finalizer's JUMP_REG reads. So inside
// one function, every LOAD_INT whose destination is a FINALLY_SETUP continuation register loads
// an address. Items are { key, functionId, name, words }; the result is the set of selected keys.
export function selectContinuationLoads(items) {
  const continuations = new Map()
  for (const item of items) {
    if (item.name !== 'FINALLY_SETUP') continue
    if (!continuations.has(item.functionId))
      continuations.set(item.functionId, new Set())
    continuations.get(item.functionId).add(item.words[2])
  }
  return new Set(
    items
      .filter(
        (item) =>
          item.name === 'LOAD_INT' &&
          continuations.get(item.functionId)?.has(item.words[1]),
      )
      .map(({ key }) => key),
  )
}
