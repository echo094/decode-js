import { declines } from '../../decline.js'
import { evaluateClosure } from './evaluate-decode-closure.js'

export const { decline, unwrap, accepted, refused } = declines('dispatcher')

function requireShape(value, message) {
  if (!value) decline('dispatcher-shape', message)
  return value
}

// The target a route's closure returns (`mode`, its result mode): the result itself, or the value
// of the record it returns when that record has the mode's kind and key.
function routeValue(mode, result) {
  if (mode.kind === 'direct') return result
  const matches =
    result?.kind === mode.kind &&
    (mode.kind === 'array' || result.key === mode.key)
  return matches ? result.value : null
}

function instructionsFor(fn, byPc) {
  return fn.instructionPcs.map((pc) =>
    requireShape(byPc.get(pc), `Function ${fn.id} has a missing instruction`),
  )
}

// The optional result unwrap between the CALL and the JUMP_REG: LOAD key, GET_PROP disp,disp,key.
function readResultMode(ownerInstructions, callIndex, disp, pool) {
  const get = ownerInstructions[callIndex]
  if (get?.name !== 'GET_PROP') return { kind: 'direct' }
  const load = ownerInstructions[callIndex - 1]
  requireShape(
    get.words[1] === disp &&
      get.words[2] === disp &&
      load?.words[1] === get.words[3],
    'Dispatcher result unwrap is disconnected',
  )
  let resultMode
  if (load.name === 'LOAD_INT' && load.words[2] === 0) {
    resultMode = { kind: 'array' }
  } else if (
    load.name === 'LOAD_CONST' &&
    load.words[3] === 0 &&
    typeof pool[load.words[2]] === 'string'
  ) {
    resultMode = { kind: 'object', key: pool[load.words[2]] }
  } else {
    decline('dispatcher-shape', 'Dispatcher result key is not pinned')
  }
  return resultMode
}

// The key arguments beside disp: two arguments in either order, or disp, keyLo, keyHi.
function readKeyRegisters(args, disp) {
  if (args.length === 2 && args.filter((item) => item === disp).length === 1) {
    return args.filter((item) => item !== disp)
  }
  if (
    args.length === 3 &&
    args[0] === disp &&
    args[1] !== disp &&
    args[2] !== disp &&
    args[1] !== args[2]
  ) {
    return args.slice(1)
  }
  decline('dispatcher-shape', 'Dispatcher argument order is not pinned')
}

function readDispatcherTail(ownerInstructions, hoist, closure, pool) {
  const jump = ownerInstructions.at(-1)
  requireShape(
    jump?.name === 'JUMP_REG',
    'Dispatcher block does not end in JUMP_REG',
  )
  const disp = jump.words[1]
  const resultMode = readResultMode(
    ownerInstructions,
    ownerInstructions.length - 2,
    disp,
    pool,
  )
  const callIndex =
    ownerInstructions.length - (resultMode.kind === 'direct' ? 2 : 4)
  const call = ownerInstructions[callIndex]
  requireShape(
    call?.name === 'CALL' &&
      call.words[1] === disp &&
      call.words[2] === hoist.words[1] &&
      call.words[3] === closure.descriptor.paramCount &&
      (call.words[3] === 2 || call.words[3] === 3) &&
      call.words.length === call.words[3] + 4,
    'Dispatcher call is not pinned',
  )
  const args = call.words.slice(4)
  return {
    call,
    disp,
    args,
    keyRegisters: readKeyRegisters(args, disp),
    resultMode,
    block: ownerInstructions.slice(callIndex),
  }
}

// One owner's decode closure, evaluated for a route: `origin` gives the address the encoder wrote
// (an origin PC); `decode` reads it in this stream's space.
function endpointDecoder({ closure, closureInstructions, pool, tail }, map) {
  const origin = (encoded, keyParts, jumpPc) => {
    const args = tail.args.map((register) =>
      register === tail.disp
        ? encoded
        : keyParts[tail.keyRegisters.indexOf(register)],
    )
    const result = evaluateClosure(
      closureInstructions,
      closure.descriptor,
      pool,
      args,
    )
    const value = routeValue(tail.resultMode, result)
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      decline(
        'dispatcher-target',
        `Dispatcher route at ${jumpPc} has no numeric target`,
      )
    }
    return value
  }
  const decode = (encoded, keyParts, jumpPc) => {
    const value = origin(encoded, keyParts, jumpPc)
    if (!map) return value
    if (!map.has(value)) {
      decline('dispatcher-target', 'Decoded target has no anti PC boundary')
    }
    return map.get(value)
  }
  return { origin, decode }
}

const spanPcs = (instructions, from, jumpIndex) =>
  instructions.slice(from, jumpIndex + 1).map((item) => item.pc)

// The site key loaded right before the route's JUMP, one LOAD_INT per key register.
function readRouteKey(instructions, jumpIndex, tail) {
  const jump = instructions[jumpIndex]
  let cursor = jumpIndex - 1
  const keyParts = []
  for (const register of [...tail.keyRegisters].reverse()) {
    const load = instructions[cursor--]
    requireShape(
      load?.name === 'LOAD_INT' && load.words[1] === register,
      `Dispatcher route at ${jump.pc} has no site key`,
    )
    keyParts.unshift(load.words[2])
  }
  const key =
    keyParts.length === 1
      ? keyParts[0]
      : (keyParts[0] | (keyParts[1] << 16)) >>> 0
  if (
    key === 0 ||
    (keyParts.length === 2 && keyParts.some((part) => part > 0xffff))
  ) {
    decline(
      'dispatcher-key',
      `Dispatcher route at ${jump.pc} has an invalid key`,
    )
  }
  return { keyParts, cursor }
}

// The branchless selector before the key loads, read backwards from its ADD: disp = base +
// (other - base) * test, test = +!condition (negated for BAND).
// eslint-disable-next-line complexity -- one fixed instruction sequence; each `&&` is one word it pins
function readSelector(instructions, start, tail, jump) {
  let cursor = start
  const last = instructions[cursor]
  requireShape(
    last?.name === 'ADD' &&
      last.words[1] === tail.disp &&
      last.words[2] === tail.disp,
    `Dispatcher route at ${jump.pc} has no pinned selector`,
  )
  const delta = last.words[3]
  const select = instructions[--cursor]
  requireShape(
    (select?.name === 'MUL' || select?.name === 'BAND') &&
      select.words[1] === delta &&
      ((select.words[2] === delta && select.words[3] !== delta) ||
        (select.words[3] === delta && select.words[2] !== delta)),
    `Dispatcher route at ${jump.pc} has an invalid selector`,
  )
  const test = select.words[2] === delta ? select.words[3] : select.words[2]
  const sub = instructions[--cursor]
  requireShape(
    sub?.name === 'SUB' &&
      sub.words[1] === delta &&
      sub.words[2] === delta &&
      sub.words[3] === tail.disp,
    `Dispatcher route at ${jump.pc} has an invalid delta`,
  )
  const other = instructions[--cursor]
  const base = instructions[--cursor]
  requireShape(
    other?.name === 'LOAD_INT' &&
      other.words[1] === delta &&
      base?.name === 'LOAD_INT' &&
      base.words[1] === tail.disp,
    `Dispatcher route at ${jump.pc} has invalid endpoints`,
  )
  if (select.name === 'BAND') {
    const neg = instructions[--cursor]
    requireShape(
      neg?.name === 'UNARY_NEG' &&
        neg.words[1] === test &&
        neg.words[2] === test,
      `Dispatcher route at ${jump.pc} has no mask`,
    )
  }
  const positive = instructions[--cursor]
  const invert = instructions[--cursor]
  requireShape(
    positive?.name === 'UNARY_POS' &&
      positive.words[1] === test &&
      positive.words[2] === test &&
      invert?.name === 'UNARY_NOT' &&
      invert.words[1] === test,
    `Dispatcher route at ${jump.pc} has no pinned condition`,
  )
  return { invert, base, other, cursor }
}

// Both endpoints decoded: equal ones are one JUMP; otherwise exactly one is the skip edge, past the
// JUMP and any suspects selfModifying planted after it (the label may sit on any of them), and the
// other is the JUMP_IF's target.
function chooseEndpoint(instructions, jumpIndex, selector, keyParts, owner) {
  const { decoder, suspects } = owner
  const jump = instructions[jumpIndex]
  const { invert, base, other, cursor } = selector
  const baseTarget = decoder.decode(base.words[2], keyParts, jump.pc)
  const otherTarget = decoder.decode(other.words[2], keyParts, jump.pc)
  const after =
    instructions.slice(jumpIndex + 1).find(({ pc }) => !suspects.has(pc))?.pc ??
    jump.nextPc
  const skipped = (target) =>
    target === jump.nextPc ||
    (target > jump.nextPc &&
      target <= after &&
      (target === after || suspects.has(target)))
  const span = {
    startPc: invert.pc,
    endPc: jump.nextPc,
    oldPcs: spanPcs(instructions, cursor, jumpIndex),
  }
  if (baseTarget === otherTarget)
    return { ...span, name: 'JUMP', target: baseTarget }
  if (skipped(baseTarget) === skipped(otherTarget)) {
    decline(
      'dispatcher-target',
      `Dispatcher route at ${jump.pc} has no unique skip edge`,
    )
  }
  return {
    ...span,
    name: skipped(baseTarget) ? 'JUMP_IF_FALSE' : 'JUMP_IF_TRUE',
    condition: invert.words[2],
    target: skipped(baseTarget) ? otherTarget : baseTarget,
    // The JUMP_IF falls through where the JUMP skipped to; a later owner settling what lies between
    // needs this label.
    skipOrigin: decoder.origin(
      (skipped(baseTarget) ? base : other).words[2],
      keyParts,
      jump.pc,
    ),
  }
}

// A route: a JUMP to the dispatcher CALL, its site key, and either a direct LOAD_INT of disp or
// the branchless selector.
function routeAt(instructions, jumpIndex, owner) {
  const { tail, decoder } = owner
  const jump = instructions[jumpIndex]
  if (jump.name !== 'JUMP' || jump.words[1] !== tail.call.pc) return null
  const { keyParts, cursor } = readRouteKey(instructions, jumpIndex, tail)
  const last = instructions[cursor]
  if (last?.name === 'LOAD_INT' && last.words[1] === tail.disp) {
    return {
      startPc: last.pc,
      endPc: jump.nextPc,
      oldPcs: spanPcs(instructions, cursor, jumpIndex),
      name: 'JUMP',
      target: decoder.decode(last.words[2], keyParts, jump.pc),
    }
  }
  const selector = readSelector(instructions, cursor, tail, jump)
  return chooseEndpoint(instructions, jumpIndex, selector, keyParts, owner)
}

// A candidate owner creates its decode closure first and ends in JUMP_REG; the hoist names a child
// created there with the CALL's arity.
function bindOwner(owner, context) {
  const { byPc, byStart, suspects } = context
  const instructions = instructionsFor(owner, byPc)
  const hoist = instructions[0]
  if (hoist.name !== 'MAKE_CLOSURE' || instructions.at(-1).name !== 'JUMP_REG')
    return null
  requireShape(
    hoist.words[5] === 0 && hoist.words[6] === 0,
    `Function ${owner.id} has no dispatcher closure hoist`,
  )
  const closure = byStart.get(hoist.words[2])
  requireShape(
    closure?.descriptor?.creationPc === hoist.pc &&
      closure.descriptor.paramCount === hoist.words[3],
    `Function ${owner.id} has no unique decoder closure`,
  )
  const closureInstructions = instructionsFor(closure, byPc).filter(
    ({ pc }) => !suspects.has(pc),
  )
  return { instructions, hoist, closure, closureInstructions }
}

// Nothing falls into the dispatcher block, and the closure register serves only the hoist and CALL.
function checkDispatcherBlock(owner, bound, tail, suspects) {
  const { instructions, hoist } = bound
  const callIndex = instructions.findIndex((item) => item === tail.call)
  const before = instructions
    .slice(0, callIndex)
    .findLast(({ pc }) => !suspects.has(pc))
  requireShape(
    callIndex > 0 &&
      ['RETURN', 'THROW', 'JUMP', 'JUMP_REG'].includes(before?.name),
    `Function ${owner.id} falls into its dispatcher block`,
  )
  const closureRegister = hoist.words[1]
  const usesClosure = (instruction) =>
    instruction.operands.some(
      (operand) =>
        operand.kind === 'register' && operand.index === closureRegister,
    )
  for (const instruction of instructions) {
    if (instruction === hoist || instruction === tail.call) continue
    if (suspects.has(instruction.pc)) continue
    if (usesClosure(instruction)) {
      decline(
        'dispatcher-closure',
        `Function ${owner.id} uses its decode closure outside dispatch`,
      )
    }
  }
}

// Routes are disjoint and land on an instruction start of their owner, before the CALL.
function checkRoutes(routes, owner, tail, context) {
  const { byPc, ownerByPc } = context
  const used = new Set()
  for (const route of routes) {
    for (const pc of route.oldPcs) {
      if (used.has(pc)) decline('dispatcher-shape', 'Dispatcher routes overlap')
      used.add(pc)
    }
    if (
      !byPc.has(route.target) ||
      ownerByPc.get(route.target) !== owner.id ||
      route.target >= tail.call.pc ||
      (route.name !== 'JUMP' && !byPc.has(route.endPc))
    ) {
      decline('dispatcher-target', 'Decoded target leaves the original body')
    }
  }
  return used
}

// What is erased (hoist, dispatcher block, route spans, and the registers they write) is observed
// by no retained condition or instruction.
function proveErasedState(instructions, plan) {
  const { hoist, tail, routes, used, suspects } = plan
  const erasedRegisters = new Set([
    hoist.words[1],
    tail.disp,
    ...tail.keyRegisters,
  ])
  const erasedPcs = new Set([
    hoist.pc,
    ...tail.block.map((item) => item.pc),
    ...used,
  ])
  for (const instruction of instructions) {
    if (
      erasedPcs.has(instruction.pc) &&
      !['JUMP', 'JUMP_REG'].includes(instruction.name)
    )
      erasedRegisters.add(instruction.words[1])
  }
  for (const route of routes) {
    if (route.condition !== undefined && erasedRegisters.has(route.condition))
      decline('dispatcher-shape', 'Dispatcher condition uses erased state')
  }
  const observes = (instruction) =>
    instruction.operands.some(
      (operand) =>
        operand.kind === 'register' && erasedRegisters.has(operand.index),
    ) ||
    instruction.captures?.some(
      (capture) =>
        capture.kind === 'local' && erasedRegisters.has(capture.index),
    )
  for (const instruction of instructions) {
    if (erasedPcs.has(instruction.pc) || suspects.has(instruction.pc)) continue
    if (observes(instruction))
      decline(
        'dispatcher-shape',
        `Dispatcher register escapes into payload at ${instruction.pc}`,
      )
  }
}

function observeOwner(owner, context) {
  const bound = bindOwner(owner, context)
  if (!bound) return null
  const { instructions, hoist, closure } = bound
  const { pool, suspects } = context
  const tail = readDispatcherTail(instructions, hoist, closure, pool)
  checkDispatcherBlock(owner, bound, tail, suspects)
  const decoder = endpointDecoder(
    { ...bound, pool, tail },
    context.decodedTargetMap,
  )
  const routes = []
  for (let index = 0; index < instructions.length; index += 1) {
    const route = routeAt(instructions, index, { tail, decoder, suspects })
    if (route) routes.push(route)
  }
  requireShape(
    routes.length > 0,
    `Function ${owner.id} has no dispatcher routes`,
  )
  const used = checkRoutes(routes, owner, tail, context)
  proveErasedState(instructions, { hoist, tail, routes, used, suspects })
  return {
    ownerId: owner.id,
    closureId: closure.id,
    hoistPc: hoist.pc,
    dispatcherPcs: tail.block.map((item) => item.pc),
    routes,
  }
}

// Each decode closure belongs to one owner and is created only at its hoist.
function checkClosureCreation(plans, wordcode, functions) {
  const closureIds = new Set(plans.map((item) => item.closureId))
  if (closureIds.size !== plans.length) {
    decline('dispatcher-closure', 'Dispatcher closure is shared by owners')
  }
  const functionById = new Map(
    functions.functions.map((item) => [item.id, item]),
  )
  for (const plan of plans) {
    const references = wordcode.instructions.filter(
      (item) =>
        item.name === 'MAKE_CLOSURE' &&
        functionById.get(plan.closureId)?.startPc === item.words[2],
    )
    if (references.length !== 1 || references[0].pc !== plan.hoistPc) {
      decline('dispatcher-closure', 'Decode closure has another creation site')
    }
  }
}

// A PATCH suspect (an undecided selfModifying filler, planted after a terminator) is read past
// where this decoder relies on what follows a terminator (the closure tail, the instruction before
// the dispatcher block, a route's skip label) and by the scans for dispatcher registers. Routes
// match over every instruction, as a hidden label can sit on a suspect that starts one. Suspects
// stay in the output as they are.
// The suspects' PCs in the decoded stream (`decodedTargetMap`), or as given when it is absent.
export function decodedSuspects(origin, decodedTargetMap) {
  return new Set(
    origin.map((pc) => (decodedTargetMap ? decodedTargetMap.get(pc) : pc)),
  )
}

function recognize(container, wordcode, functions, decodedTargetMap, origin) {
  const context = {
    suspects: decodedSuspects(origin, decodedTargetMap),
    byPc: new Map(wordcode.instructions.map((item) => [item.pc, item])),
    byStart: new Map(functions.functions.map((item) => [item.startPc, item])),
    ownerByPc: new Map(
      functions.ownership.map((item) => [item.pc, item.functionId]),
    ),
    pool: container.roles.pool.values,
    decodedTargetMap,
  }
  const plans = []
  for (const owner of functions.functions) {
    const plan = observeOwner(owner, context)
    if (plan) plans.push(plan)
  }
  if (plans.length === 0) decline('no-dispatcher', 'No dispatcher block exists')
  checkClosureCreation(plans, wordcode, functions)
  return {
    schemaVersion: 'jsconfuser-vm-dispatcher-observation.v1',
    plans,
  }
}

export function diagnoseDispatcherWordcode(
  container,
  wordcode,
  functions,
  decodedTargetMap,
  suspects = [],
) {
  try {
    return accepted(
      recognize(container, wordcode, functions, decodedTargetMap, suspects),
      { fallback: 'dispatcher-observation-error' },
    )
  } catch (error) {
    return refused(error, { fallback: 'dispatcher-observation-error' })
  }
}
