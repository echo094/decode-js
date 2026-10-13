import {
  decline,
  functionRegisterSet,
  localCaptureRegisterSet,
} from './vm-switch-copy-planning.js'

const ORDINARY = new Set([
  'assign',
  'global-read',
  'global-write',
  'safe-typeof',
  'upvalue-read',
  'upvalue-write',
  'property-read',
  'property-write',
  'property-delete',
  'call',
  'closure',
  'array',
  'object',
  'accessor',
  'for-in-setup',
  'debugger',
])

function same(actual, expected) {
  if (actual === expected) return true
  if (
    !actual ||
    !expected ||
    typeof actual !== 'object' ||
    typeof expected !== 'object'
  )
    return false
  const keys = Object.keys(expected)
  return (
    Object.keys(actual).length === keys.length &&
    keys.every(
      (key) => Object.hasOwn(actual, key) && same(actual[key], expected[key]),
    )
  )
}

// Prove the complete region before the renderer marks or emits any of its blocks.
// Normal graphs are acyclic; exceptional routes leave their lexical phase.
export function proveCatchFinallyRegion(emitter, block) {
  const setup = block.leaves.at(-1)
  const { target, continuation, payload, throwPad } = setup.operation
  const fail = (reason) =>
    decline(
      'unemittable-structured-control',
      `FINALLY_SETUP at ${setup.pc} has no proved catch/finally region: ${reason}`,
    )
  const empty = { stack: [], finallyStack: [] }
  const finalRecord = {
    type: 'finally',
    setupPc: setup.pc,
    finallyPc: target,
    continuationReg: continuation,
    payloadReg: payload,
    throwPadPc: throwPad,
  }
  const outer = { stack: [finalRecord], finallyStack: [finalRecord] }
  const owned = new Map()
  const pads = new Map()
  const usedEdges = new Set()
  let exceptionalFinally = false
  let inner
  let catchOperation
  let catchSetup
  const at = (pc) => {
    const item = emitter.blocks.find((item) => item.startPc === pc)
    if (!item) fail(`missing block entry ${pc}`)
    return item
  }
  const own = (item, state, phase, live = true) => {
    if (owned.has(item.id)) fail(`overlapping ownership at ${item.startPc}`)
    if (!same(item.handlerStateIn, state))
      fail(`handler state at ${item.startPc}`)
    if (
      item.leaves.length === 0 ||
      item.leaves[0].pc !== item.startPc ||
      item.leaves.some(
        (leaf, index) =>
          leaf.reachable !== live ||
          (index && item.leaves[index - 1].nextPc !== leaf.pc),
      )
    )
      fail(`block inventory at ${item.startPc}`)
    owned.set(item.id, { item, phase })
    return item
  }
  const one = (item, kind) => {
    if (item.leaves.length !== 1 || item.leaves[0].operation.kind !== kind)
      fail(`expected ${kind} at ${item.startPc}`)
    return item.leaves[0].operation
  }
  const outgoing = (item) => {
    const result = item.successorEdgeIds.map((id) => emitter.edgeById.get(id))
    if (
      new Set(item.successorEdgeIds).size !== result.length ||
      result.some(
        (edge) =>
          !edge ||
          edge.functionId !== emitter.functionId ||
          edge.sourcePc !== item.leaves.at(-1).pc,
      )
    )
      fail(`edge inventory at ${item.startPc}`)
    for (const edge of result) usedEdges.add(edge.id)
    return result
  }
  const checkEdge = (edge, before, after) => {
    if (
      !same(edge.handlerStateBefore, before) ||
      !same(edge.handlerStateAfter, after)
    )
      fail(`edge state at ${edge.sourcePc}`)
    if (
      edge.targetPc !== null &&
      !same(at(edge.targetPc).handlerStateIn, after)
    )
      fail(`target state at ${edge.targetPc}`)
  }
  const sole = (item, kind, before, after, pc = item.leaves.at(-1).nextPc) => {
    const edges = outgoing(item)
    if (
      edges.length !== 1 ||
      edges[0].kind !== kind ||
      edges[0].targetPc !== pc
    )
      fail(`expected ${kind} edge at ${item.startPc}`)
    checkEdge(edges[0], before, after)
    return at(pc)
  }
  const protect = (instruction) => {
    const registers = functionRegisterSet([instruction])
    if (registers.has(continuation) || registers.has(payload))
      fail(`completion register used at ${instruction.pc}`)
  }
  const finallyPayload = (edge) => {
    const value = edge.payload
    if (
      value?.continuationRegister !== continuation ||
      value.payloadRegister !== payload ||
      value.finallyPc !== target ||
      value.throwPadPc !== throwPad
    )
      fail(`finally payload at ${edge.sourcePc}`)
  }
  own(block, empty, 'setup')
  // The caller renders an ordinary grouped prelude before the setup instruction.
  for (const leaf of block.leaves.slice(0, -1)) {
    if (!ORDINARY.has(leaf.operation.kind)) fail(`setup prelude at ${leaf.pc}`)
    protect(leaf)
  }
  if (continuation === payload) fail('aliased completion registers')
  // Native pending completions live outside the register file. A closure that
  // exposes either carrier could observe omitted implicit exceptional writes.
  const captured = localCaptureRegisterSet(emitter.instructions)
  if (captured.has(continuation) || captured.has(payload))
    fail('captured completion registers')
  catchSetup = sole(block, 'fallthrough', empty, outer)
  catchOperation = one(catchSetup, 'catch-setup')
  if ([continuation, payload].includes(catchOperation.exceptionRegister))
    fail('aliased catch register')
  own(catchSetup, outer, 'setup')
  const catchRecord = {
    type: 'handler',
    setupPc: catchSetup.startPc,
    handlerPc: catchOperation.target,
    exceptionReg: catchOperation.exceptionRegister,
  }
  inner = { stack: [finalRecord, catchRecord], finallyStack: [finalRecord] }
  const tryStart = sole(catchSetup, 'fallthrough', outer, inner)

  const terminalPad = (pc) => {
    const pad = at(pc)
    if (pads.has(pc)) return pads.get(pc)
    own(pad, empty, 'pad')
    if (one(pad, 'return').source !== payload) fail(`return payload at ${pc}`)
    const edges = outgoing(pad)
    if (
      edges.length !== 1 ||
      edges[0].kind !== 'return' ||
      edges[0].targetPc !== null
    )
      fail(`return pad at ${pc}`)
    checkEdge(edges[0], empty, empty)
    pads.set(pc, pad)
    return pad
  }
  const completion = (copy, phase) => {
    own(copy, outer, phase)
    const copyOp = one(copy, 'assign')
    if (
      copyOp.destination !== payload ||
      copyOp.value.kind !== 'register' ||
      [continuation, payload].includes(copyOp.value.index)
    )
      fail(`saved return at ${copy.startPc}`)
    const load = sole(copy, 'fallthrough', outer, outer)
    own(load, outer, phase)
    const loadOp = one(load, 'assign')
    if (
      loadOp.destination !== continuation ||
      loadOp.value.kind !== 'literal' ||
      !Number.isSafeInteger(loadOp.value.value)
    )
      fail(`return continuation at ${load.startPc}`)
    terminalPad(loadOp.value.value)
    const pop = sole(load, 'fallthrough', outer, outer)
    own(pop, outer, phase)
    one(pop, 'handler-pop')
    const jump = sole(pop, 'fallthrough', outer, empty)
    own(jump, empty, phase)
    if (one(jump, 'jump').target !== target)
      fail(`finalizer transfer at ${jump.startPc}`)
    sole(jump, 'finally', empty, empty, target)
    const edge = outgoing(jump)[0]
    if (edge.route !== 'normal')
      fail(`normal finalizer route at ${jump.startPc}`)
    finallyPayload(edge)
    return { kind: 'return', copy }
  }
  const exceptional = (edge, state, instruction, phase) => {
    const explicit = instruction.operation.kind === 'throw'
    if (phase === 'try') {
      if (
        edge.kind !== 'handler' ||
        edge.targetPc !== catchOperation.target ||
        edge.route !== 'exceptional' ||
        edge.payload?.exceptionRegister !== catchOperation.exceptionRegister ||
        edge.payload.throwRegister !==
          (explicit ? instruction.operation.source : null)
      )
        fail(`catch route at ${instruction.pc}`)
      checkEdge(edge, state, outer)
    } else if (phase === 'catch') {
      if (
        edge.kind !== 'finally' ||
        edge.targetPc !== target ||
        edge.route !== 'exceptional'
      )
        fail(`exceptional finalizer route at ${instruction.pc}`)
      finallyPayload(edge)
      if (
        edge.payload.throwRegister !==
        (explicit ? instruction.operation.source : null)
      )
        fail(`throw payload at ${instruction.pc}`)
      checkEdge(edge, state, empty)
      exceptionalFinally = true
    } else {
      if (
        edge.kind !== 'throw' ||
        edge.targetPc !== null ||
        edge.route !== 'propagate'
      )
        fail(`finalizer propagation at ${instruction.pc}`)
      checkEdge(edge, empty, empty)
    }
  }

  const graph = (start, phase, state) => {
    const nodes = new Map()
    const active = new Set()
    const visit = (item) => {
      if (active.has(item.id)) fail(`cyclic ${phase} region at ${item.startPc}`)
      if (nodes.has(item.id)) return
      active.add(item.id)
      const last = item.leaves.at(-1),
        op = last.operation
      let node
      if (phase === 'try' && op.kind === 'handler-pop') {
        own(item, state, phase)
        one(item, 'handler-pop')
        const copy = sole(item, 'fallthrough', state, outer)
        node = completion(copy, phase)
      } else if (
        phase === 'catch' &&
        op.kind === 'assign' &&
        op.destination === payload
      ) {
        node = completion(item, phase)
      } else {
        own(item, state, phase)
        for (const leaf of item.leaves.slice(0, -1)) {
          if (
            !ORDINARY.has(leaf.operation.kind) ||
            leaf.operation.kind === 'call'
          )
            fail(`grouped effect boundary at ${leaf.pc}`)
          protect(leaf)
        }
        if (phase === 'finally' && op.kind === 'indirect-jump') {
          if (item.leaves.length !== 1 || op.source !== continuation)
            fail(`finalizer resume at ${last.pc}`)
          node = { kind: 'resume', item }
        } else if (op.kind === 'throw') {
          protect(last)
          const edges = outgoing(item)
          if (edges.length !== 1) fail(`throw edge at ${last.pc}`)
          exceptional(edges[0], state, last, phase)
          node = { kind: 'throw', item }
        } else if (op.kind === 'branch' || op.kind === 'jump') {
          protect(last)
          const edges = outgoing(item)
          const expected =
            op.kind === 'branch'
              ? [
                  ['conditional', op.target],
                  ['fallthrough', last.nextPc],
                ]
              : [['branch', op.target]]
          if (edges.length !== expected.length)
            fail(`branch edges at ${last.pc}`)
          const next = expected.map(([kind, pc]) => {
            const edge = edges.find(
              (edge) => edge.kind === kind && edge.targetPc === pc,
            )
            if (!edge) fail(`branch target at ${last.pc}`)
            checkEdge(edge, state, state)
            return at(pc)
          })
          node = { kind: op.kind, item, next }
        } else {
          if (!ORDINARY.has(op.kind))
            fail(`unsupported ${phase} operation at ${last.pc}`)
          protect(last)
          const edges = outgoing(item)
          const normal = edges.filter(
            (edge) =>
              edge.kind === (op.kind === 'call' ? 'call' : 'fallthrough'),
          )
          const errors = edges.filter((edge) =>
            ['handler', 'finally', 'throw'].includes(edge.kind),
          )
          if (
            normal.length !== 1 ||
            normal[0].targetPc !== last.nextPc ||
            errors.length > 1 ||
            edges.length !== 1 + errors.length ||
            (op.kind === 'call' && errors.length !== 1)
          )
            fail(`effect edges at ${last.pc}`)
          checkEdge(normal[0], state, state)
          for (const edge of errors) exceptional(edge, state, last, phase)
          node = { kind: 'ordinary', item, next: [at(normal[0].targetPc)] }
        }
      }
      nodes.set(item.id, node)
      for (const next of node.next ?? []) visit(next)
      active.delete(item.id)
    }
    visit(start)
    // An artificial exit lets every normal terminal path participate in the
    // postdominator relation, without following lexical exception edges.
    const exit = Symbol('exit'),
      post = new Map([[exit, new Set([exit])]])
    const postdom = (id) => {
      if (post.has(id)) return post.get(id)
      const successors = (nodes.get(id).next ?? []).map((item) => item.id)
      if (!successors.length) successors.push(exit)
      const sets = successors.map(postdom)
      const result = new Set(
        [...sets[0]].filter((value) => sets.every((set) => set.has(value))),
      )
      result.add(id)
      post.set(id, result)
      return result
    }
    postdom(start.id)
    const rendered = new Set()
    const sequence = (id, stop = exit) => {
      const result = []
      while (id !== stop && id !== exit) {
        if (rendered.has(id))
          fail(`unowned shared join at ${nodes.get(id).item?.startPc ?? id}`)
        rendered.add(id)
        const node = nodes.get(id)
        if (node.kind === 'branch') {
          const [left, right] = node.next.map((item) => item.id)
          const common = [...postdom(left)].filter((value) =>
            postdom(right).has(value),
          )
          const nearest = common.filter((candidate) =>
            common.every((value) => postdom(candidate).has(value)),
          )
          if (nearest.length !== 1)
            fail(`ambiguous join at ${node.item.startPc}`)
          const merge = nearest[0]
          result.push({
            ...node,
            branch: sequence(left, merge),
            fallthrough: sequence(right, merge),
          })
          id = merge
        } else {
          result.push(node)
          id = node.next?.[0]?.id ?? exit
        }
      }
      return result
    }
    const tree = sequence(start.id)
    if (rendered.size !== nodes.size) fail(`incomplete ${phase} ownership`)
    return tree
  }
  const body = graph(tryStart, 'try', inner)
  const handler = graph(at(catchOperation.target), 'catch', outer)
  const finalizer = graph(at(target), 'finally', empty)
  const resumes = [...owned.values()].filter(
    ({ item, phase }) =>
      phase === 'finally' &&
      item.leaves.at(-1).operation.kind === 'indirect-jump',
  )
  if (resumes.length !== 1) fail('finalizer has no unique resume')
  const throwBlock = at(throwPad)
  const throwLive = exceptionalFinally
  own(throwBlock, empty, 'pad', throwLive)
  if (one(throwBlock, 'throw').source !== payload) fail('throw pad payload')
  const throwEdges = outgoing(throwBlock)
  if (throwLive) {
    if (
      throwEdges.length !== 1 ||
      throwEdges[0].kind !== 'throw' ||
      throwEdges[0].targetPc !== null
    )
      fail('throw pad edge')
    checkEdge(throwEdges[0], empty, empty)
  } else if (throwEdges.length) fail('unreachable throw pad edge')
  const resume = resumes[0].item
  const targets = new Set([...pads.keys(), ...(throwLive ? [throwPad] : [])])
  const resumeEdges = outgoing(resume)
  if (
    !pads.size ||
    resumeEdges.length !== targets.size ||
    new Set(resumeEdges.map((edge) => edge.targetPc)).size !== targets.size ||
    resumeEdges.some(
      (edge) =>
        edge.kind !== 'branch' ||
        edge.mode !== 'indirect' ||
        !targets.has(edge.targetPc),
    )
  )
    fail('resume target census')
  for (const edge of resumeEdges) checkEdge(edge, empty, empty)
  // Every global edge incident to an owned block must be represented by its
  // source block, and no outside entry may bypass the region's setup.
  const ownerByPc = new Map(
    emitter.blocks.flatMap((item) =>
      item.leaves.map((leaf) => [leaf.pc, item]),
    ),
  )
  for (const edge of emitter.edgeById.values()) {
    if (edge.functionId !== emitter.functionId) continue
    const source = ownerByPc.get(edge.sourcePc),
      destination = edge.targetPc === null ? null : ownerByPc.get(edge.targetPc)
    if (owned.has(source?.id) && !usedEdges.has(edge.id))
      fail(`unlisted edge at ${edge.sourcePc}`)
    if (
      owned.has(destination?.id) &&
      destination.id !== block.id &&
      !owned.has(source?.id)
    )
      fail(`outside entry at ${edge.targetPc}`)
  }
  return {
    owned: [...owned.values()].map(({ item }) => item),
    body,
    handler,
    finalizer,
    exceptionRegister: catchOperation.exceptionRegister,
  }
}
