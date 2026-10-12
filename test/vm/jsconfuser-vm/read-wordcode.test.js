import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import {
  diagnoseWordcode,
  readWordcode,
} from '../../../src/vm/jsconfuser-vm/read-wordcode.js'

const repositoryRoot = new URL('../../../', import.meta.url)

function sourceAt(relativePath) {
  return fs.readFileSync(new URL(relativePath, repositoryRoot), 'utf8')
}

function containerAt(relativePath) {
  const container = extractContainerFromSource(sourceAt(relativePath))
  expect(container, `Packet A declined ${relativePath}`).not.toBeNull()
  return container
}

function withWords(container, words) {
  const copy = structuredClone(container)
  copy.roles.words.values = [...words]
  return copy
}

function deepFrozen(value) {
  if (!value || typeof value !== 'object') return true
  return (
    Object.isFrozen(value) &&
    Object.values(value).every((child) => deepFrozen(child))
  )
}

function instructionsAt(relativePath) {
  const result = readWordcode(containerAt(relativePath))
  expect(result).not.toBeNull()
  return result.instructions
}

test('parses the reference stream with exact PCs and complete consumption', () => {
  const container = containerAt(
    'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
  )
  const result = readWordcode(container)

  expect(result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-wordcode.v1',
    encoding: 'numeric-u32',
    wordCount: 32,
    instructionCount: 9,
    consumedWords: 32,
    nextPc: 32,
  })
  expect(result.instructions.map(({ name }) => name)).toEqual([
    'LOAD_THIS',
    'LOAD_GLOBAL',
    'LOAD_CONST',
    'LOAD_CONST',
    'LOAD_CONST',
    'ADD',
    'SET_PROP',
    'LOAD_CONST',
    'RETURN',
  ])
  expect(
    result.instructions.every(
      (instruction) =>
        instruction.nextPc === instruction.pc + instruction.width,
    ),
  ).toBe(true)
  expect(result.instructions.at(-1).nextPc).toBe(result.wordCount)
  expect(deepFrozen(result)).toBe(true)
})

test('detector-first assertions prove every target-local variable form is observed', () => {
  const targetCases = [
    [
      'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-store-global-assignment/encoded.js',
      'STORE_GLOBAL',
    ],
    [
      'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-unary-positive-coercion/encoded.js',
      'UNARY_POS',
    ],
    [
      'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
      'CALL_METHOD',
    ],
    [
      'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-new-spread/encoded.js',
      'NEW',
    ],
    [
      'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-spread-order/encoded.js',
      'CALL',
    ],
    [
      'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-closures-state/encoded.js',
      'MAKE_CLOSURE',
    ],
  ]

  for (const [path, opcode] of targetCases) {
    const target = instructionsAt(path).filter(({ name }) => name === opcode)
    expect(target.length, `${path} detector`).toBeGreaterThan(0)
  }
})

test('parses fixed and spread forms for CALL, CALL_METHOD, and NEW', () => {
  const callInstructions = instructionsAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-spread-order/encoded.js',
  )
  const methodInstructions = instructionsAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
  )
  const newInstructions = instructionsAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-new-spread/encoded.js',
  )
  const fixedCall = instructionsAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-arrow-forms/encoded.js',
  ).find(({ name }) => name === 'CALL')
  const fixedMethod = methodInstructions.find(
    ({ name, form }) => name === 'CALL_METHOD' && form?.kind === 'fixed',
  )
  const fixedNew = instructionsAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-for-in-enumeration/encoded.js',
  ).find(({ name }) => name === 'NEW')
  const spreadCall = callInstructions.find(
    ({ name, form }) => name === 'CALL' && form?.kind === 'spread',
  )
  const spreadMethod = methodInstructions.find(
    ({ form }) => form?.kind === 'spread',
  )
  const spreadNew = newInstructions.find(({ form }) => form?.kind === 'spread')

  expect(fixedCall).toMatchObject({
    form: { kind: 'fixed', argc: 0, sentinel: null },
    arguments: { kind: 'fixed', count: 0, registers: [] },
  })
  expect(fixedMethod).toMatchObject({
    form: { kind: 'fixed', argc: 1, sentinel: null },
    arguments: { kind: 'fixed', count: 1 },
  })
  expect(fixedNew).toMatchObject({
    form: { kind: 'fixed', argc: 0, sentinel: null },
    arguments: { kind: 'fixed', count: 0, registers: [] },
  })
  expect(spreadCall).toMatchObject({
    words: [42, 8, 2, 65535, 7],
    width: 5,
    nextPc: 142,
    form: {
      kind: 'spread',
      argc: 65535,
      sentinel: 65535,
      arrayRegister: { kind: 'register', index: 7 },
    },
    arguments: {
      kind: 'spread',
      sentinel: 65535,
      arrayRegister: { kind: 'register', index: 7 },
    },
  })
  expect(spreadMethod).toMatchObject({
    words: [43, 4, 2, 5, 65535, 6],
    width: 6,
    form: {
      kind: 'spread',
      arrayRegister: { kind: 'register', index: 6 },
    },
  })
  expect(spreadNew).toMatchObject({
    words: [44, 5, 2, 65535, 6],
    width: 5,
    form: {
      kind: 'spread',
      arrayRegister: { kind: 'register', index: 6 },
    },
  })
})

test('retains typed closure, collection, zero-width, and EXP records', () => {
  const closure = instructionsAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-closures-state/encoded.js',
  ).find(({ captures }) => captures?.length > 0)
  expect(closure).toMatchObject({
    name: 'MAKE_CLOSURE',
    width: 9,
    functionMeta: {
      startPc: 81,
      paramCount: 0,
      regCount: 5,
      captureCount: 1,
      hasRest: false,
    },
    captures: [{ kind: 'local', index: 2, isLocal: true }],
  })

  const focusedNew = instructionsAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-new-spread/encoded.js',
  )
  expect(focusedNew.find(({ name }) => name === 'BUILD_ARRAY')).toMatchObject({
    form: { kind: 'array', count: 2 },
    elementRegisters: [
      { kind: 'register', index: 5 },
      { kind: 'register', index: 6 },
    ],
  })
  expect(
    instructionsAt(
      'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-literals-order/encoded.js',
    ).find(({ name, pairCount }) => name === 'BUILD_OBJECT' && pairCount === 2),
  ).toMatchObject({
    form: { kind: 'object', pairCount: 2 },
    pairs: [
      {
        key: { kind: 'register', index: 19 },
        value: { kind: 'register', index: 20 },
      },
      {
        key: { kind: 'register', index: 21 },
        value: { kind: 'register', index: 23 },
      },
    ],
  })

  const finallyInstructions = instructionsAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-finally-abrupt/encoded.js',
  )
  expect(
    finallyInstructions.find(({ name }) => name === 'TRY_END'),
  ).toMatchObject({
    name: 'TRY_END',
    operands: [],
    width: 1,
  })
  expect(
    instructionsAt(
      'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-debugger-order/encoded.js',
    ).find(({ name }) => name === 'DEBUGGER'),
  ).toMatchObject({
    name: 'DEBUGGER',
    operands: [],
    width: 1,
  })
  const exp = instructionsAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-expression-values/encoded.js',
  ).find(({ name }) => name === 'EXP')
  expect(exp).toMatchObject({
    name: 'EXP',
    opcode: { name: 'EXP', value: 60 },
    operands: [
      { kind: 'register' },
      { kind: 'register' },
      { kind: 'register' },
    ],
    width: 4,
  })
})

test.each([
  ['fixed operand', [4], 'truncated-instruction'],
  ['spread call array register', [42, 0, 1, 65535], 'truncated-instruction'],
  ['closure capture pair', [47, 0, 0, 0, 0, 1, 0, 1], 'truncated-instruction'],
  ['array count payload', [48, 0, 2, 0], 'truncated-instruction'],
  ['object count payload', [49, 0, 1, 0], 'truncated-instruction'],
])(
  'declines truncated %s before returning partial records',
  (_label, words, code) => {
    const container = containerAt(
      'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
    )
    const report = diagnoseWordcode(withWords(container, words))

    expect(report.ok).toBe(false)
    expect(report.result).toBeNull()
    expect(report.diagnostic.code).toBe(code)
  },
)

test('declines unknown, extra/trailing, and hardening words', () => {
  const container = containerAt(
    'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
  )
  const words = container.roles.words.values

  expect(diagnoseWordcode(withWords(container, [61])).diagnostic.code).toBe(
    'unknown-opcode',
  )
  expect(
    diagnoseWordcode(withWords(container, [...words, 61])).diagnostic.code,
  ).toBe('unknown-opcode')
  expect(diagnoseWordcode(withWords(container, [56])).diagnostic.code).toBe(
    'unsupported-hardening-opcode',
  )
})

test('preserves the container input and freezes the parsed wordcode', () => {
  const container = containerAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
  )
  const before = JSON.stringify(container)
  const result = readWordcode(container)

  expect(JSON.stringify(container)).toBe(before)
  expect(result.words).not.toBe(container.roles.words.values)
  expect(deepFrozen(result)).toBe(true)
  expect(() => result.words.push(1)).toThrow()
  expect(() => (result.instructions[0].pc = 99)).toThrow()
})

test('parses the stripped numeric raw and focused corpus without comments or target execution', () => {
  const roots = [
    'test/vm/jsconfuser-vm/fixtures/corpus/raw',
    'test/vm/jsconfuser-vm/fixtures/corpus/focused',
  ]
  let cellCount = 0
  for (const root of roots) {
    const rootUrl = new URL(`${root}/`, repositoryRoot)
    for (const entry of fs.readdirSync(rootUrl).sort()) {
      const entryUrl = new URL(entry, rootUrl)
      if (!fs.statSync(entryUrl).isDirectory()) continue
      const cell = new URL(`${entry}/`, rootUrl)
      const encoded = new URL('encoded.js', cell)
      if (!fs.existsSync(encoded)) continue
      const result = readWordcode(
        extractContainerFromSource(fs.readFileSync(encoded, 'utf8')),
      )
      expect(result, `${root}/${entry}`).not.toBeNull()
      expect(result.consumedWords).toBe(result.wordCount)
      expect(result.instructions.at(-1).nextPc).toBe(result.wordCount)
      cellCount += 1
    }
  }
  expect(cellCount).toBe(37)
})
