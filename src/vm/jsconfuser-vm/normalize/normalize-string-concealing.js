import { declines } from '../../decline.js'
import { selectContinuationLoads } from '../wordcode/finally-continuations.js'
import {
  EXPECTED_HELPER_TRACES,
  HelperTracer,
} from './string-concealing-helper-trace.js'
import { diagnoseWordcode } from '../wordcode/read-wordcode.js'
import { diagnoseReferences } from '../wordcode/validate-references.js'
import { diagnoseFunctionPartition } from '../wordcode/partition-functions.js'
import { LABEL_WORD_OFFSETS } from '../wordcode/wordcode-operands.js'

const { decline: refuse, accepted, refused } = declines('string-concealing')
const decline = (message) => refuse('string-concealing-shape', message)

// The direct targets a walk continues at: every label operand except a closure's entry.
function jumpTargets(item) {
  if (item.name === 'MAKE_CLOSURE') return []
  return (LABEL_WORD_OFFSETS[item.name] ?? []).map(
    (offset) => item.words[offset],
  )
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
      pending.push(...jumpTargets(item))
      if (continuationLoads.has(item.pc)) pending.push(item.words[2])
      if (['RETURN', 'THROW', 'JUMP_REG'].includes(item.name)) break
      pc = item.pc + item.words.length
    }
  }
  for (const item of items)
    if (!placed.has(item.pc) && item.name !== 'JUMP') order.push(item)
  return order
}

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
  return new StringConcealing(container, wordcode, references).normalize()
}

/**
 * The string inverse over one stream: the inflate and decode helpers are the last two functions,
 * the program inflates the bank once, and each user function captures it and calls its own decode
 * closure per string site. Each step declines on any change to that shape; `removed` and
 * `replacements` (site PC -> the constant load written there) fill as the functions are read.
 */
class StringConcealing {
  constructor(container, wordcode, references) {
    this.container = container
    this.wordcode = wordcode
    this.instructions = wordcode.instructions
    this.closures = this.instructions.filter(
      (item) => item.name === 'MAKE_CLOSURE',
    )
    this.starts = [
      0,
      ...new Set(references.frame.descriptors.map((item) => item.startPc)),
    ].sort((a, b) => a - b)
    if (this.starts.length < 3) decline('String helper entries are absent')
    this.inflateStart = this.starts.at(-2)
    this.decodeStart = this.starts.at(-1)
    this.pool = container.roles.pool.values
    this.replacements = new Map()
    this.siteRunJumps = new Map()
    this.specialRegisters = new Map()
    this.functionPlans = new Map()
    this.users = new Set()
  }

  sitesOf(start) {
    return this.closures.filter((item) => item.words[2] === start)
  }

  // Both helper bodies match the pinned templates.
  checkHelperBodies() {
    for (const [start, end, expected] of [
      [this.inflateStart, this.decodeStart, EXPECTED_HELPER_TRACES[0]],
      [this.decodeStart, this.wordcode.wordCount, EXPECTED_HELPER_TRACES[1]],
    ]) {
      const observed = new HelperTracer(
        this.instructions.filter((item) => item.pc >= start && item.pc < end),
        this.pool,
        start,
      ).trace()
      if (JSON.stringify(observed) !== JSON.stringify(expected))
        decline(`Pinned helper body at ${start} changed`)
    }
  }

  // One inflate closure at the program's start; every decode closure takes the four decode
  // parameters; neither captures.
  checkHelperSites() {
    const inflateSites = this.sitesOf(this.inflateStart)
    this.decodeSites = this.sitesOf(this.decodeStart)
    const [inflate] = inflateSites
    if (
      inflateSites.length !== 1 ||
      inflate.pc !== 0 ||
      inflate.functionMeta.paramCount !== 1 ||
      inflate.functionMeta.regCount < 12 ||
      inflate.functionMeta.captureCount !== 0 ||
      this.decodeSites.length === 0 ||
      this.decodeSites.some(
        (item) =>
          item.functionMeta.paramCount !== 4 ||
          item.functionMeta.regCount < 14 ||
          item.functionMeta.captureCount !== 0,
      )
    )
      decline('String helper closure sites changed')
    this.inflateSite = inflate
  }

  // The program's prologue: the bank constant loaded and inflated by the inflate closure.
  readBankPrologue() {
    const program = executionOrder(
      this.instructions.filter((item) => item.pc < this.starts[1]),
      0,
    )
    const [, bankLoad, bankCall] = program
    if (
      bankLoad?.name !== 'LOAD_CONST' ||
      bankLoad.words[3] !== 0 ||
      bankCall?.name !== 'CALL' ||
      bankCall.words.length !== 5 ||
      bankCall.words[2] !== this.inflateSite.words[1] ||
      bankCall.words[3] !== 1 ||
      bankCall.words[4] !== bankLoad.words[1]
    )
      decline('Program bank inflation prologue changed')
    this.bankLoad = bankLoad
    this.bank = decodeBank(this.pool[bankLoad.words[2]])
    this.bankRegister = bankCall.words[1]
    this.removed = new Set([this.inflateSite.pc, bankLoad.pc, bankCall.pc])
  }

  // Each user function's one parent: the function holding its closure site.
  readParents() {
    this.normalClosures = this.closures.filter(
      (item) =>
        item.words[2] !== this.inflateStart &&
        item.words[2] !== this.decodeStart,
    )
    this.parentByChild = new Map()
    for (const site of this.normalClosures) {
      const owner = this.starts.findLast((start) => start <= site.pc)
      const previous = this.parentByChild.get(site.words[2])
      if (previous !== undefined && previous !== owner)
        decline('User closure has ambiguous parents')
      this.parentByChild.set(site.words[2], owner)
    }
  }

  // A function's prologue before its decode closure: the root's bank inflation, or a user's bank
  // upvalue load. Returns where the decode closure would start and the bank register.
  readUserPrologue(body, isRoot) {
    if (isRoot) return { cursor: 3, localBank: this.bankRegister }
    if (
      body[0]?.name === 'LOAD_UPVALUE' &&
      body[1]?.name === 'MAKE_CLOSURE' &&
      body[1].words[2] === this.decodeStart
    ) {
      this.removed.add(body[0].pc)
      return { cursor: 1, localBank: body[0].words[1] }
    }
    return { cursor: 0, localBank: null }
  }

  // One decode call site: `key, start, length` loaded into the decode closure's argument
  // registers, then the call; it becomes a load of the decoded string as a new constant.
  rewriteSite(body, at, registers, droppedBefore) {
    const item = body[at]
    const { localBank, keyRegister, startRegister, lengthRegister } = registers
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
      this.bank,
      triplet[0].words[2],
      triplet[1].words[2],
      triplet[2].words[2],
    )
    const poolIndex = this.pool.length + this.replacements.size
    this.replacements.set(triplet[0].pc, {
      name: 'LOAD_CONST',
      words: [
        this.container.roles.op.values.LOAD_CONST,
        item.words[1],
        poolIndex,
        0,
      ],
      plain,
    })
    const rest = [...triplet.slice(1), item]
    // A jump between two parts of this site (a flattened block split the site) is the site's
    // own fallthrough: after the collapse it continues after the call.
    for (const part of rest)
      for (const jump of droppedBefore.get(part.pc) ?? [])
        this.siteRunJumps.set(jump, item.pc + item.words.length)
    for (const part of rest) this.removed.add(part.pc)
  }

  // A user function's decode closure and every string site that calls it.
  rewriteUser(start, body, cursor, localBank, droppedBefore) {
    const decoder = body[cursor]
    this.users.add(start)
    this.removed.add(decoder.pc)
    if (localBank === null) decline('Decoder has no inherited bank')
    const decoderRegister = decoder.words[1]
    const registers = {
      localBank,
      keyRegister: decoderRegister + 1,
      startRegister: decoderRegister + 2,
      lengthRegister: decoderRegister + 3,
    }
    this.specialRegisters.set(
      start,
      new Set([
        localBank,
        decoderRegister,
        registers.keyRegister,
        registers.startRegister,
        registers.lengthRegister,
      ]),
    )
    let siteCount = 0
    for (let at = cursor + 1; at < body.length; at += 1) {
      const item = body[at]
      if (item.name !== 'CALL' || item.words[2] !== decoderRegister) continue
      this.rewriteSite(body, at, registers, droppedBefore)
      siteCount += 1
    }
    if (!siteCount) decline('Decoder closure has no string sites')
    return cursor + 1
  }

  planFunction(index) {
    const start = this.starts[index]
    const end = this.starts[index + 1]
    const droppedBefore = new Map()
    const body = executionOrder(
      this.instructions.filter((item) => item.pc >= start && item.pc < end),
      start,
      droppedBefore,
    )
    const isRoot = index === 0
    let { cursor, localBank } = this.readUserPrologue(body, isRoot)
    const decoder = body[cursor]
    if (
      decoder?.name === 'MAKE_CLOSURE' &&
      decoder.words[2] === this.decodeStart
    )
      cursor = this.rewriteUser(start, body, cursor, localBank, droppedBefore)
    else if (localBank !== null && !isRoot)
      decline('Bank upvalue has no decoder')
    // The encoder emits the prologue (root: inflate closure, bank load, inflate call; a user: bank
    // upvalue load; then the decode closure) straight-line, so a jump into one of its parts (a
    // flattened block split the run) continues at the first instruction after it.
    for (const part of body.slice(0, cursor))
      for (const jump of droppedBefore.get(part.pc) ?? [])
        this.siteRunJumps.set(jump, body[cursor].pc)
    this.functionPlans.set(start, { start, end, body, isRoot, localBank })
  }

  // The functions the bank threads through: every user and each parent up to the program.
  threadedFunctions() {
    if (this.decodeSites.length !== this.users.size)
      decline('Decoder prologue count changed')
    const need = new Set(this.users)
    for (const user of this.users) {
      let parent = this.parentByChild.get(user)
      while (parent !== undefined && !need.has(parent)) {
        need.add(parent)
        parent = this.parentByChild.get(parent)
      }
    }
    if (!need.has(0)) decline('String users are detached from the program')
    return need
  }

  // Each threaded closure site loses its last capture, the bank: from the program's register, or
  // from the parent's own bank upvalue.
  bankCaptureReplacements(need) {
    const closureReplacements = new Map()
    for (const site of this.normalClosures) {
      const child = site.words[2]
      if (!need.has(child)) continue
      const parent = this.parentByChild.get(child)
      const count = site.words[5]
      const source =
        parent === 0
          ? [1, this.bankRegister]
          : [
              0,
              this.closures.find((item) => item.words[2] === parent)?.words[5] -
                1,
            ]
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
    return closureReplacements
  }

  // A user's bank upvalue is the last capture its closure site passes.
  checkBankUpvalues() {
    for (const user of this.users) {
      if (user === 0) continue
      const plan = this.functionPlans.get(user)
      const descriptor = this.closures.find((item) => item.words[2] === user)
      if (!descriptor || plan.body[0].words[2] !== descriptor.words[5] - 1)
        decline(`Bank upvalue index in function ${user} changed`)
    }
  }

  // No kept instruction reads a helper register, and no closure captures one other than the bank
  // capture that is removed.
  checkHelperRegisters(closureReplacements) {
    for (const plan of this.functionPlans.values()) {
      const special = new Set(this.specialRegisters.get(plan.start) ?? [])
      if (plan.isRoot)
        for (const register of [
          this.inflateSite.words[1],
          this.bankLoad.words[1],
          this.bankRegister,
        ])
          special.add(register)
      for (const item of plan.body) {
        if (this.removed.has(item.pc) || this.replacements.has(item.pc))
          continue
        if (
          item.operands.some(
            (operand) =>
              operand.kind === 'register' && special.has(operand.index),
          )
        )
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
  }

  // The kept words at their new PCs, every target remapped; a jump into a removed site run
  // continues where the run does.
  relocate(closureReplacements) {
    for (const item of this.instructions)
      if (item.pc >= this.inflateStart) this.removed.add(item.pc)
    const parts = []
    const pcMap = new Map()
    let nextPc = 0
    for (const item of this.instructions) {
      if (item.pc >= this.inflateStart) continue
      const replacement = this.replacements.get(item.pc)
      if (replacement) {
        pcMap.set(item.pc, nextPc)
        parts.push({ originPc: item.pc, pc: nextPc, ...replacement })
        nextPc += replacement.words.length
      } else if (this.removed.has(item.pc)) {
        if (this.starts.includes(item.pc)) pcMap.set(item.pc, nextPc)
      } else {
        pcMap.set(item.pc, nextPc)
        const words = closureReplacements.get(item.pc) ?? item.words.slice()
        parts.push({ originPc: item.pc, pc: nextPc, name: item.name, words })
        nextPc += words.length
      }
    }
    pcMap.set(this.wordcode.wordCount, nextPc)
    const remap = (pc, part) => {
      if (!pcMap.has(pc) && this.siteRunJumps.has(part.originPc))
        return remap(this.siteRunJumps.get(part.originPc), part)
      if (!pcMap.has(pc))
        decline(`Target ${pc} was removed with string helpers`)
      return pcMap.get(pc)
    }
    const continuationLoads = selectContinuationLoads(
      parts.map((part) => ({
        key: part.pc,
        functionId: this.starts.findLast((start) => start <= part.originPc),
        name: part.name,
        words: part.words,
      })),
    )
    const words = parts.flatMap((part) => {
      const raw = part.words.slice()
      for (const offset of LABEL_WORD_OFFSETS[part.name] ?? [])
        raw[offset] = remap(raw[offset], part)
      if (continuationLoads.has(part.pc)) raw[2] = remap(raw[2], part)
      return raw
    })
    return { words, pcMap }
  }

  // The rewritten container with the decoded strings appended to the pool, and its read-program
  // records rebuilt.
  rebuild(words) {
    const normalized = structuredClone(this.container)
    normalized.roles.words.values = words
    for (const { plain } of this.replacements.values())
      normalized.roles.pool.values.push(plain)
    const read = diagnoseWordcode(normalized)
    if (!read.ok) decline(read.diagnostic.message)
    const references = diagnoseReferences(normalized, read.result)
    if (!references.ok) decline(references.diagnostic.message)
    const functions = diagnoseFunctionPartition(
      normalized,
      read.result,
      references.result,
    )
    if (!functions.ok) decline(functions.diagnostic.message)
    return {
      container: normalized,
      wordcode: read.result,
      references: references.result,
      functions: functions.result,
    }
  }

  normalize() {
    this.checkHelperBodies()
    this.checkHelperSites()
    this.readBankPrologue()
    this.readParents()
    for (let index = 0; index < this.starts.length - 2; index += 1)
      this.planFunction(index)
    const need = this.threadedFunctions()
    const closureReplacements = this.bankCaptureReplacements(need)
    this.checkBankUpvalues()
    this.checkHelperRegisters(closureReplacements)
    const { words, pcMap } = this.relocate(closureReplacements)
    return {
      schemaVersion: 'jsconfuser-vm-string-concealing-normalization.v1',
      ...this.rebuild(words),
      pcMap,
      decodedCount: this.replacements.size,
      threadedFunctionCount: need.size - 1,
    }
  }
}

export function diagnoseNormalizeStringConcealing(
  container,
  wordcode,
  references,
) {
  try {
    return accepted(recognize(container, wordcode, references), {
      fallback: 'string-concealing-error',
    })
  } catch (error) {
    return refused(error, {
      fallback: 'string-concealing-error',
    })
  }
}
