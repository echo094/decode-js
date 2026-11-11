// The compiler gives each try/finally a dedicated continuation register (a `local::` register,
// never shared) that only label loads write and only the finalizer's JUMP_REG reads. So inside
// one function, every LOAD_INT whose destination is a FINALLY_SETUP continuation register loads
// an address. Items are { pc, key, functionId, name, words }; the result is the set of selected keys.
// A PATCH suspect (an undecided selfModifying filler, by `pc` in the caller's space) is read past:
// a filler LOAD_INT draws any register, so a suspect neither names a continuation register nor loads
// one, and keeps its words until its owner settles it.
export function selectContinuationLoads(items, suspects = new Set()) {
  const read = items.filter((item) => !suspects.has(item.pc))
  const continuations = new Map()
  for (const item of read) {
    if (item.name !== 'FINALLY_SETUP') continue
    if (!continuations.has(item.functionId))
      continuations.set(item.functionId, new Set())
    continuations.get(item.functionId).add(item.words[2])
  }
  return new Set(
    read
      .filter(
        (item) =>
          item.name === 'LOAD_INT' &&
          continuations.get(item.functionId)?.has(item.words[1]),
      )
      .map(({ key }) => key),
  )
}
