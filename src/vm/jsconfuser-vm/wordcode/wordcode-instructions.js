import {
  FIXED_LAYOUTS,
  FIXED_WORD_WIDTHS,
  checkCount,
  checkPairCount,
  decline,
  fixedOperands,
  immediate,
  isWord,
  labelTarget,
  makeInstruction,
  register,
  spreadSentinel,
} from './wordcode-operands.js'

// Reads the word stream instruction by instruction (read-wordcode): a cursor over the words, one
// reader per variable-width form, and the added-opcode forms the recovery stages define.

export function makeCursor(words, names, startPc = 0) {
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
  if (!Object.hasOwn(FIXED_LAYOUTS, name))
    decline('unknown-opcode', `No width is defined for ${name}`)
  const raw = [cursor.read(name, 'opcode')]
  for (let i = 1; i < FIXED_WORD_WIDTHS[name]; i += 1)
    raw.push(cursor.read(name))
  const operands = fixedOperands(FIXED_LAYOUTS[name], raw)
  return makeInstruction(pc, { name, value }, raw, operands)
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
  return makeInstruction(pc, { name, value }, raw, operands, {
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
  return makeInstruction(pc, { name, value }, raw, operands, {
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
    { name, value },
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
    { name, value },
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

export function parseInstruction(
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

export function parseWords(
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
