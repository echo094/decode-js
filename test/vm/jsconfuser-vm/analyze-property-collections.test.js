import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { buildControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { buildCallFrames } from '../../../src/vm/jsconfuser-vm/build-call-frames.js'
import { diagnosePropertyCollections } from '../../../src/vm/jsconfuser-vm/analyze-property-collections.js'

const repositoryRoot = new URL('../../../', import.meta.url)

const propertyNames = [
  'GET_PROP',
  'SET_PROP',
  'DELETE_PROP',
  'IN',
  'INSTANCEOF',
  'BUILD_ARRAY',
  'BUILD_OBJECT',
  'DEFINE_GETTER',
  'DEFINE_SETTER',
  'FOR_IN_SETUP',
  'FOR_IN_NEXT',
]

const expectedCounts = {
  GET_PROP: 691,
  SET_PROP: 199,
  DELETE_PROP: 2,
  IN: 5,
  INSTANCEOF: 5,
  BUILD_ARRAY: 75,
  BUILD_OBJECT: 38,
  DEFINE_GETTER: 1,
  DEFINE_SETTER: 1,
  FOR_IN_SETUP: 10,
  FOR_IN_NEXT: 10,
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
  const callFrames = buildCallFrames(wordcode, references, functions, cfg)
  expect(callFrames, `Packet F declined ${relativePath}`).not.toBeNull()
  return { wordcode, references, functions, cfg, callFrames }
}

function resultAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnosePropertyCollections(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
    packet.callFrames,
  )
  expect(
    diagnosis.ok,
    `${relativePath}: ${diagnosis.diagnostic?.message}`,
  ).toBe(true)
  return { ...packet, result: diagnosis.result }
}

function deepFrozen(value) {
  if (!value || typeof value !== 'object') return true
  return (
    Object.isFrozen(value) &&
    Object.values(value).every((child) => deepFrozen(child))
  )
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

test('emits the complete property and collection operation inventory', () => {
  const packet = resultAt('test/vm/jsconfuser-vm/fixtures/reference/encoded.js')

  expect(packet.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-property-collections.v1',
    encoding: 'numeric-u32',
    parseOnly: true,
    targetExecution: false,
    wordCount: 32,
    instructionCount: 9,
    functionCount: 1,
    operationCount: 1,
    opcodeScope: { family: 'J-property-collection', count: 11 },
    predecessorSchemas: {
      wordcode: 'jsconfuser-vm-wordcode.v1',
      references: 'jsconfuser-vm-references.v1',
      functions: 'jsconfuser-vm-functions.v1',
      cfg: 'jsconfuser-vm-cfg.v1',
      callFrames: 'jsconfuser-vm-call-frames.v1',
    },
  })
  expect(packet.result.opcodeScope.names).toEqual(propertyNames)
  expect(packet.result.opcodeScope.rows).toHaveLength(11)
  expect(
    packet.result.opcodeScope.rows.find(({ name }) => name === 'FOR_IN_SETUP'),
  ).toMatchObject({ width: 3 })
  expect(packet.result.operations[0]).toMatchObject({
    functionId: 0,
    pc: 22,
    reachable: true,
    opcode: { name: 'SET_PROP', value: 9 },
    name: 'SET_PROP',
    operands: [
      { kind: 'register', index: 2 },
      { kind: 'register', index: 3 },
      { kind: 'register', index: 6 },
    ],
    destination: null,
    inputs: [
      { kind: 'register', index: 2 },
      { kind: 'register', index: 3 },
      { kind: 'register', index: 6 },
    ],
    useDef: {
      defines: null,
      conditionalDefine: null,
    },
    effect: { kind: 'property-write', register: null },
    semantic: {
      kind: 'property-write',
      resultType: 'no-register-result',
      known: false,
    },
  })
  expect(packet.result.operations[0].roles).toMatchObject({
    object: { register: { kind: 'register', index: 2 } },
    key: { register: { kind: 'register', index: 3 } },
    value: { register: { kind: 'register', index: 6 } },
  })
  expect(packet.result.operations[0].evaluationOrder.roles).toEqual([
    'object',
    'key',
    'value',
  ])
  expect(packet.result.proof.historicalForInNextWordOperandsPreserved).toBe(
    true,
  )
  expect(deepFrozen(packet.result)).toBe(true)
})

test('retains variable payloads and conservative property semantics', () => {
  const accessors = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-accessors-and-methods/encoded.js',
  )
  const array = accessors.result.operations.find(
    ({ name }) => name === 'BUILD_ARRAY',
  )
  expect(array).toMatchObject({
    width: 7,
    payload: {
      kind: 'array',
      count: 4,
      elementRegisters: [
        { kind: 'register', index: 8 },
        { kind: 'register', index: 7 },
        { kind: 'register', index: 9 },
        { kind: 'register', index: 10 },
      ],
    },
    semantic: {
      kind: 'array-construction',
      resultType: 'array',
      unknowns: ['element values', 'array identity'],
    },
  })
  expect(array.evaluationOrder.roles).toEqual([
    'element[0]',
    'element[1]',
    'element[2]',
    'element[3]',
  ])

  const object = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-arrow-forms/encoded.js',
  ).result.operations.find(({ name }) => name === 'BUILD_OBJECT')
  expect(object).toMatchObject({
    payload: {
      kind: 'object',
      pairCount: 2,
      pairs: [
        {
          pairIndex: 0,
          key: { kind: 'register', index: 0 },
          value: { kind: 'register', index: 1 },
        },
        {
          pairIndex: 1,
          key: { kind: 'register', index: 2 },
          value: { kind: 'register', index: 3 },
        },
      ],
    },
    semantic: {
      kind: 'object-construction',
      resultType: 'object',
      pairCount: 2,
    },
  })
  expect(object.evaluationOrder.roles).toEqual([
    'pair[0].key',
    'pair[0].value',
    'pair[1].key',
    'pair[1].value',
  ])
  expect(object.semantic.duplicateKeyBehavior).toContain('later')

  const getter = accessors.result.operations.find(
    ({ name }) => name === 'DEFINE_GETTER',
  )
  const setter = accessors.result.operations.find(
    ({ name }) => name === 'DEFINE_SETTER',
  )
  expect(getter).toMatchObject({
    roles: { accessorFunction: { register: { kind: 'register', index: 7 } } },
    semantic: {
      kind: 'getter-definition',
      accessorKind: 'getter',
      descriptor: {
        configurable: true,
        enumerable: true,
        preservesExistingOppositeAccessor: true,
      },
    },
  })
  expect(setter.semantic).toMatchObject({
    kind: 'setter-definition',
    accessorKind: 'setter',
  })
})

test('records deletion, membership, prototype, and enumeration behavior', () => {
  const deletion = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-expression-mutation/encoded.js',
  ).result.operations.find(({ name }) => name === 'DELETE_PROP')
  expect(deletion).toMatchObject({
    semantic: {
      kind: 'property-delete',
      resultType: 'boolean',
      runtime: 'computes delete object[key]',
    },
    roles: {
      object: { register: { kind: 'register', index: 3 } },
      key: { register: { kind: 'register', index: 6 } },
    },
  })

  const values = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-expression-values/encoded.js',
  )
  const membership = values.result.operations.find(({ name }) => name === 'IN')
  const instanceofOperation = values.result.operations.find(
    ({ name }) => name === 'INSTANCEOF',
  )
  expect(membership).toMatchObject({
    roles: {
      propertyKey: { register: { kind: 'register', index: 4 } },
      object: { register: { kind: 'register', index: 11 } },
    },
    semantic: {
      kind: 'membership-test',
      resultType: 'boolean',
    },
  })
  expect(membership.evaluationOrder.roles).toEqual(['propertyKey', 'object'])
  expect(instanceofOperation).toMatchObject({
    roles: {
      instance: { register: { kind: 'register', index: 4 } },
      constructor: { register: { kind: 'register', index: 10 } },
    },
    semantic: { kind: 'prototype-relation-test', resultType: 'boolean' },
  })

  const enumeration = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-for-in-enumeration/encoded.js',
  )
  const setup = enumeration.result.operations.find(
    ({ name }) => name === 'FOR_IN_SETUP',
  )
  const next = enumeration.result.operations.find(
    ({ name }) => name === 'FOR_IN_NEXT',
  )
  expect(setup).toMatchObject({
    roles: {
      iterator: { register: { kind: 'register', index: 5 } },
      source: { register: { kind: 'register', index: 3 } },
    },
    semantic: {
      kind: 'for-in-setup',
      setup: {
        nullishSourceProducesEmptyKeys: true,
        boxesPrimitiveSource: true,
        walksPrototypeChain: true,
        deDuplicatesNames: true,
      },
    },
  })
  expect(next).toMatchObject({
    wordOperands: [
      { kind: 'register', index: 7 },
      { kind: 'label-target', pc: 5 },
      { kind: 'register', index: 83 },
    ],
    operands: [
      { kind: 'register', index: 7 },
      { kind: 'register', index: 5 },
      { kind: 'label-target', pc: 83 },
    ],
    payload: {
      kind: 'iterator-next',
      iterator: { kind: 'register', index: 5 },
      exitTarget: { kind: 'label-target', pc: 83 },
    },
    controlFlow: {
      kind: 'iterator-conditional',
      normalTargetPc: 64,
      exitTargetPc: 83,
    },
    semantic: {
      kind: 'for-in-next',
      exitTargetPc: 83,
      exit: {
        kind: 'iterator-conditional',
        normalTargetPc: 64,
        exitTargetPc: 83,
      },
    },
  })
  expect(next.evaluationOrder.roles).toEqual(['iterator', 'exit'])
  expect(next.semantic.exit.normal.writesDestination).toBe(true)
  expect(next.semantic.exit.exit.writesDestination).toBe(false)
})

test('accepts the tracked stripped corpus with a complete property census', () => {
  const paths = [
    'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
    ...corpusPaths(),
  ]
  expect(paths).toHaveLength(38)
  const counts = Object.fromEntries(propertyNames.map((name) => [name, 0]))
  let operationCount = 0
  for (const relativePath of paths) {
    const packet = resultAt(relativePath)
    expect(packet.result.census.complete).toBe(true)
    expect(packet.result.census.dropped).toEqual([])
    expect(packet.result.census.duplicated).toEqual([])
    expect(packet.result.census.expectedInstructionCount).toBe(
      packet.result.operationCount,
    )
    expect(packet.result.census.operationKeys).toHaveLength(
      packet.result.operationCount,
    )
    expect(new Set(packet.result.census.operationKeys).size).toBe(
      packet.result.operationCount,
    )
    expect(packet.result.proof.allPropertyRowsPresent).toBe(true)
    expect(packet.result.proof.allPropertyRowsUnique).toBe(true)
    expect(deepFrozen(packet.result)).toBe(true)
    operationCount += packet.result.operationCount
    for (const [name, count] of Object.entries(
      packet.result.census.countsByName,
    )) {
      counts[name] += count
    }
  }
  expect(operationCount).toBe(1037)
  expect(counts).toEqual(expectedCounts)
})

test('keeps inputs unchanged and freezes successful results and diagnoses', () => {
  const packet = packetAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-expression-mutation/encoded.js',
  )
  const before = JSON.stringify(packet)
  const diagnosis = diagnosePropertyCollections(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
    packet.callFrames,
  )
  expect(diagnosis.ok).toBe(true)
  expect(deepFrozen(diagnosis)).toBe(true)
  expect(deepFrozen(diagnosis.result)).toBe(true)
  expect(JSON.stringify(packet)).toBe(before)
  expect(() => diagnosis.result.operations.push({})).toThrow()
  expect(() => (diagnosis.result.operations[0].pc = 99)).toThrow()
})

// The worked example from the property-collection specification, on the
// call-frame private-record scaffold: an A cloned from the reference fixture
// with root regCount=7 and an empty pool, B-F rebuilt, and J run against
// unchanged predecessors.
function scaffoldPropertyCollections(words) {
  const container = structuredClone(
    extractContainerFromSource(
      sourceAt('test/vm/jsconfuser-vm/fixtures/reference/encoded.js'),
    ),
  )
  container.roles.words.values = words
  container.roles.scalars.MAIN_REG_COUNT.value = 7
  container.roles.pool.values = []
  const wordcode = readWordcode(container)
  expect(wordcode).not.toBeNull()
  const references = validateReferences(container, wordcode)
  expect(references).not.toBeNull()
  const functions = partitionFunctions(container, wordcode, references)
  expect(functions).not.toBeNull()
  const cfg = buildControlFlow(wordcode, references, functions)
  expect(cfg).not.toBeNull()
  const callFrames = buildCallFrames(wordcode, references, functions, cfg)
  expect(callFrames).not.toBeNull()
  const packet = [container, wordcode, references, functions, cfg, callFrames]
  const supplied = JSON.stringify(packet)
  const diagnosis = diagnosePropertyCollections(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  expect(JSON.stringify(packet)).toBe(supplied)
  expect(diagnosis.ok, diagnosis.diagnostic?.message).toBe(true)
  expect(deepFrozen(diagnosis.result)).toBe(true)
  return diagnosis.result
}

test('projects the J worked-example scaffold and its accessor step limit', () => {
  const words = [
    49, 0, 2, 1, 2, 1, 3, 50, 0, 1, 4, 52, 5, 0, 53, 6, 5, 20, 39, 14, 45, 6,
  ]
  const register = (index) => ({ kind: 'register', index })
  expect(words).toHaveLength(22)
  const result = scaffoldPropertyCollections(words)
  expect(result.operations.map(({ pc, name }) => [pc, name])).toEqual([
    [0, 'BUILD_OBJECT'],
    [7, 'DEFINE_GETTER'],
    [11, 'FOR_IN_SETUP'],
    [14, 'FOR_IN_NEXT'],
  ])
  const [object, accessor, , next] = result.operations

  // J1: ordered pairs keep the repeated key register and their read paths.
  expect(object.roles.pairs).toEqual([
    {
      pairIndex: 0,
      key: { role: 'key', operand: 2, register: register(1) },
      value: { role: 'value', operand: 3, register: register(2) },
    },
    {
      pairIndex: 1,
      key: { role: 'key', operand: 4, register: register(1) },
      value: { role: 'value', operand: 5, register: register(3) },
    },
  ])
  expect(object.evaluationOrder.roles).toEqual([
    'pair[0].key',
    'pair[0].value',
    'pair[1].key',
    'pair[1].value',
  ])

  // J2: semantic iterator/exit operands and a normal-only definition, while
  // the copied historical word tags are reported, not used.
  expect(next.operands).toEqual([
    register(6),
    register(5),
    { kind: 'label-target', pc: 20 },
  ])
  expect(next.wordOperands).toEqual([
    register(6),
    { kind: 'label-target', pc: 5 },
    { kind: 'register', index: 20 },
  ])
  expect(next.payload).toEqual({
    kind: 'iterator-next',
    iterator: register(5),
    exitTarget: { kind: 'label-target', pc: 20 },
  })
  expect(next.controlFlow).toMatchObject({
    normalTargetPc: 18,
    exitTargetPc: 20,
    normal: { writesDestination: true, incrementsIterator: true },
    exit: { writesDestination: false, incrementsIterator: false },
  })
  expect(next.useDef).toMatchObject({
    defines: register(6),
    conditionalDefine: 'only when an enumerable key is available',
  })
  expect(result.proof.historicalForInNextWordOperandsPreserved).toBe(true)

  // J3: the accessor role follows its register, but the evaluation step for
  // role "function" stays null in both the original and the r3 opposite.
  const accessorView = ({ roles, inputs, evaluationOrder }) => [
    roles.accessorFunction.register,
    inputs[2],
    evaluationOrder.steps[2],
  ]
  const nullStep = { order: 2, role: 'function', register: null }
  expect(accessorView(accessor)).toEqual([register(4), register(4), nullStep])
  const accessorInR3 = [...words]
  accessorInR3[10] = 3
  const opposite = scaffoldPropertyCollections(accessorInR3).operations[1]
  expect(accessorView(opposite)).toEqual([register(3), register(3), nullStep])
})
