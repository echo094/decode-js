const WORDCODE_SCHEMA = 'jsconfuser-vm-wordcode.v1'
const UINT32_MAX = 0xffffffff

const BINARY_REGISTER_OPCODES = new Set([
  'ADD',
  'SUB',
  'MUL',
  'DIV',
  'MOD',
  'EXP',
  'BAND',
  'BOR',
  'BXOR',
  'SHL',
  'SHR',
  'USHR',
  'LT',
  'GT',
  'LTE',
  'GTE',
  'EQ',
  'NEQ',
  'LOOSE_EQ',
  'LOOSE_NEQ',
  'IN',
  'INSTANCEOF',
])

const UNARY_REGISTER_OPCODES = new Set([
  'UNARY_NEG',
  'UNARY_POS',
  'UNARY_NOT',
  'UNARY_BITNOT',
  'TYPEOF',
  'VOID',
])

const THREE_REGISTER_OPCODES = new Set([
  'GET_PROP',
  'SET_PROP',
  'DELETE_PROP',
  'DEFINE_GETTER',
  'DEFINE_SETTER',
])

export const FIXED_WORD_WIDTHS = Object.freeze({
  LOAD_CONST: 4,
  LOAD_INT: 3,
  LOAD_GLOBAL: 4,
  LOAD_UPVALUE: 3,
  LOAD_THIS: 2,
  MOVE: 3,
  STORE_GLOBAL: 4,
  STORE_UPVALUE: 3,
  GET_PROP: 4,
  SET_PROP: 4,
  DELETE_PROP: 4,
  ADD: 4,
  SUB: 4,
  MUL: 4,
  DIV: 4,
  MOD: 4,
  EXP: 4,
  BAND: 4,
  BOR: 4,
  BXOR: 4,
  SHL: 4,
  SHR: 4,
  USHR: 4,
  LT: 4,
  GT: 4,
  LTE: 4,
  GTE: 4,
  EQ: 4,
  NEQ: 4,
  LOOSE_EQ: 4,
  LOOSE_NEQ: 4,
  IN: 4,
  INSTANCEOF: 4,
  UNARY_NEG: 3,
  UNARY_POS: 3,
  UNARY_NOT: 3,
  UNARY_BITNOT: 3,
  TYPEOF: 3,
  VOID: 3,
  TYPEOF_SAFE: 4,
  JUMP: 2,
  JUMP_IF_FALSE: 3,
  JUMP_IF_TRUE: 3,
  RETURN: 2,
  THROW: 2,
  DEFINE_GETTER: 4,
  DEFINE_SETTER: 4,
  FOR_IN_SETUP: 3,
  FOR_IN_NEXT: 4,
  TRY_SETUP: 3,
  TRY_END: 1,
  DEBUGGER: 1,
  JUMP_REG: 2,
  FINALLY_SETUP: 5,
})

// The decode's own opcode table (opcode-table.js) gives each word its operation, and its
// sentinel marks a spread argument count.
function opcodeNames(container) {
  const names = new Map(
    Object.entries(container.roles.op.values).map(([name, value]) => [
      value,
      name,
    ]),
  )
  names.sentinel = container.roles.sentinels.values.CALL_SPREAD
  return names
}

class WordcodeDecline extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WordcodeDecline'
    this.code = code
  }
}

function decline(code, message) {
  throw new WordcodeDecline(code, message)
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

function numericWords(container) {
  return container.roles.words.values
}

function isWord(value) {
  return Number.isInteger(value) && value >= 0 && value <= UINT32_MAX
}

function register(index) {
  return { kind: 'register', index }
}

function immediate(value) {
  return { kind: 'immediate', value }
}

function upvalueIndex(index) {
  return { kind: 'upvalue-index', index }
}

function labelTarget(value) {
  return { kind: 'label-target', pc: value }
}

function constantRef(index, key) {
  return { kind: 'constant-ref', index, concealKey: key }
}

function spreadSentinel(value) {
  return { kind: 'spread-sentinel', value }
}

function wordOperand(kind, value) {
  if (kind === 'register') return register(value)
  if (kind === 'label-target') return labelTarget(value)
  if (kind === 'constant-index') {
    return { kind, index: value }
  }
  if (kind === 'constant-key') {
    return { kind, value }
  }
  if (kind === 'capture-kind' || kind === 'capture-index') {
    return { kind, value }
  }
  if (kind === 'upvalue-index') {
    return upvalueIndex(value)
  }
  if (kind === 'spread-sentinel') return spreadSentinel(value)
  return immediate(value)
}

function wordOperands(name, words, spread) {
  const operands = words.slice(1)
  if (name === 'CALL' || name === 'NEW' || name === 'CALL_METHOD') {
    const method = name === 'CALL_METHOD'
    const argcOffset = method ? 3 : 2
    const firstArgumentOffset = method ? 4 : 3
    const argc = operands[argcOffset]
    const argumentWords = operands.slice(firstArgumentOffset)
    return [
      wordOperand('register', operands[0]),
      ...(method ? [wordOperand('register', operands[1])] : []),
      wordOperand('register', operands[method ? 2 : 1]),
      wordOperand(spread ? 'spread-sentinel' : 'immediate', argc),
      ...argumentWords.map((value) => wordOperand('register', value)),
    ]
  }
  if (name === 'MAKE_CLOSURE') {
    const result = [
      wordOperand('register', operands[0]),
      wordOperand('label-target', operands[1]),
      wordOperand('immediate', operands[2]),
      wordOperand('immediate', operands[3]),
      wordOperand('immediate', operands[4]),
      wordOperand('immediate', operands[5]),
    ]
    for (let index = 6; index < operands.length; index += 2) {
      result.push(
        wordOperand('capture-kind', operands[index]),
        wordOperand('capture-index', operands[index + 1]),
      )
    }
    return result
  }
  if (name === 'BUILD_ARRAY') {
    return [
      wordOperand('register', operands[0]),
      wordOperand('immediate', operands[1]),
      ...operands.slice(2).map((value) => wordOperand('register', value)),
    ]
  }
  if (name === 'BUILD_OBJECT') {
    const result = [
      wordOperand('register', operands[0]),
      wordOperand('immediate', operands[1]),
    ]
    for (let index = 2; index < operands.length; index += 2) {
      result.push(
        wordOperand('register', operands[index]),
        wordOperand('register', operands[index + 1]),
      )
    }
    return result
  }
  if (name === 'LOAD_CONST' || name === 'LOAD_GLOBAL') {
    return [
      wordOperand('register', operands[0]),
      wordOperand('constant-index', operands[1]),
      wordOperand('constant-key', operands[2]),
    ]
  }
  if (name === 'STORE_GLOBAL') {
    return [
      wordOperand('constant-index', operands[0]),
      wordOperand('constant-key', operands[1]),
      wordOperand('register', operands[2]),
    ]
  }
  if (
    name === 'JUMP' ||
    name === 'JUMP_IF_FALSE' ||
    name === 'JUMP_IF_TRUE' ||
    name === 'FOR_IN_NEXT' ||
    name === 'TRY_SETUP'
  ) {
    const labelOffset = name === 'JUMP' ? 0 : name === 'TRY_SETUP' ? 0 : 1
    return operands.map((value, index) =>
      wordOperand(index === labelOffset ? 'label-target' : 'register', value),
    )
  }
  if (name === 'FINALLY_SETUP') {
    return [
      wordOperand('label-target', operands[0]),
      wordOperand('register', operands[1]),
      wordOperand('register', operands[2]),
      wordOperand('label-target', operands[3]),
    ]
  }
  if (name === 'LOAD_INT') {
    return [wordOperand('register', operands[0]), immediate(operands[1])]
  }
  if (BINARY_REGISTER_OPCODES.has(name)) {
    return operands.map((value) => wordOperand('register', value))
  }
  if (UNARY_REGISTER_OPCODES.has(name)) {
    return operands.map((value) => wordOperand('register', value))
  }
  if (THREE_REGISTER_OPCODES.has(name)) {
    return operands.map((value) => wordOperand('register', value))
  }
  if (
    name === 'MOVE' ||
    name === 'LOAD_THIS' ||
    name === 'RETURN' ||
    name === 'THROW' ||
    name === 'JUMP_REG' ||
    name === 'FOR_IN_SETUP'
  ) {
    return operands.map((value) => wordOperand('register', value))
  }
  if (name === 'LOAD_UPVALUE') {
    return [wordOperand('register', operands[0]), upvalueIndex(operands[1])]
  }
  if (name === 'STORE_UPVALUE') {
    return [upvalueIndex(operands[0]), wordOperand('register', operands[1])]
  }
  if (name === 'TYPEOF_SAFE') {
    return [
      wordOperand('register', operands[0]),
      wordOperand('constant-index', operands[1]),
      wordOperand('constant-key', operands[2]),
    ]
  }
  if (name === 'DEBUGGER' || name === 'TRY_END') return []
  return operands.map((value) => wordOperand('immediate', value))
}

function makeInstruction(pc, name, value, words, operands, extra = {}) {
  return {
    pc,
    name,
    opcode: { name, value },
    operands,
    wordOperands: wordOperands(name, words, extra.form?.kind === 'spread'),
    words: words.slice(),
    width: words.length,
    nextPc: pc + words.length,
    ...extra,
  }
}

function checkCount(count, remaining, name, field, pc) {
  if (!Number.isSafeInteger(count) || count < 0) {
    decline('invalid-count', `${name} at ${pc} has an invalid ${field}`)
  }
  if (count > remaining) {
    decline(
      'truncated-instruction',
      `${name} at ${pc} is truncated in its ${field} payload`,
    )
  }
}

function checkPairCount(count, remaining, name, field, pc) {
  if (!Number.isSafeInteger(count) || count < 0) {
    decline('invalid-count', `${name} at ${pc} has an invalid ${field}`)
  }
  if (count > Math.floor(remaining / 2)) {
    decline(
      'truncated-instruction',
      `${name} at ${pc} is truncated in its ${field} pairs`,
    )
  }
}

function makeCursor(words, names, startPc = 0) {
  let pc = startPc
  let current = []
  return {
    names,
    sentinel: names.sentinel,
    get pc() {
      return pc
    },
    get remaining() {
      return words.length - pc
    },
    begin() {
      current = []
    },
    read(name, reason = 'operand') {
      if (pc >= words.length) {
        decline(
          'truncated-instruction',
          `${name} at ${pc - current.length} is missing a ${reason}`,
        )
      }
      const value = words[pc]
      if (!isWord(value)) {
        decline(
          'invalid-word',
          `Word at ${pc} is not an unsigned 32-bit integer`,
        )
      }
      pc += 1
      current.push(value)
      return value
    },
    takeCurrent() {
      return current.slice()
    },
  }
}

function fixedInstruction(cursor, pc, name, value) {
  const width = FIXED_WORD_WIDTHS[name]
  if (!width) decline('unknown-opcode', `No width is defined for ${name}`)
  const raw = [cursor.read(name, 'opcode')]
  for (let i = 1; i < width; i += 1) raw.push(cursor.read(name))
  const operands = []
  const registerOperands = (values) => values.map((item) => register(item))

  if (name === 'LOAD_CONST' || name === 'LOAD_GLOBAL') {
    operands.push(register(raw[1]), constantRef(raw[2], raw[3]))
  } else if (name === 'STORE_GLOBAL') {
    operands.push(constantRef(raw[1], raw[2]), register(raw[3]))
  } else if (name === 'TYPEOF_SAFE') {
    operands.push(register(raw[1]), constantRef(raw[2], raw[3]))
  } else if (name === 'LOAD_INT') {
    operands.push(register(raw[1]), immediate(raw[2]))
  } else if (name === 'LOAD_UPVALUE') {
    operands.push(register(raw[1]), upvalueIndex(raw[2]))
  } else if (name === 'STORE_UPVALUE') {
    operands.push(upvalueIndex(raw[1]), register(raw[2]))
  } else if (name === 'JUMP') {
    operands.push(labelTarget(raw[1]))
  } else if (name === 'JUMP_IF_FALSE' || name === 'JUMP_IF_TRUE') {
    operands.push(register(raw[1]), labelTarget(raw[2]))
  } else if (name === 'FOR_IN_NEXT') {
    operands.push(register(raw[1]), register(raw[2]), labelTarget(raw[3]))
  } else if (name === 'TRY_SETUP') {
    operands.push(labelTarget(raw[1]), register(raw[2]))
  } else if (name === 'FINALLY_SETUP') {
    operands.push(
      labelTarget(raw[1]),
      register(raw[2]),
      register(raw[3]),
      labelTarget(raw[4]),
    )
  } else if (BINARY_REGISTER_OPCODES.has(name)) {
    operands.push(...registerOperands(raw.slice(1)))
  } else if (UNARY_REGISTER_OPCODES.has(name)) {
    operands.push(...registerOperands(raw.slice(1)))
  } else if (THREE_REGISTER_OPCODES.has(name)) {
    operands.push(...registerOperands(raw.slice(1)))
  } else if (
    name === 'MOVE' ||
    name === 'LOAD_THIS' ||
    name === 'RETURN' ||
    name === 'THROW' ||
    name === 'JUMP_REG' ||
    name === 'FOR_IN_SETUP'
  ) {
    operands.push(...registerOperands(raw.slice(1)))
  }

  return makeInstruction(pc, name, value, raw, operands)
}

function readCall(cursor, pc, name, value) {
  const raw = [cursor.read(name, 'opcode')]
  const destination = cursor.read(name)
  const receiverOrCallee = cursor.read(name)
  const callee = name === 'CALL_METHOD' ? cursor.read(name) : receiverOrCallee
  const argc = cursor.read(name, 'argc')
  const fixedStart = name === 'CALL_METHOD' ? 5 : 4
  const spread = argc === cursor.sentinel
  let argumentRegisters
  if (spread) {
    argumentRegisters = [cursor.read(name, 'spread array register')]
  } else {
    checkCount(argc, cursor.remaining, name, 'argc', pc)
    argumentRegisters = []
    for (let index = 0; index < argc; index += 1) {
      argumentRegisters.push(cursor.read(name, `argument register ${index}`))
    }
  }
  raw.push(...cursor.takeCurrent().slice(raw.length))

  const argumentValue = spread
    ? {
        kind: 'spread',
        sentinel: cursor.sentinel,
        arrayRegister: register(argumentRegisters[0]),
      }
    : {
        kind: 'fixed',
        count: argc,
        registers: argumentRegisters.map((item) => register(item)),
      }
  const operands = [register(destination)]
  if (name === 'CALL_METHOD') operands.push(register(receiverOrCallee))
  operands.push(register(callee), spreadSentinel(argc))
  if (!spread) operands[operands.length - 1] = immediate(argc)
  operands.push(...(argumentValue.registers ?? [argumentValue.arrayRegister]))
  return makeInstruction(pc, name, value, raw, operands, {
    form: {
      kind: spread ? 'spread' : 'fixed',
      argc,
      sentinel: spread ? cursor.sentinel : null,
      arrayRegister: spread ? argumentValue.arrayRegister : null,
    },
    arguments: argumentValue,
    callee: register(callee),
    destination: register(destination),
    receiver: name === 'CALL_METHOD' ? register(receiverOrCallee) : null,
    serializedArgumentOffset: fixedStart,
  })
}

function readClosure(cursor, pc, name, value) {
  const raw = [cursor.read(name, 'opcode')]
  const destination = cursor.read(name)
  const startPc = cursor.read(name, 'function entry PC')
  const paramCount = cursor.read(name)
  const regCount = cursor.read(name)
  const captureCount = cursor.read(name, 'capture count')
  const hasRest = cursor.read(name, 'hasRest flag')
  if (hasRest !== 0 && hasRest !== 1) {
    decline(
      'invalid-descriptor',
      `${name} at ${pc} has an invalid hasRest flag`,
    )
  }
  checkPairCount(captureCount, cursor.remaining, name, 'capture count', pc)
  const captures = []
  for (let index = 0; index < captureCount; index += 1) {
    const isLocal = cursor.read(name, `capture ${index} kind`)
    const captureIndex = cursor.read(name, `capture ${index} index`)
    if (isLocal !== 0 && isLocal !== 1) {
      decline(
        'invalid-capture-pair',
        `${name} at ${pc} has an invalid capture kind at pair ${index}`,
      )
    }
    captures.push({
      kind: isLocal === 1 ? 'local' : 'upvalue',
      index: captureIndex,
      isLocal: isLocal === 1,
    })
  }
  raw.push(...cursor.takeCurrent().slice(raw.length))
  const functionMeta = {
    startPc,
    paramCount,
    regCount,
    captureCount,
    hasRest: hasRest === 1,
  }
  const operands = [
    register(destination),
    labelTarget(startPc),
    immediate(paramCount),
    immediate(regCount),
    immediate(captureCount),
    immediate(hasRest),
    ...captures,
  ]
  return makeInstruction(pc, name, value, raw, operands, {
    form: { kind: 'closure', ...functionMeta },
    functionMeta,
    captures,
    capturePairs: captures,
    destination: register(destination),
  })
}

function readArray(cursor, pc, name, value) {
  const raw = [cursor.read(name, 'opcode')]
  const destination = cursor.read(name)
  const count = cursor.read(name, 'element count')
  checkCount(count, cursor.remaining, name, 'element count', pc)
  const elements = []
  for (let index = 0; index < count; index += 1) {
    elements.push(cursor.read(name, `element register ${index}`))
  }
  raw.push(...cursor.takeCurrent().slice(raw.length))
  const elementRegisters = elements.map((item) => register(item))
  return makeInstruction(
    pc,
    name,
    value,
    raw,
    [register(destination), immediate(count), ...elementRegisters],
    {
      form: { kind: 'array', count, elementRegisters },
      count,
      destination: register(destination),
      elementRegisters,
    },
  )
}

function readObject(cursor, pc, name, value) {
  const raw = [cursor.read(name, 'opcode')]
  const destination = cursor.read(name)
  const pairCount = cursor.read(name, 'pair count')
  checkPairCount(pairCount, cursor.remaining, name, 'pair count', pc)
  const pairs = []
  for (let index = 0; index < pairCount; index += 1) {
    pairs.push({
      key: register(cursor.read(name, `key register ${index}`)),
      value: register(cursor.read(name, `value register ${index}`)),
    })
  }
  raw.push(...cursor.takeCurrent().slice(raw.length))
  return makeInstruction(
    pc,
    name,
    value,
    raw,
    [
      register(destination),
      immediate(pairCount),
      ...pairs.flatMap((pair) => [pair.key, pair.value]),
    ],
    {
      form: { kind: 'object', pairCount, pairs },
      pairCount,
      destination: register(destination),
      pairs,
    },
  )
}

function syntheticInstruction(cursor, pc, opcode, definition) {
  const raw = [cursor.read('SYNTHETIC', 'opcode')]
  for (let index = 0; index < definition.arity; index += 1) {
    raw.push(cursor.read('SYNTHETIC'))
  }
  const stored = raw.slice(1)
  const canonical = definition.canonicalToStored.map((index) => stored[index])
  return {
    pc,
    name: 'SYNTHETIC',
    opcode: { name: 'SYNTHETIC', value: opcode },
    words: raw,
    width: raw.length,
    nextPc: pc + raw.length,
    canonicalOperands: canonical,
    steps: definition.steps.map((step) => ({
      ...step,
      words: canonical.slice(
        step.operandStart,
        step.operandStart + step.operandCount,
      ),
    })),
  }
}

function macroInstruction(cursor, words, pc, opcode, definition) {
  const raw = [cursor.read('MACRO', 'opcode')]
  const steps = []
  for (const step of definition.steps) {
    const virtual = [step.opcode, ...words.slice(cursor.pc)]
    const parsed = parseInstruction(
      makeCursor(virtual, cursor.names),
      virtual,
      new Map(),
    )
    for (const expected of parsed.words.slice(1)) {
      const actual = cursor.read('MACRO')
      if (actual !== expected) {
        decline('macro-step-mismatch', 'Macro operand read changed')
      }
      raw.push(actual)
    }
    steps.push({ name: step.name, opcode: step.opcode, words: parsed.words })
  }
  return {
    pc,
    name: 'MACRO',
    opcode: { name: 'MACRO', value: opcode },
    words: raw,
    width: raw.length,
    nextPc: pc + raw.length,
    steps,
  }
}

function specializedInstruction(cursor, pc, opcode, definition) {
  const raw = [cursor.read('SPECIALIZED', 'opcode')]
  return {
    pc,
    name: 'SPECIALIZED',
    opcode: { name: 'SPECIALIZED', value: opcode },
    words: raw,
    width: 1,
    nextPc: pc + 1,
    steps: [
      {
        name: definition.originalName,
        opcode: definition.originalOpcode,
        words: [definition.originalOpcode, ...definition.operands],
      },
    ],
  }
}

function parseInstruction(
  cursor,
  words,
  syntheticCases,
  macroCases = new Map(),
  specializedCases = new Map(),
) {
  const pc = cursor.pc
  cursor.begin()
  const opcode = words[pc]
  if (!isWord(opcode)) {
    decline('invalid-word', `Word at ${pc} is not an unsigned 32-bit integer`)
  }
  const name = cursor.names.get(opcode)
  if (
    !name &&
    !syntheticCases.has(opcode) &&
    !macroCases.has(opcode) &&
    !specializedCases.has(opcode)
  ) {
    decline('unknown-opcode', `Unknown opcode ${opcode} at pc ${pc}`)
  }
  if (name === 'PATCH') {
    decline(
      'unsupported-hardening-opcode',
      `PATCH at pc ${pc} is hardening-only and outside Phase 1`,
    )
  }
  let instruction
  if (specializedCases.has(opcode)) {
    instruction = specializedInstruction(
      cursor,
      pc,
      opcode,
      specializedCases.get(opcode),
    )
  } else if (macroCases.has(opcode)) {
    instruction = macroInstruction(
      cursor,
      words,
      pc,
      opcode,
      macroCases.get(opcode),
    )
  } else if (!name) {
    instruction = syntheticInstruction(
      cursor,
      pc,
      opcode,
      syntheticCases.get(opcode),
    )
  } else if (name === 'CALL' || name === 'CALL_METHOD' || name === 'NEW') {
    instruction = readCall(cursor, pc, name, opcode)
  } else if (name === 'MAKE_CLOSURE') {
    instruction = readClosure(cursor, pc, name, opcode)
  } else if (name === 'BUILD_ARRAY') {
    instruction = readArray(cursor, pc, name, opcode)
  } else if (name === 'BUILD_OBJECT') {
    instruction = readObject(cursor, pc, name, opcode)
  } else {
    instruction = fixedInstruction(cursor, pc, name, opcode)
  }
  if (instruction.nextPc !== cursor.pc) {
    decline(
      'reader-internal-error',
      `${name ?? 'SYNTHETIC'} at ${pc} did not consume its declared width`,
    )
  }
  return instruction
}

function parseWords(
  words,
  names,
  syntheticCases = new Map(),
  macroCases = new Map(),
  specializedCases = new Map(),
) {
  const cursor = makeCursor(words, names)
  const instructions = []
  while (cursor.remaining > 0) {
    instructions.push(
      parseInstruction(
        cursor,
        words,
        syntheticCases,
        macroCases,
        specializedCases,
      ),
    )
  }
  if (cursor.pc !== words.length) {
    decline('trailing-word', 'Word stream was not consumed completely')
  }
  return instructions
}

export function diagnoseWordcodeInstruction(container, pc) {
  try {
    const words = numericWords(container)
    if (!Number.isSafeInteger(pc) || pc < 0 || pc >= words.length) {
      decline('invalid-pc', 'Instruction PC is outside the word stream')
    }
    const cursor = makeCursor(words, opcodeNames(container), pc)
    return deepFreeze({
      ok: true,
      result: parseInstruction(cursor, words, new Map()),
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof WordcodeDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'word-reader-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

// PATCH traversal reads only reached words, using the same source-proved added-opcode
// definitions as the complete stream readers. Original widths remain intact.
export function diagnoseObservedWordcodeInstruction(
  container,
  pc,
  addedOpcodes = {},
) {
  try {
    const words = numericWords(container)
    const antiCases = opcodeMap(addedOpcodes.anti?.syntheticCases ?? [])
    const aliasCases = opcodeMap(addedOpcodes.alias?.aliases ?? [])
    const cases = new Map(antiCases)
    for (const entry of aliasCases.values()) {
      cases.set(entry.opcode, {
        ...entry,
        steps: [
          {
            name: entry.originalName,
            operandStart: 0,
            operandCount: entry.arity,
          },
        ],
      })
    }
    const instruction = parseInstruction(
      makeCursor(words, opcodeNames(container), pc),
      words,
      cases,
      opcodeMap(addedOpcodes.macro?.macros ?? []),
      opcodeMap(addedOpcodes.specialized?.specialized ?? []),
    )
    const alias = aliasCases.get(instruction.opcode.value)
    if (alias) {
      instruction.name = 'ALIAS'
      instruction.steps = [
        {
          name: alias.originalName,
          words: [alias.originalOpcode, ...instruction.canonicalOperands],
        },
      ]
    }
    return deepFreeze({ ok: true, result: instruction, diagnostic: null })
  } catch (error) {
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof WordcodeDecline ? error.code : 'word-reader-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

// Runtime observers establish these definitions from source before stream parsing.
function opcodeMap(entries) {
  return new Map(entries.map((entry) => [entry.opcode, entry]))
}

export function diagnoseAntiWordStream(container, observation) {
  try {
    const words = numericWords(container)
    const cases = opcodeMap(observation.syntheticCases)
    const instructions = parseWords(words, opcodeNames(container), cases)
    if (!instructions.some(({ name }) => name === 'SYNTHETIC')) {
      decline(
        'no-synthetic-instructions',
        'The word stream has no synthetic opcode',
      )
    }
    return deepFreeze({
      ok: true,
      result: {
        schemaVersion: 'jsconfuser-vm-anti-word-stream-observation.v1',
        wordCount: words.length,
        instructions,
      },
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof WordcodeDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'anti-word-stream-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function diagnoseAliasedWordStream(
  container,
  observation,
  {
    antiObservation = null,
    specializedObservation = null,
    macroObservation = null,
  } = {},
) {
  try {
    const words = numericWords(container)
    const antiCases = antiObservation
      ? opcodeMap(antiObservation.syntheticCases)
      : new Map()
    const specializedCases = specializedObservation
      ? opcodeMap(specializedObservation.specialized)
      : new Map()
    const macroCases = macroObservation
      ? opcodeMap(macroObservation.macros)
      : new Map()
    const cases = new Map(antiCases)
    for (const entry of observation.aliases) {
      cases.set(entry.opcode, {
        ...entry,
        steps: [
          {
            name: entry.originalName,
            operandStart: 0,
            operandCount: entry.arity,
          },
        ],
      })
    }
    const instructions = parseWords(
      words,
      opcodeNames(container),
      cases,
      macroCases,
      specializedCases,
    )
    if (
      !instructions.some(
        ({ name, opcode }) =>
          name === 'SYNTHETIC' && !antiCases.has(opcode.value),
      )
    ) {
      decline('no-alias-instructions', 'The word stream has no alias opcode')
    }
    return deepFreeze({
      ok: true,
      result: {
        schemaVersion: 'jsconfuser-vm-aliased-word-stream-observation.v1',
        wordCount: words.length,
        instructions,
      },
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof WordcodeDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'aliased-word-stream-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function diagnoseMacroWordStream(
  container,
  observation,
  specializedObservation,
  antiObservation,
) {
  try {
    const words = numericWords(container)
    const antiCases = antiObservation
      ? opcodeMap(antiObservation.syntheticCases)
      : new Map()
    const specializedCases = specializedObservation
      ? opcodeMap(specializedObservation.specialized)
      : new Map()
    const cases = opcodeMap(observation.macros)
    const instructions = parseWords(
      words,
      opcodeNames(container),
      antiCases,
      cases,
      specializedCases,
    )
    if (!instructions.some(({ name }) => name === 'MACRO')) {
      decline('no-macro-instructions', 'The word stream has no macro opcode')
    }
    return deepFreeze({
      ok: true,
      result: {
        schemaVersion: 'jsconfuser-vm-macro-word-stream-observation.v1',
        wordCount: words.length,
        instructions,
      },
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof WordcodeDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'macro-word-stream-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function diagnoseSpecializedWordStream(
  container,
  observation,
  antiObservation,
) {
  try {
    const words = numericWords(container)
    const antiCases = antiObservation
      ? opcodeMap(antiObservation.syntheticCases)
      : new Map()
    const cases = opcodeMap(observation.specialized)
    const instructions = parseWords(
      words,
      opcodeNames(container),
      antiCases,
      new Map(),
      cases,
    )
    if (!instructions.some(({ name }) => name === 'SPECIALIZED')) {
      decline(
        'no-specialized-instructions',
        'The word stream has no specialized opcode',
      )
    }
    return deepFreeze({
      ok: true,
      result: {
        schemaVersion: 'jsconfuser-vm-specialized-word-stream-observation.v1',
        wordCount: words.length,
        instructions,
      },
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof WordcodeDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'specialized-word-stream-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function recognize(container) {
  const words = numericWords(container)
  const instructions = parseWords(words, opcodeNames(container))
  return deepFreeze({
    schemaVersion: WORDCODE_SCHEMA,
    encoding: 'numeric-u32',
    words: words.slice(),
    wordCount: words.length,
    instructions,
    instructionCount: instructions.length,
    consumedWords: words.length,
    nextPc: words.length,
  })
}

export function diagnoseWordcode(container) {
  try {
    const result = recognize(container)
    return deepFreeze({ ok: true, result, diagnostic: null })
  } catch (error) {
    if (error instanceof WordcodeDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'word-reader-error',
        message: error.message,
      },
    })
  }
}

export function readWordcode(container) {
  return diagnoseWordcode(container).result
}

export default readWordcode
