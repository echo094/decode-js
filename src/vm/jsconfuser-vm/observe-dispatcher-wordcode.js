const MATH = Symbol('pinned Math global')
const IMUL = Symbol('pinned Math.imul method')
const RECEIVER = Symbol('unused decode receiver')

export class DispatcherDecline extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function decline(code, message) {
  throw new DispatcherDecline(code, message)
}

function requireShape(value, message) {
  if (!value) decline('dispatcher-shape', message)
  return value
}

function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    decline('dispatcher-decode', 'Decode closure used a nonnumeric value')
  }
  return value
}

function evaluateClosure(instructions, descriptor, pool, args) {
  if (
    descriptor.captureCount !== 0 ||
    descriptor.hasRest ||
    descriptor.paramCount !== args.length ||
    descriptor.regCount < args.length
  ) {
    decline('dispatcher-closure', 'Decode closure has unexpected metadata')
  }
  const registers = Array(descriptor.regCount).fill(undefined)
  args.forEach((value, index) => {
    registers[index] = value
  })
  const read = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= registers.length) {
      decline('dispatcher-closure', 'Decode closure reads outside its frame')
    }
    return registers[index]
  }
  const write = (index, value) => {
    if (!Number.isInteger(index) || index < 0 || index >= registers.length) {
      decline('dispatcher-closure', 'Decode closure writes outside its frame')
    }
    registers[index] = value
  }
  let result
  let returned = false
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index]
    const w = instruction.words
    if (instruction.name === 'RETURN') {
      result = read(w[1])
      returned = true
      const tail = instructions.slice(index + 1)
      if (
        tail.length !== 2 ||
        tail[0].name !== 'LOAD_CONST' ||
        tail[0].words[3] !== 0 ||
        pool[tail[0].words[2]] !== undefined ||
        tail[1].name !== 'RETURN' ||
        tail[1].words[1] !== tail[0].words[1]
      ) {
        decline('dispatcher-closure', 'Decode closure has an unexpected tail')
      }
      break
    }
    if (instruction.name === 'LOAD_THIS') {
      write(w[1], RECEIVER)
    } else if (instruction.name === 'LOAD_INT') {
      write(w[1], w[2])
    } else if (instruction.name === 'LOAD_CONST') {
      if (w[3] !== 0 || w[2] >= pool.length) {
        decline('dispatcher-closure', 'Decode closure has an invalid constant')
      }
      write(w[1], pool[w[2]])
    } else if (instruction.name === 'LOAD_GLOBAL') {
      if (w[3] !== 0 || pool[w[2]] !== 'Math') {
        decline('dispatcher-closure', 'Decode closure reads another global')
      }
      write(w[1], MATH)
    } else if (instruction.name === 'GET_PROP') {
      if (read(w[2]) !== MATH || read(w[3]) !== 'imul') {
        decline('dispatcher-closure', 'Decode closure reads another property')
      }
      write(w[1], IMUL)
    } else if (instruction.name === 'CALL_METHOD') {
      if (
        read(w[2]) !== MATH ||
        read(w[3]) !== IMUL ||
        w[4] !== 2 ||
        w.length !== 7
      ) {
        decline('dispatcher-closure', 'Decode closure calls another method')
      }
      write(w[1], Math.imul(number(read(w[5])), number(read(w[6]))))
    } else if (instruction.name === 'MOVE') {
      write(w[1], read(w[2]))
    } else if (instruction.name === 'UNARY_BITNOT') {
      write(w[1], ~number(read(w[2])))
    } else if (
      instruction.name === 'ADD' ||
      instruction.name === 'SUB' ||
      instruction.name === 'BOR' ||
      instruction.name === 'BXOR' ||
      instruction.name === 'SHL' ||
      instruction.name === 'USHR'
    ) {
      const left = number(read(w[2]))
      const right = number(read(w[3]))
      const value = {
        ADD: () => left + right,
        SUB: () => left - right,
        BOR: () => left | right,
        BXOR: () => left ^ right,
        SHL: () => left << right,
        USHR: () => left >>> right,
      }[instruction.name]()
      write(w[1], value)
    } else if (instruction.name === 'BUILD_ARRAY') {
      if (w[2] !== 1 || w.length !== 4) {
        decline('dispatcher-closure', 'Decode array has unexpected width')
      }
      write(w[1], { kind: 'array', value: read(w[3]) })
    } else if (instruction.name === 'BUILD_OBJECT') {
      if (w[2] !== 1 || w.length !== 5 || typeof read(w[3]) !== 'string') {
        decline('dispatcher-closure', 'Decode object has unexpected width')
      }
      write(w[1], {
        kind: 'object',
        key: read(w[3]),
        value: read(w[4]),
      })
    } else {
      decline(
        'dispatcher-closure',
        `Decode closure uses unsupported ${instruction.name}`,
      )
    }
  }
  if (!returned) decline('dispatcher-closure', 'Decode closure has no return')
  return result
}

function instructionsFor(fn, byPc) {
  return fn.instructionPcs.map((pc) =>
    requireShape(byPc.get(pc), `Function ${fn.id} has a missing instruction`),
  )
}

function readDispatcherTail(ownerInstructions, hoist, closure, pool) {
  const jump = ownerInstructions.at(-1)
  requireShape(
    jump?.name === 'JUMP_REG',
    'Dispatcher block does not end in JUMP_REG',
  )
  const disp = jump.words[1]
  let callIndex = ownerInstructions.length - 2
  let resultMode = { kind: 'direct' }
  const get = ownerInstructions[callIndex]
  if (get?.name === 'GET_PROP') {
    const load = ownerInstructions[callIndex - 1]
    requireShape(
      get.words[1] === disp &&
        get.words[2] === disp &&
        load?.words[1] === get.words[3],
      'Dispatcher result unwrap is disconnected',
    )
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
    callIndex -= 2
  }
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
  let keyRegisters
  if (args.length === 2 && args.filter((item) => item === disp).length === 1) {
    keyRegisters = args.filter((item) => item !== disp)
  } else if (
    args.length === 3 &&
    args[0] === disp &&
    args[1] !== disp &&
    args[2] !== disp &&
    args[1] !== args[2]
  ) {
    keyRegisters = args.slice(1)
  } else {
    decline('dispatcher-shape', 'Dispatcher argument order is not pinned')
  }
  return {
    call,
    disp,
    args,
    keyRegisters,
    resultMode,
    block: ownerInstructions.slice(callIndex),
  }
}

function routeAt(
  ownerInstructions,
  jumpIndex,
  tail,
  closureInstructions,
  closure,
  pool,
  decodedTargetMap,
  suspects,
) {
  const jump = ownerInstructions[jumpIndex]
  if (jump.name !== 'JUMP' || jump.words[1] !== tail.call.pc) return null
  let cursor = jumpIndex - 1
  const keyParts = []
  for (const register of [...tail.keyRegisters].reverse()) {
    const load = ownerInstructions[cursor--]
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
  // decodeOrigin gives the address the encoder wrote (a Packet A PC); decode reads it in this
  // stream's space.
  const decodeOrigin = (encoded) => {
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
    const mode = tail.resultMode
    const value =
      mode.kind === 'direct'
        ? result
        : result?.kind === mode.kind &&
            (mode.kind === 'array' || result.key === mode.key)
          ? result.value
          : null
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      decline(
        'dispatcher-target',
        `Dispatcher route at ${jump.pc} has no numeric target`,
      )
    }
    return value
  }
  const decode = (encoded) => {
    const value = decodeOrigin(encoded)
    if (!decodedTargetMap) return value
    if (!decodedTargetMap.has(value)) {
      decline('dispatcher-target', 'Decoded target has no anti PC boundary')
    }
    return decodedTargetMap.get(value)
  }
  const last = ownerInstructions[cursor]
  if (last?.name === 'LOAD_INT' && last.words[1] === tail.disp) {
    return {
      startPc: last.pc,
      endPc: jump.nextPc,
      oldPcs: ownerInstructions
        .slice(cursor, jumpIndex + 1)
        .map((item) => item.pc),
      name: 'JUMP',
      target: decode(last.words[2]),
    }
  }
  requireShape(
    last?.name === 'ADD' &&
      last.words[1] === tail.disp &&
      last.words[2] === tail.disp,
    `Dispatcher route at ${jump.pc} has no pinned selector`,
  )
  const delta = last.words[3]
  const select = ownerInstructions[--cursor]
  requireShape(
    (select?.name === 'MUL' || select?.name === 'BAND') &&
      select.words[1] === delta &&
      ((select.words[2] === delta && select.words[3] !== delta) ||
        (select.words[3] === delta && select.words[2] !== delta)),
    `Dispatcher route at ${jump.pc} has an invalid selector`,
  )
  const test = select.words[2] === delta ? select.words[3] : select.words[2]
  const sub = ownerInstructions[--cursor]
  requireShape(
    sub?.name === 'SUB' &&
      sub.words[1] === delta &&
      sub.words[2] === delta &&
      sub.words[3] === tail.disp,
    `Dispatcher route at ${jump.pc} has an invalid delta`,
  )
  const other = ownerInstructions[--cursor]
  const base = ownerInstructions[--cursor]
  requireShape(
    other?.name === 'LOAD_INT' &&
      other.words[1] === delta &&
      base?.name === 'LOAD_INT' &&
      base.words[1] === tail.disp,
    `Dispatcher route at ${jump.pc} has invalid endpoints`,
  )
  if (select.name === 'BAND') {
    const neg = ownerInstructions[--cursor]
    requireShape(
      neg?.name === 'UNARY_NEG' &&
        neg.words[1] === test &&
        neg.words[2] === test,
      `Dispatcher route at ${jump.pc} has no mask`,
    )
  }
  const positive = ownerInstructions[--cursor]
  const invert = ownerInstructions[--cursor]
  requireShape(
    positive?.name === 'UNARY_POS' &&
      positive.words[1] === test &&
      positive.words[2] === test &&
      invert?.name === 'UNARY_NOT' &&
      invert.words[1] === test,
    `Dispatcher route at ${jump.pc} has no pinned condition`,
  )
  const baseTarget = decode(base.words[2])
  const otherTarget = decode(other.words[2])
  // The skip label follows the JUMP, past any suspects selfModifying planted after it; while they
  // are undecided, the label may sit on any of them.
  const after =
    ownerInstructions.slice(jumpIndex + 1).find(({ pc }) => !suspects.has(pc))
      ?.pc ?? jump.nextPc
  const skipped = (target) =>
    target === jump.nextPc ||
    (target > jump.nextPc &&
      target <= after &&
      (target === after || suspects.has(target)))
  if (baseTarget === otherTarget) {
    return {
      startPc: invert.pc,
      endPc: jump.nextPc,
      oldPcs: ownerInstructions
        .slice(cursor, jumpIndex + 1)
        .map((item) => item.pc),
      name: 'JUMP',
      target: baseTarget,
    }
  }
  if (skipped(baseTarget) === skipped(otherTarget)) {
    decline(
      'dispatcher-target',
      `Dispatcher route at ${jump.pc} has no unique skip edge`,
    )
  }
  return {
    startPc: invert.pc,
    endPc: jump.nextPc,
    oldPcs: ownerInstructions
      .slice(cursor, jumpIndex + 1)
      .map((item) => item.pc),
    name: skipped(baseTarget) ? 'JUMP_IF_FALSE' : 'JUMP_IF_TRUE',
    condition: invert.words[2],
    target: skipped(baseTarget) ? otherTarget : baseTarget,
    // The JUMP_IF falls through where the JUMP skipped to; a later owner settling what lies between
    // needs this label.
    skipOrigin: decodeOrigin((skipped(baseTarget) ? base : other).words[2]),
  }
}

// A PATCH suspect (an undecided selfModifying filler, planted after a terminator) is read past
// where this decoder relies on what follows a terminator (the closure tail, the instruction before
// the dispatcher block, a route's skip label) and by the scans for dispatcher registers. Routes
// match over every instruction, as a hidden label can sit on a suspect that starts one. Suspects
// stay in the output as they are.
function recognize(container, wordcode, functions, decodedTargetMap, origin) {
  const suspects = new Set(
    origin.map((pc) => (decodedTargetMap ? decodedTargetMap.get(pc) : pc)),
  )
  const byPc = new Map(wordcode.instructions.map((item) => [item.pc, item]))
  const byStart = new Map(
    functions.functions.map((item) => [item.startPc, item]),
  )
  const ownerByPc = new Map(
    functions.ownership.map((item) => [item.pc, item.functionId]),
  )
  const plans = []
  for (const owner of functions.functions) {
    const instructions = instructionsFor(owner, byPc)
    const hoist = instructions[0]
    if (
      hoist.name !== 'MAKE_CLOSURE' ||
      instructions.at(-1).name !== 'JUMP_REG'
    )
      continue
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
    const tail = readDispatcherTail(
      instructions,
      hoist,
      closure,
      container.roles.pool.values,
    )
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
    for (const instruction of instructions) {
      if (instruction === hoist || instruction === tail.call) continue
      if (suspects.has(instruction.pc)) continue
      if (
        instruction.wordOperands.some(
          (operand) =>
            operand.kind === 'register' && operand.index === closureRegister,
        )
      ) {
        decline(
          'dispatcher-closure',
          `Function ${owner.id} uses its decode closure outside dispatch`,
        )
      }
    }
    const routes = []
    for (let index = 0; index < instructions.length; index += 1) {
      const route = routeAt(
        instructions,
        index,
        tail,
        closureInstructions,
        closure,
        container.roles.pool.values,
        decodedTargetMap,
        suspects,
      )
      if (route) routes.push(route)
    }
    requireShape(
      routes.length > 0,
      `Function ${owner.id} has no dispatcher routes`,
    )
    const used = new Set()
    for (const route of routes) {
      for (const pc of route.oldPcs) {
        if (used.has(pc))
          decline('dispatcher-shape', 'Dispatcher routes overlap')
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
    const erasedRegisters = new Set([
      closureRegister,
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
    for (const instruction of instructions) {
      if (erasedPcs.has(instruction.pc) || suspects.has(instruction.pc))
        continue
      if (
        instruction.operands.some(
          (operand) =>
            operand.kind === 'register' && erasedRegisters.has(operand.index),
        ) ||
        instruction.captures?.some(
          (capture) =>
            capture.kind === 'local' && erasedRegisters.has(capture.index),
        )
      )
        decline(
          'dispatcher-shape',
          `Dispatcher register escapes into payload at ${instruction.pc}`,
        )
    }
    plans.push({
      ownerId: owner.id,
      closureId: closure.id,
      hoistPc: hoist.pc,
      dispatcherPcs: tail.block.map((item) => item.pc),
      routes,
    })
  }
  if (plans.length === 0) decline('no-dispatcher', 'No dispatcher block exists')
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
    return {
      ok: true,
      result: recognize(
        container,
        wordcode,
        functions,
        decodedTargetMap,
        suspects,
      ),
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof DispatcherDecline
            ? error.code
            : 'dispatcher-observation-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
