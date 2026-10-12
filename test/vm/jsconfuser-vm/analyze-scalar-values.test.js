import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { buildControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { diagnoseScalarValues } from '../../../src/vm/jsconfuser-vm/analyze-scalar-values.js'

const repositoryRoot = new URL('../../../', import.meta.url)

const scalarNames = [
  'LOAD_CONST',
  'LOAD_INT',
  'LOAD_GLOBAL',
  'MOVE',
  'STORE_GLOBAL',
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
  'UNARY_NEG',
  'UNARY_POS',
  'UNARY_NOT',
  'UNARY_BITNOT',
  'TYPEOF',
  'VOID',
  'TYPEOF_SAFE',
]

const operandKinds = {
  LOAD_CONST: ['register', 'constant-ref'],
  LOAD_INT: ['register', 'immediate'],
  LOAD_GLOBAL: ['register', 'constant-ref'],
  MOVE: ['register', 'register'],
  STORE_GLOBAL: ['constant-ref', 'register'],
  ADD: ['register', 'register', 'register'],
  SUB: ['register', 'register', 'register'],
  MUL: ['register', 'register', 'register'],
  DIV: ['register', 'register', 'register'],
  MOD: ['register', 'register', 'register'],
  EXP: ['register', 'register', 'register'],
  BAND: ['register', 'register', 'register'],
  BOR: ['register', 'register', 'register'],
  BXOR: ['register', 'register', 'register'],
  SHL: ['register', 'register', 'register'],
  SHR: ['register', 'register', 'register'],
  USHR: ['register', 'register', 'register'],
  LT: ['register', 'register', 'register'],
  GT: ['register', 'register', 'register'],
  LTE: ['register', 'register', 'register'],
  GTE: ['register', 'register', 'register'],
  EQ: ['register', 'register', 'register'],
  NEQ: ['register', 'register', 'register'],
  LOOSE_EQ: ['register', 'register', 'register'],
  LOOSE_NEQ: ['register', 'register', 'register'],
  UNARY_NEG: ['register', 'register'],
  UNARY_POS: ['register', 'register'],
  UNARY_NOT: ['register', 'register'],
  UNARY_BITNOT: ['register', 'register'],
  TYPEOF: ['register', 'register'],
  VOID: ['register', 'register'],
  TYPEOF_SAFE: ['register', 'constant-ref'],
}

function sourceAt(relativePath) {
  return fs.readFileSync(new URL(relativePath, repositoryRoot), 'utf8')
}

function packetAt(relativePath) {
  const container = extractContainerFromSource(sourceAt(relativePath))
  expect(container, `Packet A declined ${relativePath}`).not.toBeNull()
  const wordcode = readWordcode(container)
  expect(wordcode, `Packet B declined ${relativePath}`).not.toBeNull()
  const references = validateReferences(container, wordcode)
  expect(references, `Packet C declined ${relativePath}`).not.toBeNull()
  const functions = partitionFunctions(container, wordcode, references)
  expect(functions, `Packet D declined ${relativePath}`).not.toBeNull()
  const cfg = buildControlFlow(wordcode, references, functions)
  expect(cfg, `Packet E declined ${relativePath}`).not.toBeNull()
  return { wordcode, references, functions, cfg }
}

function resultAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnoseScalarValues(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
  )
  expect(
    diagnosis.ok,
    `${relativePath}: ${diagnosis.diagnostic?.message}`,
  ).toBe(true)
  return { ...packet, result: diagnosis.result }
}

function deepFrozen(value) {
  if (!value || typeof value !== 'object') return true
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen)
}

function corpusPaths() {
  return ['raw', 'focused'].flatMap((kind) => {
    const root = new URL(
      `test/vm/jsconfuser-vm/fixtures/corpus/${kind}/`,
      repositoryRoot,
    )
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map(
        (entry) =>
          `test/vm/jsconfuser-vm/fixtures/corpus/${kind}/${entry.name}/encoded.js`,
      )
      .filter((relativePath) =>
        fs.existsSync(new URL(relativePath, repositoryRoot)),
      )
      .sort()
  })
}

test('emits the exact immutable scalar/value opcode census', () => {
  const packet = resultAt('test/vm/jsconfuser-vm/fixtures/reference/encoded.js')
  expect(packet.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-scalar-values.v1',
    encoding: 'numeric-u32',
    parseOnly: true,
    targetExecution: false,
    wordCount: 32,
    instructionCount: 9,
    functionCount: 1,
    operationCount: 6,
    opcodeScope: { family: 'I-scalar-value', count: 32 },
    valueState: {
      dataflow: 'not-introduced',
      mergeAgreement: 'not-applicable',
    },
  })
  expect(packet.result.opcodeScope.names).toEqual(scalarNames)
  expect(packet.result.opcodeScope.rows).toHaveLength(scalarNames.length)
  expect(packet.result.census.complete).toBe(true)
  expect(packet.result.census.dropped).toEqual([])
  expect(packet.result.census.duplicated).toEqual([])
  expect(packet.result.census.operationCount).toBe(
    packet.result.operations.length,
  )
  expect(packet.result.operations).toHaveLength(6)
  for (const operation of packet.result.operations) {
    expect(operation.functionId).toBe(0)
    expect(operation.reachable).toBe(true)
    expect(operation.opcode.name).toBe(operation.name)
    expect(operation.opcode.value).toBe(
      packet.result.opcodeScope.rows.find(({ name }) => name === operation.name)
        .opcode,
    )
    expect(operation.operands.map(({ kind }) => kind)).toEqual(
      operandKinds[operation.name],
    )
  }
  expect(deepFrozen(packet.result)).toBe(true)
})

test('represents STORE_GLOBAL and unary positive coercion precisely', () => {
  const store = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-store-global-assignment/encoded.js',
  )
  const storeOperation = store.result.operations.find(
    ({ name }) => name === 'STORE_GLOBAL',
  )
  expect(storeOperation).toMatchObject({
    family: 'global-mutation',
    destination: null,
    inputs: [{ kind: 'register', index: 2 }],
    constantReference: {
      kind: 'constant',
      value: 'TEST_OUTPUT',
      concealKey: 0,
    },
    globalReference: { kind: 'global', name: 'TEST_OUTPUT' },
    effect: { kind: 'global-write', register: null },
    useDef: {
      defines: null,
      globalWrites: [{ kind: 'global', name: 'TEST_OUTPUT' }],
    },
    valueSemantics: {
      kind: 'input-value',
      resultType: 'no-register-result',
      known: false,
    },
  })

  const unary = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-unary-positive-coercion/encoded.js',
  )
  const positive = unary.result.operations.filter(
    ({ name }) => name === 'UNARY_POS',
  )
  expect(positive).toHaveLength(3)
  expect(
    positive.every(
      ({ inputs, destination, valueSemantics }) =>
        inputs.length === 1 &&
        destination.kind === 'register' &&
        valueSemantics.operation === 'unary-positive' &&
        valueSemantics.resultType === 'number' &&
        valueSemantics.known === false,
    ),
  ).toBe(true)
})

test('covers expression semantics, global names, literals, and unreachable rows', () => {
  const expression = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-expression-values/encoded.js',
  )
  expect(expression.result.census.countsByName.EXP).toBeGreaterThan(0)
  expect(
    expression.result.operations.find(({ name }) => name === 'EXP'),
  ).toMatchObject({
    family: 'arithmetic',
    valueSemantics: {
      operation: 'exponentiate',
      kind: 'dynamic-operation',
      known: false,
    },
  })
  expect(
    expression.result.operations
      .filter(({ name }) => name === 'TYPEOF_SAFE')
      .every(
        ({ inputs, globalReference }) =>
          inputs.length === 0 &&
          typeof globalReference.name === 'string' &&
          globalReference.constant.value === globalReference.name,
      ),
  ).toBe(true)

  const globals = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-global-resolution/encoded.js',
  )
  expect(
    globals.result.operations.filter(({ globalReference }) => globalReference),
  ).not.toHaveLength(0)
  for (const operation of globals.result.operations) {
    if (operation.globalReference) {
      expect(typeof operation.globalReference.name).toBe('string')
      expect(operation.globalReference.constant.value).toBe(
        operation.globalReference.name,
      )
    }
  }

  const literals = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-literals-order/encoded.js',
  )
  expect(
    literals.result.operations
      .filter(({ name }) => name === 'LOAD_CONST')
      .every(({ constantReference, valueSemantics }) =>
        Object.is(valueSemantics.value, constantReference.value),
      ),
  ).toBe(true)

  const shortCircuit = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-short-circuit/encoded.js',
  )
  expect(
    shortCircuit.result.reachability.unreachableOperationCount,
  ).toBeGreaterThan(0)
  expect(
    shortCircuit.result.operations.some(({ reachable }) => !reachable),
  ).toBe(true)

  const boundary = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-instanceof-errors/encoded.js',
  )
  expect(
    boundary.wordcode.instructions
      .filter(({ name }) => name === 'IN' || name === 'INSTANCEOF')
      .map(({ name }) => name),
  ).toEqual(['INSTANCEOF', 'INSTANCEOF'])
  expect(boundary.result.operations.map(({ name }) => name)).not.toContain('IN')
  expect(boundary.result.operations.map(({ name }) => name)).not.toContain(
    'INSTANCEOF',
  )
  expect(
    boundary.result.boundaryOmissions.find(
      ({ boundary: name }) => name === 'J-property-prototype-collection',
    ).names,
  ).toContain('INSTANCEOF')
})

test('accepts reference plus every complete stripped corpus input', () => {
  const paths = [
    'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
    ...corpusPaths(),
  ]
  expect(paths).toHaveLength(38)
  for (const relativePath of paths) {
    const packet = resultAt(relativePath)
    expect(packet.result.census.expectedInstructionCount).toBe(
      packet.result.operationCount,
    )
    expect(packet.result.census.operationKeys).toHaveLength(
      packet.result.operationCount,
    )
    expect(new Set(packet.result.census.operationKeys).size).toBe(
      packet.result.operationCount,
    )
    expect(packet.result.proof.allScalarRowsPresent).toBe(true)
    expect(packet.result.proof.allScalarRowsUnique).toBe(true)
    expect(deepFrozen(packet.result)).toBe(true)
  }
})

test('keeps input packets unchanged and freezes successful diagnoses', () => {
  const packet = packetAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-expression-mutation/encoded.js',
  )
  const before = JSON.stringify(packet)
  const diagnosis = diagnoseScalarValues(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
  )
  expect(diagnosis.ok).toBe(true)
  expect(deepFrozen(diagnosis)).toBe(true)
  expect(deepFrozen(diagnosis.result)).toBe(true)
  expect(JSON.stringify(packet)).toBe(before)
  expect(() => diagnosis.result.operations.push({})).toThrow()
  expect(() => (diagnosis.result.operations[0].pc = 99)).toThrow()
})

// The worked example and representation control from the scalar-value
// specification, on the call-frame private-record scaffold: an A cloned from
// the reference fixture with only its words, root register count and pool
// replaced, B-E rebuilt, and I run against unchanged predecessors.
function scaffoldScalarValues(words, regCount, pool) {
  const container = structuredClone(
    extractContainerFromSource(
      sourceAt('test/vm/jsconfuser-vm/fixtures/reference/encoded.js'),
    ),
  )
  container.roles.words.values = words
  container.roles.scalars.MAIN_REG_COUNT.value = regCount
  container.roles.pool.values = pool
  const wordcode = readWordcode(container)
  expect(wordcode).not.toBeNull()
  const references = validateReferences(container, wordcode)
  expect(references).not.toBeNull()
  const functions = partitionFunctions(container, wordcode, references)
  expect(functions).not.toBeNull()
  const cfg = buildControlFlow(wordcode, references, functions)
  expect(cfg).not.toBeNull()
  const packet = [container, wordcode, references, functions, cfg]
  const supplied = JSON.stringify(packet)
  const diagnosis = diagnoseScalarValues(wordcode, references, functions, cfg)
  expect(JSON.stringify(packet)).toBe(supplied)
  expect(diagnosis.ok, diagnosis.diagnostic?.message).toBe(true)
  expect(deepFrozen(diagnosis.result)).toBe(true)
  return diagnosis.result.operations
}

test('keeps coercing operations dynamic in the I worked-example scaffold', () => {
  const words = [
    1, 0, 4294967295, 0, 1, 0, 0, 11, 2, 0, 1, 33, 3, 1, 37, 4, 2, 6, 1, 0, 2,
    45, 4,
  ]
  const rows = (values) =>
    scaffoldScalarValues(values, 5, ['2', 'out']).map(
      ({ pc, name, inputs, destination, valueSemantics }) => [
        pc,
        name,
        inputs.map(({ index }) => index),
        destination?.index ?? null,
        valueSemantics,
      ],
    )
  const dynamic = (operation, resultType) => ({
    kind: 'dynamic-operation',
    operation,
    resultType,
    known: false,
  })
  const expected = (pc7) => [
    [
      0,
      'LOAD_INT',
      [],
      0,
      {
        kind: 'known-integer',
        operation: 'load-integer',
        resultType: 'integer',
        known: true,
        value: 4294967295,
      },
    ],
    [
      3,
      'LOAD_CONST',
      [],
      1,
      {
        kind: 'known-constant',
        operation: 'load-constant',
        resultType: 'constant',
        known: true,
        value: '2',
      },
    ],
    pc7,
    [11, 'UNARY_POS', [1], 3, dynamic('unary-positive', 'number')],
    [
      14,
      'VOID',
      [2],
      4,
      {
        kind: 'known-undefined',
        operation: 'void',
        resultType: 'undefined',
        known: true,
      },
    ],
    [
      17,
      'STORE_GLOBAL',
      [2],
      null,
      {
        kind: 'input-value',
        operation: 'store-global',
        resultType: 'no-register-result',
        known: false,
        sourceRegister: { kind: 'register', index: 2 },
      },
    ],
  ]
  expect(words).toHaveLength(23)
  expect(rows(words)).toEqual(
    expected([7, 'ADD', [0, 1], 2, dynamic('add', 'dynamic')]),
  )

  const subtract = [...words]
  subtract[7] = 12 // SUB replaces ADD
  expect(rows(subtract)).toEqual(
    expected([7, 'SUB', [0, 1], 2, dynamic('subtract', 'dynamic')]),
  )
})

test('pins exact value representations in the I representation scaffold', () => {
  const operations = scaffoldScalarValues(
    [1, 0, 7, 5, 1, 0, 6, 0, 0, 1, 37, 2, 1, 45, 2],
    3,
    ['out'],
  )
  expect(
    operations.map(({ pc, name, valueSemantics }) => [
      pc,
      name,
      valueSemantics,
    ]),
  ).toEqual([
    [
      0,
      'LOAD_INT',
      {
        kind: 'known-integer',
        operation: 'load-integer',
        resultType: 'integer',
        known: true,
        value: 7,
      },
    ],
    [
      3,
      'MOVE',
      {
        kind: 'register-copy',
        operation: 'move',
        resultType: 'copy',
        known: false,
        sourceRegister: { kind: 'register', index: 0 },
      },
    ],
    [
      6,
      'STORE_GLOBAL',
      {
        kind: 'input-value',
        operation: 'store-global',
        resultType: 'no-register-result',
        known: false,
        sourceRegister: { kind: 'register', index: 1 },
      },
    ],
    [
      10,
      'VOID',
      {
        kind: 'known-undefined',
        operation: 'void',
        resultType: 'undefined',
        known: true,
      },
    ],
  ])
  const voidSemantics = operations[3].valueSemantics
  expect(Object.hasOwn(voidSemantics, 'value')).toBe(false)
  expect(Object.hasOwn(voidSemantics, 'sourceRegister')).toBe(false)
})
