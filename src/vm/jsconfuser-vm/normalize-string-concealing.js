import { selectContinuationLoads } from './finally-continuations.js'
import { HELPER_SIGNATURES } from './string-concealing-helper-signatures.js'
import { diagnoseWordcode } from './read-wordcode.js'
import { diagnoseReferences } from './validate-references.js'
import { diagnoseFunctionPartition } from './partition-functions.js'

class StringConcealingDecline extends Error {
  constructor(message) {
    super(message)
    this.code = 'string-concealing-shape'
  }
}

function decline(message) {
  throw new StringConcealingDecline(message)
}

const TARGET_OFFSETS = Object.freeze({
  JUMP: [1],
  JUMP_IF_FALSE: [2],
  JUMP_IF_TRUE: [2],
  FOR_IN_NEXT: [3],
  TRY_SETUP: [1],
  FINALLY_SETUP: [1, 4],
  MAKE_CLOSURE: [2],
})

// The helper's trace in execution order: walk from its entry, follow every jump, and number
// instructions by first visit. A conditional records the instructions each outcome runs next, and
// reaching an instruction already traced records a GOTO. Layout and jumps to the next instruction
// leave no trace, so any earlier decoder's order gives the template's trace (CFF reorders bodies).
function helperTrace(items, pool, start = 0) {
  const byPc = new Map(items.map((item) => [item.pc, item]))
  const end = items.at(-1) ? items.at(-1).pc + items.at(-1).words.length : start
  const follow = (pc) => {
    const seen = new Set()
    while (byPc.get(pc)?.name === 'JUMP' && !seen.has(pc)) {
      seen.add(pc)
      pc = byPc.get(pc).words[1]
    }
    if (pc < start || pc >= end || !byPc.has(pc))
      decline(`String helper control leaves its body at ${pc}`)
    return pc
  }
  const value = (index) => {
    const raw = pool ? pool[index] : index
    // concealConstants' XOR restores this u32 literal in signed form;
    // the template's subsequent BOR 0 applies the same 32-bit coercion.
    if (raw === -1640531527) return 0x9e3779b9
    return raw === undefined ? '<undefined>' : raw
  }
  const registers = new Map()
  const read = (register) => registers.get(register) ?? `arg${register}`
  const order = new Map()
  const trace = []
  const branches = []
  const pending = [start]
  while (pending.length) {
    let pc = follow(pending.pop())
    for (;;) {
      if (order.has(pc)) {
        trace.push(['GOTO', pc])
        break
      }
      const item = byPc.get(pc)
      const w = item.words
      order.set(pc, trace.length)
      if (
        ((item.name === 'LOAD_CONST' || item.name === 'LOAD_GLOBAL') &&
          w[3] !== 0) ||
        (item.name === 'CALL' && w[3] !== w.length - 4) ||
        (item.name === 'CALL_METHOD' && w[4] !== w.length - 5)
      )
        decline(`String helper operand width changed at ${item.pc}`)
      const next = item.pc + w.length
      if (item.name === 'JUMP_IF_FALSE' || item.name === 'JUMP_IF_TRUE') {
        const target = follow(w[2])
        const fallthrough = follow(next)
        const [whenTrue, whenFalse] =
          item.name === 'JUMP_IF_FALSE'
            ? [fallthrough, target]
            : [target, fallthrough]
        const branch = ['IF', read(w[1]), whenTrue, whenFalse]
        trace.push(branch)
        branches.push(branch)
        pending.push(whenFalse)
        pc = whenTrue
        continue
      }
      if (item.name === 'RETURN') {
        trace.push(['RETURN', read(w[1])])
        break
      }
      let expression
      if (item.name === 'LOAD_THIS') expression = ['this']
      else if (item.name === 'LOAD_CONST')
        expression = ['constant', value(w[2])]
      else if (item.name === 'LOAD_GLOBAL') expression = ['global', value(w[2])]
      else if (item.name === 'MOVE') expression = ['move', read(w[2])]
      else if (item.name === 'GET_PROP')
        expression = ['get', read(w[2]), read(w[3])]
      else if (item.name === 'CALL')
        expression = ['call', read(w[2]), ...w.slice(4).map(read)]
      else if (item.name === 'CALL_METHOD')
        expression = ['method', read(w[2]), read(w[3]), ...w.slice(5).map(read)]
      else if (
        ['ADD', 'BOR', 'BXOR', 'BAND', 'SHL', 'USHR', 'LT'].includes(item.name)
      )
        expression = [item.name, read(w[2]), read(w[3])]
      else decline(`Unexpected ${item.name} in string helper`)
      trace.push([item.name, expression])
      registers.set(
        w[1],
        item.name === 'MOVE' ? expression[1] : `op${trace.length - 1}`,
      )
      pc = follow(next)
    }
  }
  for (const entry of trace)
    if (entry[0] === 'GOTO') entry[1] = order.get(entry[1])
  for (const branch of branches) {
    branch[2] = order.get(branch[2])
    branch[3] = order.get(branch[3])
  }
  return trace
}

// A function's instructions in execution order: from its entry, follow every jump (dropping it),
// take a conditional's fallthrough first and its other targets later, then append what no walk
// reached in layout order. A finally continuation load names the label the finalizer's JUMP_REG
// resumes at, so it is a target like any jump's. Instructions that run one after another stay
// adjacent whatever the layout, so prologue and call-site reads do not depend on it.
// `droppedBefore` collects, for each instruction, the jumps followed just before reaching it.
function executionOrder(items, start, droppedBefore = new Map()) {
  const byPc = new Map(items.map((item) => [item.pc, item]))
  const continuationLoads = selectContinuationLoads(
    items.map((item) => ({
      key: item.pc,
      functionId: 0,
      name: item.name,
      words: item.words,
    })),
  )
  const placed = new Set()
  const order = []
  const pending = [start]
  while (pending.length) {
    let pc = pending.pop()
    let jumps = []
    while (byPc.has(pc) && !placed.has(pc)) {
      const item = byPc.get(pc)
      placed.add(pc)
      if (item.name === 'JUMP') {
        jumps.push(item.pc)
        pc = item.words[1]
        continue
      }
      if (jumps.length) droppedBefore.set(item.pc, jumps)
      jumps = []
      order.push(item)
      for (const offset of TARGET_OFFSETS[item.name] ?? [])
        if (item.name !== 'MAKE_CLOSURE') pending.push(item.words[offset])
      if (continuationLoads.has(item.pc)) pending.push(item.words[2])
      if (['RETURN', 'THROW', 'JUMP_REG'].includes(item.name)) break
      pc = item.pc + item.words.length
    }
  }
  for (const item of items)
    if (!placed.has(item.pc) && item.name !== 'JUMP') order.push(item)
  return order
}

function templateTrace(signature) {
  let pc = 0
  const items = signature.map(([name, ...operands]) => {
    const item = { name, pc, words: [null, ...operands] }
    pc += item.words.length
    return item
  })
  return helperTrace(items, null)
}

const EXPECTED_HELPER_TRACES = HELPER_SIGNATURES.map(templateTrace)

function decodeBank(value) {
  if (
    typeof value !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    decline('Bank is not base64')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value || bytes.length % 2 !== 0)
    decline('Bank is not canonical u16 LE base64')
  return bytes
}

function decodeSlice(bank, key, start, length) {
  if (
    !Number.isInteger(key) ||
    key < 1 ||
    key > 0xffffffff ||
    !Number.isInteger(start) ||
    start < 100 ||
    !Number.isInteger(length) ||
    length < 0 ||
    start + length > bank.length / 2 - 100
  )
    decline('Decode slice is outside the padded bank')
  let state = key
  let result = ''
  for (let index = 0; index < length; index += 1) {
    state = (state + 0x9e3779b9) | 0
    const mask = (state ^ (state >>> 13)) & 0xffff
    result += String.fromCharCode(
      (bank[2 * (start + index)] | (bank[2 * (start + index) + 1] << 8)) ^ mask,
    )
  }
  return result
}

function recognize(container, wordcode, references) {
  const instructions = wordcode.instructions
  const closures = instructions.filter((item) => item.name === 'MAKE_CLOSURE')
  const starts = [
    0,
    ...new Set(references.frame.descriptors.map((item) => item.startPc)),
  ].sort((a, b) => a - b)
  if (starts.length < 3) decline('String helper entries are absent')
  const inflateStart = starts.at(-2)
  const decodeStart = starts.at(-1)
  const pool = container.roles.pool.values
  for (const [start, end, expected] of [
    [inflateStart, decodeStart, EXPECTED_HELPER_TRACES[0]],
    [decodeStart, wordcode.wordCount, EXPECTED_HELPER_TRACES[1]],
  ]) {
    const observed = helperTrace(
      instructions.filter((item) => item.pc >= start && item.pc < end),
      pool,
      start,
    )
    if (JSON.stringify(observed) !== JSON.stringify(expected))
      decline(`Pinned helper body at ${start} changed`)
  }
  const inflateSites = closures.filter((item) => item.words[2] === inflateStart)
  const decodeSites = closures.filter((item) => item.words[2] === decodeStart)
  if (
    inflateSites.length !== 1 ||
    inflateSites[0].pc !== 0 ||
    inflateSites[0].functionMeta.paramCount !== 1 ||
    inflateSites[0].functionMeta.regCount < 12 ||
    inflateSites[0].functionMeta.captureCount !== 0 ||
    decodeSites.length === 0 ||
    decodeSites.some(
      (item) =>
        item.functionMeta.paramCount !== 4 ||
        item.functionMeta.regCount < 14 ||
        item.functionMeta.captureCount !== 0,
    )
  )
    decline('String helper closure sites changed')
  const program = executionOrder(
    instructions.filter((item) => item.pc < starts[1]),
    0,
  )
  const bankLoad = program[1]
  const bankCall = program[2]
  if (
    bankLoad?.name !== 'LOAD_CONST' ||
    bankLoad.words[3] !== 0 ||
    bankCall?.name !== 'CALL' ||
    bankCall.words.length !== 5 ||
    bankCall.words[2] !== inflateSites[0].words[1] ||
    bankCall.words[3] !== 1 ||
    bankCall.words[4] !== bankLoad.words[1]
  )
    decline('Program bank inflation prologue changed')
  const bank = decodeBank(pool[bankLoad.words[2]])
  const bankRegister = bankCall.words[1]
  const functionPlans = new Map()
  const removed = new Set([inflateSites[0].pc, bankLoad.pc, bankCall.pc])
  const replacements = new Map()
  const siteRunJumps = new Map()
  const specialRegisters = new Map()
  const parentByChild = new Map()
  const normalClosures = closures.filter(
    (item) => item.words[2] !== inflateStart && item.words[2] !== decodeStart,
  )
  for (const site of normalClosures) {
    const owner = starts.findLast((start) => start <= site.pc)
    const previous = parentByChild.get(site.words[2])
    if (previous !== undefined && previous !== owner)
      decline('User closure has ambiguous parents')
    parentByChild.set(site.words[2], owner)
  }
  const users = new Set()
  for (let index = 0; index < starts.length - 2; index += 1) {
    const start = starts[index]
    const end = starts[index + 1]
    const droppedBefore = new Map()
    const body = executionOrder(
      instructions.filter((item) => item.pc >= start && item.pc < end),
      start,
      droppedBefore,
    )
    const isRoot = index === 0
    let cursor = isRoot ? 3 : 0
    let localBank = isRoot ? bankRegister : null
    if (
      !isRoot &&
      body[0]?.name === 'LOAD_UPVALUE' &&
      body[1]?.name === 'MAKE_CLOSURE' &&
      body[1].words[2] === decodeStart
    ) {
      localBank = body[0].words[1]
      removed.add(body[0].pc)
      cursor = 1
    }
    const decoder = body[cursor]
    if (decoder?.name === 'MAKE_CLOSURE' && decoder.words[2] === decodeStart) {
      users.add(start)
      removed.add(decoder.pc)
      cursor += 1
      if (localBank === null) decline('Decoder has no inherited bank')
      const decoderRegister = decoder.words[1]
      const keyRegister = decoderRegister + 1
      const startRegister = decoderRegister + 2
      const lengthRegister = decoderRegister + 3
      specialRegisters.set(
        start,
        new Set([
          localBank,
          decoderRegister,
          keyRegister,
          startRegister,
          lengthRegister,
        ]),
      )
      let siteCount = 0
      for (let at = cursor; at < body.length; at += 1) {
        const item = body[at]
        if (item.name !== 'CALL' || item.words[2] !== decoderRegister) continue
        const triplet = body.slice(at - 3, at)
        if (
          triplet.length !== 3 ||
          triplet.some(
            (part, offset) =>
              part.name !== 'LOAD_INT' ||
              part.words[1] !==
                [keyRegister, startRegister, lengthRegister][offset],
          ) ||
          item.words.length !== 8 ||
          item.words[3] !== 4 ||
          item.words[4] !== localBank ||
          item.words[5] !== keyRegister ||
          item.words[6] !== startRegister ||
          item.words[7] !== lengthRegister
        )
          decline(`Decode call at ${item.pc} changed`)
        const plain = decodeSlice(
          bank,
          triplet[0].words[2],
          triplet[1].words[2],
          triplet[2].words[2],
        )
        const poolIndex = pool.length + replacements.size
        replacements.set(triplet[0].pc, {
          name: 'LOAD_CONST',
          words: [
            container.roles.op.values.LOAD_CONST,
            item.words[1],
            poolIndex,
            0,
          ],
          plain,
        })
        for (const part of [...triplet.slice(1), item]) {
          // A jump between two parts of this site (a flattened block split the site) is the
          // site's own fallthrough: after the collapse it continues after the call.
          for (const jump of droppedBefore.get(part.pc) ?? [])
            siteRunJumps.set(jump, item.pc + item.words.length)
        }
        for (const part of [...triplet.slice(1), item]) removed.add(part.pc)
        siteCount += 1
      }
      if (!siteCount) decline('Decoder closure has no string sites')
    } else if (localBank !== null && !isRoot) {
      decline('Bank upvalue has no decoder')
    }
    // The encoder emits the prologue (root: inflate closure, bank load, inflate call; a user: bank
    // upvalue load; then the decode closure) straight-line, so a jump into one of its parts (a
    // flattened block split the run) continues at the first instruction after it.
    for (const part of body.slice(0, cursor))
      for (const jump of droppedBefore.get(part.pc) ?? [])
        siteRunJumps.set(jump, body[cursor].pc)
    functionPlans.set(start, { start, end, body, isRoot, localBank })
  }
  if (decodeSites.length !== users.size)
    decline('Decoder prologue count changed')
  const need = new Set(users)
  for (const user of users) {
    let parent = parentByChild.get(user)
    while (parent !== undefined && !need.has(parent)) {
      need.add(parent)
      parent = parentByChild.get(parent)
    }
  }
  if (!need.has(0)) decline('String users are detached from the program')
  const closureReplacements = new Map()
  for (const site of normalClosures) {
    const child = site.words[2]
    if (!need.has(child)) continue
    const parent = parentByChild.get(child)
    const count = site.words[5]
    const source =
      parent === 0
        ? [1, bankRegister]
        : [0, closures.find((item) => item.words[2] === parent)?.words[5] - 1]
    if (
      count < 1 ||
      site.words.at(-2) !== source[0] ||
      site.words.at(-1) !== source[1]
    )
      decline(`Bank capture at ${site.pc} changed`)
    const raw = site.words.slice(0, -2)
    raw[5] -= 1
    closureReplacements.set(site.pc, raw)
  }
  for (const user of users) {
    if (user === 0) continue
    const plan = functionPlans.get(user)
    const descriptor = closures.find((item) => item.words[2] === user)
    if (!descriptor || plan.body[0].words[2] !== descriptor.words[5] - 1)
      decline(`Bank upvalue index in function ${user} changed`)
  }
  for (const plan of functionPlans.values()) {
    const special =
      specialRegisters.get(plan.start) ??
      (plan.isRoot
        ? new Set([bankRegister, inflateSites[0].words[1], bankLoad.words[1]])
        : new Set())
    if (plan.isRoot) {
      special.add(inflateSites[0].words[1])
      special.add(bankLoad.words[1])
      special.add(bankRegister)
    }
    for (const item of plan.body) {
      if (removed.has(item.pc) || replacements.has(item.pc)) continue
      const operands = item.operands.filter(
        (operand) => operand.kind === 'register',
      )
      if (operands.some((operand) => special.has(operand.index)))
        decline(`String helper register escapes at ${item.pc}`)
      if (
        item.name === 'MAKE_CLOSURE' &&
        item.captures.some(
          (capture, index) =>
            capture.kind === 'local' &&
            special.has(capture.index) &&
            !(
              closureReplacements.has(item.pc) &&
              index === item.captures.length - 1
            ),
        )
      )
        decline(`Bank capture escapes at ${item.pc}`)
    }
  }
  for (const item of instructions) {
    if (item.pc >= inflateStart) removed.add(item.pc)
  }
  const parts = []
  const pcMap = new Map()
  let nextPc = 0
  for (const item of instructions) {
    if (item.pc >= inflateStart) continue
    const replacement = replacements.get(item.pc)
    if (replacement) {
      pcMap.set(item.pc, nextPc)
      parts.push({ originPc: item.pc, pc: nextPc, ...replacement })
      nextPc += replacement.words.length
    } else if (removed.has(item.pc)) {
      if (starts.includes(item.pc)) pcMap.set(item.pc, nextPc)
    } else {
      pcMap.set(item.pc, nextPc)
      const words = closureReplacements.get(item.pc) ?? item.words.slice()
      parts.push({ originPc: item.pc, pc: nextPc, name: item.name, words })
      nextPc += words.length
    }
  }
  pcMap.set(wordcode.wordCount, nextPc)
  const remap = (pc, part) => {
    if (!pcMap.has(pc) && siteRunJumps.has(part.originPc))
      return remap(siteRunJumps.get(part.originPc), part)
    if (!pcMap.has(pc)) decline(`Target ${pc} was removed with string helpers`)
    return pcMap.get(pc)
  }
  const continuationLoads = selectContinuationLoads(
    parts.map((part) => ({
      key: part.pc,
      functionId: starts.findLast((start) => start <= part.originPc),
      name: part.name,
      words: part.words,
    })),
  )
  const words = parts.flatMap((part) => {
    const raw = part.words.slice()
    for (const offset of TARGET_OFFSETS[part.name] ?? [])
      raw[offset] = remap(raw[offset], part)
    if (continuationLoads.has(part.pc)) raw[2] = remap(raw[2], part)
    return raw
  })
  const normalized = structuredClone(container)
  normalized.roles.words.values = words
  for (const { plain } of replacements.values())
    normalized.roles.pool.values.push(plain)
  const afterB = diagnoseWordcode(normalized)
  if (!afterB.ok) decline(afterB.diagnostic.message)
  const afterC = diagnoseReferences(normalized, afterB.result)
  if (!afterC.ok) decline(afterC.diagnostic.message)
  const afterD = diagnoseFunctionPartition(
    normalized,
    afterB.result,
    afterC.result,
  )
  if (!afterD.ok) decline(afterD.diagnostic.message)
  return {
    schemaVersion: 'jsconfuser-vm-string-concealing-normalization.v1',
    container: normalized,
    wordcode: afterB.result,
    references: afterC.result,
    functions: afterD.result,
    pcMap,
    decodedCount: replacements.size,
    threadedFunctionCount: need.size - 1,
  }
}

export function diagnoseNormalizeStringConcealing(
  container,
  wordcode,
  references,
) {
  try {
    return {
      ok: true,
      result: recognize(container, wordcode, references),
      diagnostic: null,
    }
  } catch (error) {
    return {
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof StringConcealingDecline
            ? error.code
            : 'string-concealing-error',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
