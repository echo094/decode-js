import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { buildControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { buildCallFrames } from '../../../src/vm/jsconfuser-vm/build-call-frames.js'
import { analyzeClosureLifetimes } from '../../../src/vm/jsconfuser-vm/analyze-closure-lifetimes.js'
import { analyzeExceptionFinally } from '../../../src/vm/jsconfuser-vm/analyze-exception-finally.js'
import {
  diagnoseClosureException,
  emitClosureException,
} from '../../../src/vm/jsconfuser-vm/emit-closure-exception.js'

const repositoryRoot = new URL('../../../', import.meta.url)

function sourceAt(relativePath) {
  return fs.readFileSync(new URL(relativePath, repositoryRoot), 'utf8')
}

function packetFromContainer(container) {
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
  const closureLifetimes = analyzeClosureLifetimes(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  expect(closureLifetimes).not.toBeNull()
  const exceptionFinally = analyzeExceptionFinally(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  expect(exceptionFinally).not.toBeNull()
  return {
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
    closureLifetimes,
    exceptionFinally,
  }
}

function packetAt(relativePath) {
  const container = extractContainerFromSource(sourceAt(relativePath))
  expect(container, `Packet A declined ${relativePath}`).not.toBeNull()
  return packetFromContainer(container)
}

function resultAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnoseClosureException(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
    packet.callFrames,
    packet.closureLifetimes,
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

function corpusPaths() {
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
  return ['test/vm/jsconfuser-vm/fixtures/reference/encoded.js', ...corpus]
}

const OPCODES = {
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
  return packetFromContainer({
    schemaVersion: 'jsconfuser-vm-container.v1',
    encoding: 'numeric-u32',
    roles: {
      words: { values: [40, 0, 5, 39, 5, 39, 3] },
      op: { values: OPCODES },
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
}

const referenceCase = 'test/vm/jsconfuser-vm/fixtures/reference/encoded.js'
const closureCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-closures-state/encoded.js'
const nestedClosureCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/program-cash/encoded.js'
const throwCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-throw-catch/encoded.js'
const finallyCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-finally-abrupt/encoded.js'

test('emits an exact instruction boundary with an opaque later-packet fallback', () => {
  const packet = resultAt(referenceCase)
  expect(packet.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-closure-exception-emission.v1',
    encoding: 'numeric-u32',
    parseOnly: true,
    targetExecution: false,
    emittedJavaScript: false,
    vmExecuted: false,
    finalJavaScriptSemantics: false,
    semanticBoundary: 'later-packet',
    wordCount: 32,
    instructionCount: 9,
    functionCount: 1,
  })
  expect(packet.result.coverage.instructions).toEqual({
    expected: 9,
    emitted: 9,
    unique: true,
    complete: true,
  })
  expect(packet.result.instructions).toHaveLength(9)
  expect(
    packet.result.instructions.every(
      ({ semanticBoundary }) => semanticBoundary === 'later-packet',
    ),
  ).toBe(true)
  expect(packet.result.completionRecords).toContainEqual(
    expect.objectContaining({
      pc: 30,
      kind: 'return-completion',
      sourceRegister: { kind: 'register', index: 2 },
      routes: [expect.objectContaining({ kind: 'return' })],
    }),
  )
  expect(packet.result.functions[0].fallback.kind).toBe('opaque')
  expect(packet.result.closureRecords).toEqual([])
  expect(packet.result.handlerRecords).toEqual([])
  expect(packet.result.finallyRecords).toEqual([])
  expect(deepFrozen(packet.result)).toBe(true)
})

test('preserves local and nested upvalue capture, owner, use, and lifetime records', () => {
  const local = resultAt(closureCase)
  expect(local.result.closureRecords).toContainEqual(
    expect.objectContaining({
      id: 'closure:1:64',
      parentFunctionId: 1,
      childFunctionId: 2,
      captures: [
        expect.objectContaining({
          source: {
            kind: 'local',
            parentFunctionId: 1,
            register: { kind: 'register', index: 2 },
          },
          captureIndex: 0,
        }),
      ],
    }),
  )
  expect(local.result.bindingRecords).toContainEqual(
    expect.objectContaining({
      id: 'binding:1:register:2',
      lifecycle: expect.objectContaining({
        initialState: 'open-upvalue',
        afterCloseState: 'closed-captured-value',
      }),
    }),
  )
  expect(local.result.upvalueUseRecords).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ operation: 'read', state: 'closed' }),
      expect.objectContaining({ operation: 'write', state: 'closed' }),
    ]),
  )
  expect(local.result.lifetimeTransitionRecords).toContainEqual(
    expect.objectContaining({
      bindingId: 'binding:1:register:2',
      fromState: 'open-upvalue',
      toState: 'closed-captured-value',
      completion: 'return',
    }),
  )

  const nested = resultAt(nestedClosureCase)
  const nestedCapture = nested.result.captureRecords.find(
    ({ source }) => source.kind === 'upvalue',
  )
  expect(nestedCapture).toBeDefined()
  expect(nestedCapture.bindingOwnerFunctionId).not.toBe(
    nestedCapture.parentFunctionId,
  )
  expect(nestedCapture.bindingId).toBe(
    `binding:${nestedCapture.bindingOwnerFunctionId}:register:${nestedCapture.bindingRegister.index}`,
  )
  expect(nested.result.coverage.closures.capturePairs).toMatchObject({
    expected: nested.result.capturePairs.length,
    emitted: nested.result.capturePairs.length,
    complete: true,
  })
})

test('preserves try/catch/finally, abrupt completion, pads, merges, and route identity', () => {
  const handler = resultAt(throwCase)
  expect(handler.result.census.exceptions.handlers).toBe(2)
  expect(handler.result.completionRecords).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'throw-completion' }),
    ]),
  )
  expect(
    handler.result.routeRecords.some(
      ({ kind, route }) => kind === 'handler' && route === 'exceptional',
    ),
  ).toBe(true)
  expect(
    handler.result.routeRecords.every(({ id }) => id.startsWith('route:')),
  ).toBe(true)

  const abrupt = resultAt(finallyCase)
  expect(abrupt.result.census.exceptions).toMatchObject({
    trySetup: 2,
    tryEnd: 10,
    finallySetup: 5,
    handlers: 2,
    finalizers: 5,
    merges: 8,
    jumpRegChecks: 5,
    throwPads: 5,
  })
  expect(abrupt.result.finallyRecords).toHaveLength(5)
  expect(abrupt.result.finallyEmissionRecords).toContainEqual(
    expect.objectContaining({
      id: 'finally@104',
      kind: 'try-finally-region',
      throwPadPc: 172,
    }),
  )
  expect(abrupt.result.throwPadRecords).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        finalizerId: 'finally@104',
        throwPadPc: 172,
        continuationReg: 2,
        payloadReg: 3,
      }),
    ]),
  )
  expect(abrupt.result.handlerFinallyStateRecords).toContainEqual(
    expect.objectContaining({
      functionId: 3,
      pc: 310,
      kind: 'handler-finally-state',
      handlerStateBefore: expect.objectContaining({ stack: expect.any(Array) }),
    }),
  )
  expect(abrupt.result.mergeRecords).toContainEqual(
    expect.objectContaining({ functionId: 3, pc: 310, incomingCount: 2 }),
  )
  expect(abrupt.result.completionRecords).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'throw-completion',
        routes: expect.arrayContaining([
          expect.objectContaining({ kind: 'finally' }),
        ]),
      }),
    ]),
  )
  expect(abrupt.result.coverage.exceptions).toMatchObject({
    edges: { complete: true },
    states: { complete: true },
  })
  expect(abrupt.result.coverage.routes.complete).toBe(true)
})

test('uses a readable state-machine fallback for required irreducible control', () => {
  const packet = syntheticIrreduciblePacket()
  expect(packet.cfg.functions[0].irreducible).toMatchObject({
    required: true,
    fallback: 'state-machine',
  })
  const result = emitClosureException(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
    packet.callFrames,
    packet.closureLifetimes,
    packet.exceptionFinally,
  )
  expect(result).not.toBeNull()
  expect(result.functions[0].fallback).toMatchObject({
    kind: 'state-machine',
    required: true,
    stateVariable: '__jsconfuserVmState',
  })
  expect(result.functions[0].fallback.dispatch).toHaveLength(
    packet.cfg.functions[0].blocks.length,
  )
  expect(deepFrozen(result)).toBe(true)
})

test('covers every instruction in the tracked reference and corpus inputs', () => {
  const paths = corpusPaths()
  expect(paths).toHaveLength(38)
  for (const relativePath of paths) {
    const { result } = resultAt(relativePath)
    expect(result.coverage.instructions.complete).toBe(true)
    expect(result.coverage.closures.sites.complete).toBe(true)
    expect(result.coverage.closures.capturePairs.complete).toBe(true)
    expect(result.coverage.exceptions.handlers.complete).toBe(true)
    expect(result.coverage.exceptions.finalizers.complete).toBe(true)
    expect(result.coverage.exceptions.edges.complete).toBe(true)
    expect(result.coverage.completions.complete).toBe(true)
    expect(result.coverage.routes.complete).toBe(true)
    expect(result.coverage.instructions.complete).toBe(true)
    expect(deepFrozen(result)).toBe(true)
  }
})

test('preserves inputs and freezes successful emission', () => {
  const packet = packetAt(closureCase)
  const before = structuredClone(packet)
  const result = emitClosureException(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
    packet.callFrames,
    packet.closureLifetimes,
    packet.exceptionFinally,
  )
  expect(result).not.toBeNull()
  expect(deepFrozen(result)).toBe(true)
  expect(packet).toEqual(before)
  expect(() => result.instructions.push({})).toThrow()
  expect(() => {
    result.instructions[0].pc = 999
  }).toThrow()
})
