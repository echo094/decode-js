import { isJumpStep } from '../model/model.js'
import {
  destinationRegister,
  reachingDefinitionUses,
} from '../model/operations.js'

/**
 * Copy simplification: a move whose source's one use it is, entered only from its producer with
 * nothing run between, coalesces into the producer, which writes the move's destination. `simplify`
 * returns the plan (retained producer PC -> the register it writes), the proof rows and the
 * coalesced move PCs.
 *
 * A unit's site (`unitBySite`) produces its object: the literal is written there, so a move of
 * the object right after it, its one read besides the unit's own, coalesces into the literal.
 * A closure reads a locally captured register (`localCaptureRegisters`) through its cell at any
 * call, which no reaching definition records, so a captured source is not a temporary. A captured
 * destination may be retargeted: it is still written once, at the producer, with nothing run
 * between the two, and `x = e` writes x after e as the move did.
 */
export class CopySimplifier {
  constructor(
    instructions,
    solved,
    { removed, literals, unitBySite, localCaptureRegisters },
  ) {
    Object.assign(this, {
      removed,
      literals,
      unitBySite,
      localCaptureRegisters,
    })
    this.reachablePcs = new Set(solved.reachablePcs)
    this.uses = reachingDefinitionUses(
      instructions,
      solved.reachingDefinitions,
      removed,
      literals,
    )
    // A node is one case; its successors are the control solver's edges from its PC.
    this.nodes = [...instructions]
      .sort((left, right) => left.pc - right.pc)
      .map((instruction) => ({ startPc: instruction.pc, instruction }))
    this.nodeByPc = new Map(this.nodes.map((node) => [node.startPc, node]))
    this.outgoing = Map.groupBy(solved.edges, (edge) => edge.sourcePc)
    this.incoming = new Map()
    for (const edge of solved.edges)
      if (edge.targetPc !== null)
        this.incoming.set(
          edge.targetPc,
          (this.incoming.get(edge.targetPc) ?? 0) + 1,
        )
    this.plan = new Map()
    this.links = []
    this.coalescedMovePcs = new Set()
    // A coalesced move's value is written by the producer it was folded into; following these
    // links from any removed move reaches the retained producer of its chain.
    this.foldedInto = new Map()
  }

  simplify(functionId) {
    for (const node of this.nodes) {
      for (const edge of this.outgoing.get(node.startPc) ?? []) {
        // A call reaches the case after it by its continuation, as an operation by its
        // fallthrough; when it throws, neither the call's write nor the move happens.
        if (edge.kind !== 'fallthrough' && edge.kind !== 'call') continue
        const target = this.nextStatement(edge.targetPc)
        if (target) this.consider(node.instruction, target.instruction)
      }
    }
    return {
      plan: this.plan,
      proofs: this.proofs(functionId),
      coalescedMovePcs: this.coalescedMovePcs,
    }
  }

  nodeAt(pc) {
    return pc === null ? null : (this.nodeByPc.get(pc) ?? null)
  }

  // Jump steps and dropped dead definitions entered only from here run nothing between the
  // two: a dropped definition cannot throw and nothing reads what it wrote.
  passable(node) {
    return isJumpStep(node) || this.removed.has(node.startPc)
  }

  // The first case from `pc` that runs something, when every case on the way, and it, is entered
  // only from the one before.
  nextStatement(pc) {
    let target = this.nodeAt(pc)
    const seen = new Set()
    while (
      target &&
      this.passable(target) &&
      this.incoming.get(target.startPc) === 1 &&
      !seen.has(target.startPc)
    ) {
      seen.add(target.startPc)
      const [next] = this.outgoing.get(target.startPc) ?? []
      target = this.nodeAt(next?.targetPc ?? null)
    }
    return target &&
      !this.passable(target) &&
      this.incoming.get(target.startPc) === 1
      ? target
      : null
  }

  retainedProducer(pc) {
    while (this.foldedInto.has(pc)) pc = this.foldedInto.get(pc)
    return pc
  }

  // A for-in step writes its key only on its fallthrough route, the one edge the walk takes to a
  // move, and on its exit writes neither the key nor the move's destination, so a move of the key
  // retargets the step as a move of any producer.
  producerRegister(producer) {
    const unit = this.unitBySite.get(producer.pc)
    if (unit) return unit.register
    return producer.operation.kind === 'for-in-next'
      ? producer.operation.destination
      : destinationRegister(producer)
  }

  consider(producer, move) {
    const unit = this.unitBySite.get(producer.pc)
    const producerDestination = this.producerRegister(producer)
    if (
      !this.reachablePcs.has(producer.pc) ||
      !this.reachablePcs.has(move.pc) ||
      this.removed.has(producer.pc) ||
      this.removed.has(move.pc) ||
      move.operation.kind !== 'assign' ||
      move.operation.value.kind !== 'register' ||
      this.literals.read(move, move.operation.value.index) ||
      producerDestination === null
    )
      return
    const moveDestination = destinationRegister(move)
    const moveSource = move.operation.value.index
    if (
      producerDestination !== moveSource ||
      producerDestination === moveDestination ||
      this.localCaptureRegisters.has(producerDestination)
    )
      return
    const definitionPc = unit ? unit.objectPc : producer.pc
    const sites = (this.uses.get(`${definitionPc}`) || []).filter(
      ({ pc }) => !unit?.chain.includes(pc),
    )
    if (sites.length !== 1 || sites[0].pc !== move.pc) return
    if (this.plan.has(producer.pc) || this.coalescedMovePcs.has(move.pc)) return
    // Earlier coalesces may already have changed both instructions: a removed producer writes
    // through its chain's retained producer, and a move already planned as a producer hands its
    // retarget on, so the retained producer writes the register at the end of the chain.
    const retained = this.retainedProducer(producer.pc)
    this.plan.set(retained, this.plan.get(move.pc) ?? moveDestination)
    this.plan.delete(move.pc)
    this.foldedInto.set(move.pc, retained)
    this.coalescedMovePcs.add(move.pc)
    this.links.push({ definitionPc, movePc: move.pc, moveSource })
  }

  // Each row reports a removed move against the final plan: the producer that is retained and
  // the register it now writes; the reaching definition is the move's own producer.
  proofs(functionId) {
    return this.links.map(({ definitionPc, movePc, moveSource }) => {
      const retained = this.retainedProducer(movePc)
      return {
        functionId,
        producerPc: retained,
        movePc,
        sourceRegister: moveSource,
        destinationRegister: this.plan.get(retained),
        reachingDefinitions: [`${definitionPc}`],
        useSites: [{ pc: movePc, register: moveSource }],
        disposition: 'safely-eliminated',
        reason: 'single-reaching-definition-use',
        producerRetained: true,
        evaluationOrderPreserved: true,
        receiverSemanticsPreserved: true,
      }
    })
  }
}
