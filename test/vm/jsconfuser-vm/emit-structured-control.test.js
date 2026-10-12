import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { buildControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { buildCallFrames } from '../../../src/vm/jsconfuser-vm/build-call-frames.js'
import { analyzeExceptionFinally } from '../../../src/vm/jsconfuser-vm/analyze-exception-finally.js'
import {
  diagnoseStructuredControl,
  emitStructuredControl,
} from '../../../src/vm/jsconfuser-vm/emit-structured-control.js'

const repositoryRoot = new URL('../../../', import.meta.url)

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
  const exceptionFinally = analyzeExceptionFinally(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  expect(exceptionFinally, `Packet H declined ${relativePath}`).not.toBeNull()
  return { container, wordcode, cfg, exceptionFinally }
}

function resultAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnoseStructuredControl(
    packet.wordcode,
    packet.cfg,
    packet.exceptionFinally,
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

function edgeWithoutId(edge) {
  return Object.fromEntries(
    Object.entries(edge).filter(([key]) => key !== 'id'),
  )
}

function edgeWithoutIdOrCondition(edge) {
  return Object.fromEntries(
    Object.entries(edge).filter(([key]) => key !== 'id' && key !== 'condition'),
  )
}

function corpusPaths() {
  const reference = 'test/vm/jsconfuser-vm/fixtures/reference/encoded.js'
  const corpus = ['raw', 'focused'].flatMap((kind) => {
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
  return [reference, ...corpus]
}

function recursivelyFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value
  Object.freeze(value)
  for (const child of Object.values(value)) recursivelyFreeze(child)
  return value
}

const IRREDUCIBLE_OPCODES = {
  LOAD_CONST: 0,
  LOAD_INT: 1,
  LOAD_GLOBAL: 2,
  LOAD_UPVALUE: 3,
  LOAD_THIS: 4,
  MOVE: 5,
  STORE_GLOBAL: 6,
  STORE_UPVALUE: 7,
  GET_PROP: 8,
  SET_PROP: 9,
  DELETE_PROP: 10,
  ADD: 11,
  SUB: 12,
  MUL: 13,
  DIV: 14,
  MOD: 15,
  EXP: 60,
  BAND: 16,
  BOR: 17,
  BXOR: 18,
  SHL: 19,
  SHR: 20,
  USHR: 21,
  LT: 22,
  GT: 23,
  LTE: 24,
  GTE: 25,
  EQ: 26,
  NEQ: 27,
  LOOSE_EQ: 28,
  LOOSE_NEQ: 29,
  IN: 30,
  INSTANCEOF: 31,
  UNARY_NEG: 32,
  UNARY_POS: 33,
  UNARY_NOT: 34,
  UNARY_BITNOT: 35,
  TYPEOF: 36,
  VOID: 37,
  TYPEOF_SAFE: 38,
  JUMP: 39,
  JUMP_IF_FALSE: 40,
  JUMP_IF_TRUE: 41,
  CALL: 42,
  CALL_METHOD: 43,
  NEW: 44,
  RETURN: 45,
  THROW: 46,
  MAKE_CLOSURE: 47,
  BUILD_ARRAY: 48,
  BUILD_OBJECT: 49,
  DEFINE_GETTER: 50,
  DEFINE_SETTER: 51,
  FOR_IN_SETUP: 52,
  FOR_IN_NEXT: 53,
  TRY_SETUP: 54,
  TRY_END: 55,
  PATCH: 56,
  DEBUGGER: 57,
  JUMP_REG: 58,
  FINALLY_SETUP: 59,
}

function syntheticIrreduciblePacket() {
  const container = recursivelyFreeze({
    schemaVersion: 'jsconfuser-vm-container.v1',
    encoding: 'numeric-u32',
    roles: {
      words: { values: [40, 0, 5, 39, 5, 39, 3] },
      op: { values: IRREDUCIBLE_OPCODES },
      sentinels: { values: { CALL_SPREAD: 65535 } },
      scalars: {
        ENCODE_BYTECODE: { value: false },
        MAIN_START_PC: { value: 0 },
        MAIN_REG_COUNT: { value: 1 },
        FRAME_START: { value: 1 },
        HEADER_SIZE: { value: 8 },
        TIMING_CHECKS: { value: false },
      },
      pool: { values: ['synthetic'] },
      slots: {
        values: {
          PC: 0,
          CALLER: 1,
          RET_DST: 2,
          THIS: 3,
          CLOSURE: 4,
          HANDLERS: 5,
          FRAME_SIZE: 6,
          REG_BASE: 7,
        },
      },
    },
  })
  const wordcode = readWordcode(container)
  const references = validateReferences(container, wordcode)
  const functions = partitionFunctions(container, wordcode, references)
  const cfg = buildControlFlow(wordcode, references, functions)
  const callFrames = buildCallFrames(wordcode, references, functions, cfg)
  const exceptionFinally = analyzeExceptionFinally(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  expect(cfg.functions[0].irreducible).toMatchObject({
    required: true,
    fallback: 'state-machine',
  })
  return { wordcode, cfg, exceptionFinally }
}

const referenceCase = 'test/vm/jsconfuser-vm/fixtures/reference/encoded.js'
const branchingCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-branching/encoded.js'
const loopCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-loop-forms/encoded.js'
const finallyCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-finally-abrupt/encoded.js'

test('emits frozen straight-line control with exact reference leaves and edges', () => {
  const packet = resultAt(referenceCase)
  expect(packet.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-structured-control.v1',
    encoding: 'numeric-u32',
    parseOnly: true,
    targetExecution: false,
    wordCount: 32,
    instructionCount: 9,
    functionCount: 1,
    mode: 'structured',
    modeCounts: { structured: 1, stateMachine: 0 },
  })
  expect(packet.result.functions[0].control).toMatchObject({
    kind: 'structured',
    regions: [
      {
        kind: 'linear',
      },
    ],
  })
  expect(packet.result.functions[0].control.regions[0].blockIds).toHaveLength(9)
  expect(packet.result.coverage).toEqual({
    instructions: { expected: 9, emitted: 9, unique: true, complete: true },
    edges: { expected: 9, emitted: 9, unique: true, complete: true },
  })
  expect(
    packet.result.functions[0].blocks.flatMap(({ leaves }) =>
      leaves.map(({ pc }) => pc),
    ),
  ).toEqual(packet.wordcode.instructions.map(({ pc }) => pc))
  expect(packet.result.edges.map(edgeWithoutId)).toEqual(packet.cfg.edges)
  expect(new Set(packet.result.edges.map(({ id }) => id)).size).toBe(9)
  expect(deepFrozen(packet.result)).toBe(true)
})

test('emits a proven conditional with its unique reconvergence and condition', () => {
  const packet = resultAt(branchingCase)
  const conditional = packet.result.functions
    .flatMap(({ control }) => control.regions)
    .find(({ kind }) => kind === 'conditional')
  expect(conditional).toBeDefined()
  expect(conditional.proof).toContain('unique nearest reconvergence')
  const edgesById = new Map(packet.result.edges.map((edge) => [edge.id, edge]))
  expect(edgesById.get(conditional.branchEdgeId)).toMatchObject({
    kind: 'conditional',
    targetPc: conditional.branchTargetPc,
    condition: conditional.condition,
  })
  expect(edgesById.get(conditional.fallthroughEdgeId)).toMatchObject({
    kind: 'fallthrough',
    targetPc: conditional.fallthroughTargetPc,
  })
  expect(conditional.mergeBlockId).toMatch(/^0:b@\d+$/)
  expect(
    packet.result.functions[0].blocks.some(
      ({ id }) => id === conditional.mergeBlockId,
    ),
  ).toBe(true)
})

test('emits natural loops only with a validated header, back-edge, and exit', () => {
  const packet = resultAt(loopCase)
  const loops = packet.result.functions
    .flatMap(({ control }) => control.regions)
    .filter(({ kind }) => kind === 'natural-loop')
  expect(loops.length).toBeGreaterThan(0)
  const edgesById = new Map(packet.result.edges.map((edge) => [edge.id, edge]))
  for (const loop of loops) {
    expect(loop.proof).toContain('header dominates')
    expect(loop.bodyBlockIds).toContain(loop.headerBlockId)
    expect(loop.backEdgeIds.length).toBeGreaterThan(0)
    expect(loop.exitEdgeIds.length).toBeGreaterThan(0)
    for (const edgeId of [...loop.backEdgeIds, ...loop.exitEdgeIds])
      expect(edgesById.has(edgeId)).toBe(true)
  }
})

test('carries handler/finally states and typed routes without emitting exception syntax', () => {
  const packet = resultAt(finallyCase)
  expect(
    packet.cfg.functions.some(({ finallyRecords }) => finallyRecords.length),
  ).toBe(true)
  expect(
    packet.cfg.functions.some(({ handlerRecords }) => handlerRecords.length),
  ).toBe(true)
  expect(packet.result.omissions.exceptionEmission).toContain('not-emitted')
  expect(packet.result.edges.map(edgeWithoutId)).toEqual(packet.cfg.edges)
  expect(packet.result.edges.map(edgeWithoutIdOrCondition)).toEqual(
    packet.exceptionFinally.edgeStates,
  )
  const resultBlocks = packet.result.functions.flatMap(({ blocks }) => blocks)
  const cfgBlocks = packet.cfg.functions.flatMap(({ blocks }) => blocks)
  expect(resultBlocks.map(({ handlerStateIn }) => handlerStateIn)).toEqual(
    cfgBlocks.map(({ handlerStateIn }) => handlerStateIn),
  )
  const leafReachability = packet.result.functions.flatMap(({ blocks }) =>
    blocks.flatMap(({ leaves }) =>
      leaves.map(({ pc, reachable }) => ({ pc, reachable })),
    ),
  )
  expect(leafReachability).toEqual(
    packet.exceptionFinally.instructionStates.map(({ pc, reachable }) => ({
      pc,
      reachable,
    })),
  )
  expect(
    packet.result.functions.some(({ blocks }) =>
      blocks.some(({ handlerStateIn }) => handlerStateIn.stack.length > 0),
    ),
  ).toBe(true)
})

test('preserves instruction and edge coverage across the tracked corpus', () => {
  const paths = corpusPaths()
  expect(paths).toHaveLength(38)
  for (const relativePath of paths) {
    const packet = resultAt(relativePath)
    const leaves = packet.result.functions.flatMap(({ blocks }) =>
      blocks.flatMap(({ leaves }) => leaves),
    )
    expect(leaves.map(({ pc }) => pc)).toEqual(
      packet.wordcode.instructions.map(({ pc }) => pc),
    )
    expect(new Set(leaves.map(({ pc }) => pc)).size).toBe(leaves.length)
    expect(packet.result.edges).toHaveLength(packet.cfg.edges.length)
    expect(packet.result.edges.map(edgeWithoutId)).toEqual(packet.cfg.edges)
    expect(packet.result.coverage).toMatchObject({
      instructions: { unique: true, complete: true },
      edges: { unique: true, complete: true },
    })
  }
})

test('does not mutate predecessor objects and returns a deeply frozen result', () => {
  const packet = packetAt(referenceCase)
  const before = structuredClone(packet)
  const result = emitStructuredControl(
    packet.wordcode,
    packet.cfg,
    packet.exceptionFinally,
  )
  expect(result).not.toBeNull()
  expect(deepFrozen(result)).toBe(true)
  expect(packet).toEqual(before)
  expect(() => result.functions.push({})).toThrow()
  expect(() => {
    result.functions[0].blocks[0].leaves[0].pc = 999
  }).toThrow()
})

test('uses an explicit state-machine fallback for an irreducible multiple-entry cycle', () => {
  const packet = syntheticIrreduciblePacket()
  const diagnosis = diagnoseStructuredControl(
    packet.wordcode,
    packet.cfg,
    packet.exceptionFinally,
  )
  expect(diagnosis.ok).toBe(true)
  expect(diagnosis.result).toMatchObject({
    mode: 'state-machine',
    modeCounts: { structured: 0, stateMachine: 1 },
    coverage: {
      instructions: { expected: 3, emitted: 3, unique: true, complete: true },
      edges: { expected: 4, emitted: 4, unique: true, complete: true },
    },
  })
  const fn = diagnosis.result.functions[0]
  expect(fn).toMatchObject({
    mode: 'state-machine',
    control: { kind: 'state-machine' },
  })
  expect(fn.control.stateVariable).toBe('__jsconfuserVmState')
  expect(fn.control.dispatch).toHaveLength(fn.blockCount)
  expect(
    fn.control.dispatch.flatMap(({ successorEdgeIds }) => successorEdgeIds),
  ).not.toContain(null)
  expect(fn.blocks.flatMap(({ leaves }) => leaves)).toHaveLength(3)
  expect(deepFrozen(diagnosis)).toBe(true)
})
