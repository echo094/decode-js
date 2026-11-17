import {
  destinationRegister,
  expressionProducer,
  foldSlots,
  operationMayThrow,
  operationReads,
  reachingDefinitionUses,
  sameStack,
  valueSlots,
} from '../model/operations.js'
import { unitSlots } from './object-literals.js'
import { CONTINUING_EDGES } from '../model/control.js'

// Single-use folding: a producer whose definition has one use, the only definition reaching it,
// moves into that use as an operand expression when nothing between could tell. Decided per use,
// nearest candidate first; returns producer PC -> { usePc, register } and use PC -> (register ->
// producer PC), with `treeOf` and `mayPass` for the object literal check. A unit's case
// (`unitCases`) takes folds in its literal slots. A unit's site (`unitBySite`) is one producer of
// the unit's object, its definition the object's PC, its tree the whole literal. A conditional
// value (`values`, keyed by its test PC) is one producer of its register: the run into its merge
// goes on from its test, and its tree is every case it holds.
/**
 * Decides, for each use, which producers fold into it: a producer whose one use is here, in a
 * straight run into it, under the same handlers, and that can move past the cases between them.
 * `foldedInto` maps a folded producer to its use and register, `foldsAt` a use to its folds.
 */
class SingleUseFolder {
  constructor({
    instructions,
    solved,
    removed,
    copyPlan,
    literals,
    localCaptureRegisters,
    handlerRegisters,
    barredUses,
    methodCalls = new Map(),
    unitCases = new Set(),
    unitBySite = new Map(),
    values = new Map(),
  }) {
    Object.assign(this, {
      instructions,
      solved,
      removed,
      copyPlan,
      literals,
      localCaptureRegisters,
      handlerRegisters,
      barredUses,
      unitCases,
      unitBySite,
      values,
    })
    this.byPc = new Map(instructions.map((item) => [item.pc, item]))
    this.valueByMerge = new Map(
      [...values.values()].map((value) => [value.mergePc, value]),
    )
    this.valueUses = new Set([...values.values()].map(({ usePc }) => usePc))
    this.reachablePcs = new Set(solved.reachablePcs)
    // A method call's read of its receiver is its callee read's object, the same definition, read
    // once in `o[k](args)`: it is no use of its own (`methodCalls`).
    this.uses = new Map(
      [
        ...reachingDefinitionUses(
          instructions,
          solved.reachingDefinitions,
          removed,
          literals,
        ),
      ].map(([definition, sites]) => [
        definition,
        sites.filter(
          ({ pc, register }) => methodCalls.get(pc)?.receiver !== register,
        ),
      ]),
    )
    this.outgoing = Map.groupBy(solved.edges, (edge) => edge.sourcePc)
    this.incoming = Map.groupBy(
      solved.edges.filter(({ targetPc }) => targetPc !== null),
      (edge) => edge.targetPc,
    )
    this.handlerReadsByStack = new Map()
    this.foldedInto = new Map()
    this.foldsAt = new Map()
    this.decided = new Set()
    this.trees = new Map()
  }

  slotsAt(pc) {
    const { operation } = this.byPc.get(pc)
    if (this.unitCases.has(pc)) return unitSlots(operation)
    return this.valueUses.has(pc) ? valueSlots(operation) : foldSlots(operation)
  }

  // A case's one normal successor: a jump step's jump, an operation's fallthrough or call
  // continuation; a branch, a transfer or a jump into a finalizer has none.
  next(pc) {
    const edges = this.outgoing.get(pc) ?? []
    if (this.byPc.get(pc).operation.kind === 'jump')
      return edges.length === 1 && edges[0].kind === 'branch'
        ? edges[0].targetPc
        : null
    if (
      edges.some(({ kind }) =>
        ['branch', 'conditional', 'return'].includes(kind),
      )
    )
      return null
    const continuing = edges.filter(({ kind }) => CONTINUING_EDGES.has(kind))
    return continuing.length === 1 ? continuing[0].targetPc : null
  }

  // The straight run into `pc`, nearest first: each case the only way into the one after it.
  chainInto(pc) {
    const chain = []
    let current = pc
    for (;;) {
      const edges = this.incoming.get(current) ?? []
      const value = this.valueByMerge.get(current)
      if (
        value &&
        edges.every(({ sourcePc }) => value.pcs.has(sourcePc)) &&
        !chain.includes(value.testPc)
      ) {
        chain.push(value.testPc)
        // A logical value's left producer runs before its test: the run goes on before it.
        current = value.entryPc
        continue
      }
      if (edges.length !== 1) break
      const source = edges[0].sourcePc
      if (
        this.next(source) !== current ||
        chain.includes(source) ||
        source === pc
      )
        break
      chain.push(source)
      current = source
    }
    return chain
  }

  destination(pc) {
    return (
      this.values.get(pc)?.register ??
      this.copyPlan.get(pc) ??
      this.unitBySite.get(pc)?.register ??
      destinationRegister(this.byPc.get(pc))
    )
  }

  passable(pc) {
    return this.removed.has(pc) || this.byPc.get(pc).operation.kind === 'jump'
  }

  // The cases a conditional value runs as statements: those no other of its cases holds.
  valueStatements(value) {
    return [...value.pcs].filter(
      (pc) =>
        !this.passable(pc) &&
        (pc === value.testPc || this.foldedInto.get(pc)?.usePc === undefined),
    )
  }

  // Registers a handler on `stack` may read: every read of every case reachable from its entry.
  handlerReads(stack) {
    const key = stack.map(({ setupPc }) => setupPc).join(',')
    if (this.handlerReadsByStack.has(key))
      return this.handlerReadsByStack.get(key)
    const registers = new Set()
    const seen = new Set()
    const queue = stack.map(({ target }) => target)
    while (queue.length) {
      const pc = queue.shift()
      if (seen.has(pc) || !this.byPc.has(pc)) continue
      seen.add(pc)
      for (const register of operationReads(this.byPc.get(pc).operation))
        registers.add(register)
      for (const { targetPc } of this.outgoing.get(pc) ?? [])
        if (targetPc !== null) queue.push(targetPc)
    }
    this.handlerReadsByStack.set(key, registers)
    return registers
  }

  // What a decided case evaluates with its folds in it: its PCs in evaluation order, the
  // registers it reads, whether it may throw (and so run code that reads or writes state), and
  // whether it reads state that such code can change (a capture cell or a captured register).
  treeOf(pc) {
    if (!this.trees.has(pc))
      this.trees.set(
        pc,
        this.values.has(pc)
          ? this.valueTree(this.values.get(pc))
          : this.unitBySite.has(pc)
            ? this.unitTree(this.unitBySite.get(pc))
            : this.buildTree(pc),
      )
    return this.trees.get(pc)
  }

  // A literal's tree: its parts in the order they ran, each with its folds; the parts' reads of
  // the object they build are the literal's own.
  unitTree(unit) {
    const tree = { pcs: [], reads: new Set(), throws: false, readsState: false }
    for (const pc of unit.chain) {
      const part = this.buildTree(pc)
      tree.pcs.push(...part.pcs)
      for (const read of part.reads)
        if (read !== unit.register) tree.reads.add(read)
      tree.throws = tree.throws || part.throws
      tree.readsState = tree.readsState || part.readsState
    }
    return tree
  }

  // A conditional value's tree: its test stands for it in a run; it reads, writes, may throw and
  // reads state as its cases do.
  valueTree(value) {
    const tree = {
      pcs: [value.testPc],
      reads: new Set(),
      writes: new Set(),
      throws: false,
      readsState: false,
      writesState: false,
    }
    for (const pc of this.valueStatements(value)) {
      const child = pc === value.testPc ? this.buildTree(pc) : this.treeOf(pc)
      for (const read of child.reads) tree.reads.add(read)
      tree.throws = tree.throws || child.throws
      tree.readsState = tree.readsState || child.readsState
      const written = pc === value.testPc ? null : this.destination(pc)
      if (written !== null) tree.writes.add(written)
      if (this.byPc.get(pc).operation.kind === 'upvalue-write')
        tree.writesState = true
    }
    return tree
  }

  buildTree(pc) {
    const instruction = this.byPc.get(pc)
    const folds = this.foldsAt.get(pc) ?? new Map()
    const tree = {
      pcs: [],
      reads: new Set(),
      throws: operationMayThrow(instruction.operation),
      readsState: instruction.operation.kind === 'upvalue-read',
    }
    for (const { register } of this.slotsAt(pc) ?? []) {
      if (!folds.has(register)) continue
      const child = this.treeOf(folds.get(register))
      tree.pcs.push(...child.pcs)
      for (const read of child.reads) tree.reads.add(read)
      tree.throws = tree.throws || child.throws
      tree.readsState = tree.readsState || child.readsState
    }
    for (const register of operationReads(instruction.operation)) {
      if (folds.has(register) || this.literals.read(instruction, register))
        continue
      tree.reads.add(register)
      if (this.localCaptureRegisters.has(register)) tree.readsState = true
    }
    tree.pcs.push(pc)
    return tree
  }

  // Whether `moving`'s tree may be evaluated after `between`, a case it was before.
  mayPass(moving, between, stack) {
    const other = this.treeOf(between)
    const isValue = this.values.has(between)
    const writes = isValue
      ? [...other.writes]
      : [this.destination(between)].filter((register) => register !== null)
    const writesState = isValue
      ? other.writesState
      : this.byPc.get(between).operation.kind === 'upvalue-write'
    if (writes.some((register) => moving.reads.has(register))) return false
    if ((moving.throws || moving.readsState) && (other.throws || writesState))
      return false
    if (!moving.throws) return true
    if (other.readsState) return false
    return !writes.some(
      (register) =>
        this.localCaptureRegisters.has(register) ||
        (stack.length && this.handlerReads(stack).has(register)),
    )
  }

  // Whether the producer at `chain[index]` can be one of `usePc`'s folds, its register's one use
  // being here.
  foldable(usePc, slots, chain, index, folds) {
    const producerPc = chain[index]
    const register = this.destination(producerPc)
    const value = this.values.get(producerPc)
    const slot = slots.find((item) => item.register === register)
    if (value)
      // Its planning settled its register's one use, here.
      return (
        value.usePc === usePc &&
        !this.foldedInto.has(producerPc) &&
        !folds.has(register) &&
        Boolean(slot?.foldable)
      )
    return (
      this.mayFold(producerPc, register, slot, folds) &&
      this.oneUseAt(usePc, producerPc, register)
    )
  }

  // Whether the producer at `producerPc` is a temporary its use's `slot` can take.
  mayFold(producerPc, register, slot, folds) {
    const producer = this.byPc.get(producerPc)
    if (
      this.passable(producerPc) ||
      this.foldedInto.has(producerPc) ||
      // A producer copy simplification retargeted writes the move's destination, the
      // compiler's variable, which the source wrote as a statement: only temporaries fold.
      this.copyPlan.has(producerPc) ||
      !(
        this.unitBySite.has(producerPc) ||
        expressionProducer(producer.operation)
      ) ||
      register === null ||
      this.localCaptureRegisters.has(register) ||
      this.handlerRegisters.has(register) ||
      folds.has(register)
    )
      return false
    return (
      Boolean(slot?.foldable) &&
      // `o[k]()` would pass `o` as `this`; an upvalue read is an identifier, called alike.
      !(slot.member && producer.operation.kind === 'property-read')
    )
  }

  // Whether the producer's definition has its one use at `usePc` and is the only one reaching it.
  oneUseAt(usePc, producerPc, register) {
    const unit = this.unitBySite.get(producerPc)
    // A literal's object is defined at its object case and read by its own parts.
    const definition = String(unit ? unit.objectPc : producerPc)
    const sites = (this.uses.get(definition) ?? []).filter(
      ({ pc }) => !unit?.chain.includes(pc),
    )
    const reaching = this.solved.reachingDefinitions.get(usePc)?.[register]
    return (
      sites.length === 1 &&
      sites[0].pc === usePc &&
      reaching?.size === 1 &&
      reaching.has(definition)
    )
  }

  // Whether folding the producer at `chain[index]` keeps evaluation order: every case from it to
  // the use runs under the same handlers, folded operands evaluate in slot order as their cases
  // ran, and it can move past the cases between that stay statements.
  keepsOrder(slots, chain, index, folds, stack) {
    const producerPc = chain[index]
    const register = this.destination(producerPc)
    if (
      !chain
        .slice(0, index + 1)
        .every((pc) => sameStack(this.solved.stateIn.get(pc), stack))
    )
      return false
    const tree = this.treeOf(producerPc)
    const trial = new Map([...folds, [register, producerPc]])
    const order = slots
      .filter((item) => trial.has(item.register))
      .flatMap((item) =>
        item.register === register
          ? tree.pcs
          : this.treeOf(trial.get(item.register)).pcs,
      )
      .map((pc) => chain.indexOf(pc))
    if (order.some((at, position) => position && at >= order[position - 1]))
      return false
    const inTrees = new Set(
      [...trial.values()].flatMap((pc) => this.treeOf(pc).pcs),
    )
    return chain
      .slice(0, index)
      .filter(
        (pc) =>
          !this.passable(pc) && !inTrees.has(pc) && !this.foldedInto.has(pc),
      )
      .every((pc) => this.mayPass(tree, pc, stack))
  }

  decide(usePc) {
    if (this.decided.has(usePc)) return
    this.decided.add(usePc)
    const chain = this.chainInto(usePc)
    // Farthest first, so each case's own folds are settled before it is read here; a conditional
    // value's cases before it.
    for (const pc of chain.toReversed()) {
      for (const inner of this.values.get(pc)?.pcs ?? []) this.decide(inner)
      for (const part of this.unitBySite.get(pc)?.chain ?? []) this.decide(part)
      this.decide(pc)
    }
    const slots = this.slotsAt(usePc)
    if (
      !slots ||
      !this.reachablePcs.has(usePc) ||
      this.removed.has(usePc) ||
      this.barredUses.has(usePc)
    )
      return
    const stack = this.solved.stateIn.get(usePc) ?? []
    const folds = new Map()
    chain.forEach((producerPc, index) => {
      if (
        this.foldable(usePc, slots, chain, index, folds) &&
        this.keepsOrder(slots, chain, index, folds, stack)
      )
        folds.set(this.destination(producerPc), producerPc)
    })
    if (!folds.size) return
    this.foldsAt.set(usePc, folds)
    for (const [register, producerPc] of folds)
      this.foldedInto.set(producerPc, { usePc, register })
  }
}

export function singleUseFolds(options) {
  const folder = new SingleUseFolder(options)
  for (const { pc } of options.instructions) folder.decide(pc)
  return {
    foldedInto: folder.foldedInto,
    foldsAt: folder.foldsAt,
    treeOf: (pc) => folder.treeOf(pc),
    mayPass: (moving, between, stack) => folder.mayPass(moving, between, stack),
  }
}
