import { LoopEnds } from './loop-ends.js'
import { TryEnds } from './try-ends.js'

// Loop heads (targets of a back edge) and try heads (setups), outermost first; a loop whose
// header is a try's setup encloses that try.
function collectEntries(view) {
  const entries = []
  for (const [source, successors] of view.graph.adjacency)
    for (const { target } of successors)
      if (
        view.reachable.has(source) &&
        view.dominates(target, source) &&
        !entries.some((item) => item.head === target)
      )
        entries.push({ kind: 'loop', head: target })
  for (const id of view.reachable) {
    const kind = view.lastLeaf(id).operation.kind
    if (kind === 'catch-setup' || kind === 'finally-setup')
      entries.push({ kind: 'try', head: id })
  }
  return entries.sort(
    (left, right) =>
      view.dom.get(left.head).size - view.dom.get(right.head).size,
  )
}

/**
 * Finds the loop and try regions of one function (`view`), outermost first. Each region's members
 * are the blocks its head dominates up to its end (`continuation`), less the blocks past its cuts;
 * a region whose members are not closed has no end. `regions` grows as entries are read, so an
 * inner region reads the enclosing ones. `switchEnds(head)` gives the ends of the switch rows
 * holding a statement's head: a break target, like an enclosing loop's end, once a first pass has
 * found those rows.
 */
class StatementRegionFinder {
  constructor(view, switchEnds) {
    this.view = view
    this.regions = []
    this.entries = collectEntries(view)
    this.loopEnds = new LoopEnds(view, this.regions)
    this.tryEnds = new TryEnds(
      view,
      this.regions,
      this.entries,
      this.loopEnds,
      switchEnds,
    )
  }

  find() {
    for (const item of this.entries) this.regions.push(this.regionOf(item))
    return this.regions
  }

  regionOf(item) {
    const { head, kind } = item
    const bounds =
      kind === 'loop' ? this.loopEnds.bounds(head) : this.tryEnds.bounds(head)
    const { continuation, layoutEnd = null, blockEnds, cuts } = bounds
    if (continuation)
      this.markContinues(head, continuation, cuts, bounds.loopsOutside ?? [])
    const region = {
      ...item,
      continuation,
      blockEnds,
      members: this.view.membersOf(head, continuation ?? layoutEnd, cuts),
    }
    if (kind === 'try') return { ...region, layoutEnd }
    const { trailing, trailingIsTest, exitTest } = bounds
    return { ...region, trailing, trailingIsTest, exitTest, continues: [] }
  }

  // An enclosing loop's trailing run a member of the try jumps to is a continue from the try.
  markContinues(head, continuation, cuts, loopsOutside) {
    for (const loop of loopsOutside) {
      const target = loop.trailing[0]
      if (
        target !== continuation &&
        [...this.view.membersOf(head, continuation, cuts)].some((id) =>
          this.view.normalNext(id).includes(target),
        )
      )
        loop.continues.push(head)
    }
  }
}

export function findStatementRegions(view, switchEnds = () => []) {
  return new StatementRegionFinder(view, switchEnds).find()
}
