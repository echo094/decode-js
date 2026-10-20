import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { buildControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { buildCallFrames } from '../../../src/vm/jsconfuser-vm/build-call-frames.js'
import {
  analyzeExceptionFinally,
  diagnoseExceptionFinally,
} from '../../../src/vm/jsconfuser-vm/analyze-exception-finally.js'

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
  return { wordcode, references, functions, cfg, callFrames }
}

function hAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnoseExceptionFinally(
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

const finallyCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-finally-abrupt/encoded.js'

test('analyzes nested handler/finally states and abrupt routes', () => {
  const packet = hAt(finallyCase)

  expect(packet.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-exception-finally.v1',
    encoding: 'numeric-u32',
    wordCount: 517,
    instructionCount: 152,
    functionCount: 5,
    source: {
      wordcodeSchema: 'jsconfuser-vm-wordcode.v1',
      referencesSchema: 'jsconfuser-vm-references.v1',
      functionsSchema: 'jsconfuser-vm-functions.v1',
      cfgSchema: 'jsconfuser-vm-cfg.v1',
      callFramesSchema: 'jsconfuser-vm-call-frames.v1',
    },
  })
  expect(
    packet.result.handlerRecords.map(
      ({ setupPc, handlerPc, exceptionReg }) => ({
        setupPc,
        handlerPc,
        exceptionReg,
      }),
    ),
  ).toEqual([
    { setupPc: 189, handlerPc: 201, exceptionReg: 2 },
    { setupPc: 262, handlerPc: 310, exceptionReg: 2 },
  ])
  expect(
    packet.result.finallyRecords.map(
      ({ setupPc, finallyPc, continuationReg, payloadReg, throwPadPc }) => ({
        setupPc,
        finallyPc,
        continuationReg,
        payloadReg,
        throwPadPc,
      }),
    ),
  ).toEqual([
    {
      setupPc: 104,
      finallyPc: 149,
      continuationReg: 2,
      payloadReg: 3,
      throwPadPc: 172,
    },
    {
      setupPc: 184,
      finallyPc: 224,
      continuationReg: 3,
      payloadReg: 4,
      throwPadPc: 247,
    },
    {
      setupPc: 257,
      finallyPc: 341,
      continuationReg: 3,
      payloadReg: 4,
      throwPadPc: 364,
    },
    {
      setupPc: 265,
      finallyPc: 282,
      continuationReg: 5,
      payloadReg: 6,
      throwPadPc: 305,
    },
    {
      setupPc: 392,
      finallyPc: 462,
      continuationReg: 3,
      payloadReg: 4,
      throwPadPc: 489,
    },
  ])
  expect(
    packet.wordcode.instructions
      .filter(({ name }) => name === 'TRY_END')
      .map(({ pc }) => pc),
  ).toEqual([140, 143, 198, 218, 276, 307, 335, 411, 428, 456])
  const routes = packet.result.completionRoutes.map(
    ({ sourcePc, kind, targetPc, route, callSitePc }) => ({
      sourcePc,
      kind,
      targetPc,
      route,
      callSitePc,
    }),
  )
  for (const route of [
    {
      sourcePc: 124,
      kind: 'finally',
      targetPc: 149,
      route: 'exceptional',
      callSitePc: 124,
    },
    {
      sourcePc: 141,
      kind: 'finally',
      targetPc: 149,
      route: 'normal',
      callSitePc: null,
    },
    {
      sourcePc: 196,
      kind: 'handler',
      targetPc: 201,
      route: 'exceptional',
      callSitePc: null,
    },
    {
      sourcePc: 212,
      kind: 'finally',
      targetPc: 224,
      route: 'exceptional',
      callSitePc: 212,
    },
    {
      sourcePc: 222,
      kind: 'finally',
      targetPc: 224,
      route: 'normal',
      callSitePc: null,
    },
    {
      sourcePc: 274,
      kind: 'finally',
      targetPc: 282,
      route: 'exceptional',
      callSitePc: null,
    },
    {
      sourcePc: 297,
      kind: 'handler',
      targetPc: 310,
      route: 'exceptional',
      callSitePc: 297,
    },
    {
      sourcePc: 329,
      kind: 'finally',
      targetPc: 341,
      route: 'exceptional',
      callSitePc: 329,
    },
    {
      sourcePc: 339,
      kind: 'finally',
      targetPc: 341,
      route: 'normal',
      callSitePc: null,
    },
    {
      sourcePc: 412,
      kind: 'finally',
      targetPc: 462,
      route: 'normal',
      callSitePc: null,
    },
    {
      sourcePc: 429,
      kind: 'finally',
      targetPc: 462,
      route: 'normal',
      callSitePc: null,
    },
    {
      sourcePc: 450,
      kind: 'finally',
      targetPc: 462,
      route: 'exceptional',
      callSitePc: 450,
    },
    {
      sourcePc: 460,
      kind: 'finally',
      targetPc: 462,
      route: 'normal',
      callSitePc: null,
    },
    {
      sourcePc: 305,
      kind: 'handler',
      targetPc: 310,
      route: 'exceptional',
      callSitePc: null,
    },
    {
      sourcePc: 356,
      kind: 'throw',
      targetPc: null,
      route: 'propagate',
      callSitePc: 356,
    },
    {
      sourcePc: 364,
      kind: 'throw',
      targetPc: null,
      route: 'propagate',
      callSitePc: null,
    },
    {
      sourcePc: 481,
      kind: 'throw',
      targetPc: null,
      route: 'propagate',
      callSitePc: 481,
    },
    {
      sourcePc: 489,
      kind: 'throw',
      targetPc: null,
      route: 'propagate',
      callSitePc: null,
    },
  ]) {
    expect(routes).toContainEqual(route)
  }
  expect(packet.result.jumpRegChecks).toContainEqual({
    functionId: 1,
    pc: 170,
    sourceRegister: { kind: 'register', index: 2 },
    targets: [172, 174],
    finalizer: 'finally@104',
    finite: true,
    sameFunction: true,
    continuationRegister: { kind: 'register', index: 2 },
    instructionName: 'JUMP_REG',
  })
  expect(packet.result.functions.find(({ id }) => id === 3).merges).toEqual(
    expect.arrayContaining([
      // Three exceptional entries plus the setup that arms the handler (the try unit).
      expect.objectContaining({ pc: 310, incomingCount: 4 }),
    ]),
  )
  expect(deepFrozen(packet.result)).toBe(true)
})

test('accepts focused and handler-only corpus fixtures without target execution', () => {
  const focused = hAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
  )
  const handler = hAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-throw-catch/encoded.js',
  )
  expect(focused.result.schemaVersion).toBe(
    'jsconfuser-vm-exception-finally.v1',
  )
  expect(focused.result.handlerRecords).toEqual([])
  expect(handler.result.handlerRecords.length).toBe(2)
  expect(handler.result.finallyRecords).toEqual([])
  expect(handler.result.completionRoutes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'handler',
        targetPc: expect.any(Number),
        route: 'exceptional',
      }),
    ]),
  )
})

test('preserves predecessor snapshots and freezes successful APIs', () => {
  const packet = packetAt(finallyCase)
  const snapshot = structuredClone(packet)
  const result = analyzeExceptionFinally(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
    packet.callFrames,
  )
  expect(result).not.toBeNull()
  expect(deepFrozen(result)).toBe(true)
  expect(packet).toEqual(snapshot)

  const diagnosis = diagnoseExceptionFinally(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
    packet.callFrames,
  )
  expect(diagnosis).toMatchObject({ ok: true, result, diagnostic: null })
  expect(deepFrozen(diagnosis)).toBe(true)
})

// The worked example and its two refusal controls from the exception/finally
// specification, on the call-frame private-record scaffold: an A cloned from
// the reference fixture with root regCount=2 and an empty pool.
function scaffoldExceptionFinally(words) {
  const container = structuredClone(
    extractContainerFromSource(
      sourceAt('test/vm/jsconfuser-vm/fixtures/reference/encoded.js'),
    ),
  )
  container.roles.words.values = words
  container.roles.scalars.MAIN_REG_COUNT.value = 2
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
  const diagnosis = diagnoseExceptionFinally(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  expect(JSON.stringify(packet)).toBe(supplied)
  return diagnosis
}

test('routes the disarmed-entry scaffold and refuses its active controls', () => {
  const words = [
    59, 13, 0, 1, 15, 1, 0, 17, 55, 39, 13, 45, 1, 58, 0, 46, 1, 45, 1,
  ]
  expect(words).toHaveLength(19)
  const disarmed = scaffoldExceptionFinally(words)
  expect(disarmed.ok, disarmed.diagnostic?.message).toBe(true)
  const { result } = disarmed
  expect(deepFrozen(result)).toBe(true)
  expect(result.jumpRegChecks).toEqual([
    {
      functionId: 0,
      pc: 13,
      sourceRegister: { kind: 'register', index: 0 },
      // The setup reaches its finalizer with the throw-pad continuation (the try unit).
      targets: [15, 17],
      finalizer: 'finally@0',
      finite: true,
      sameFunction: true,
      continuationRegister: { kind: 'register', index: 0 },
      instructionName: 'JUMP_REG',
    },
  ])
  const before = new Map(
    result.instructionStates.map(({ pc, handlerStateBefore }) => [
      pc,
      handlerStateBefore &&
        handlerStateBefore.finallyStack.map(({ setupPc }) => setupPc),
    ]),
  )
  expect(Object.fromEntries(before)).toEqual({
    0: [],
    5: [0],
    8: [0],
    9: [],
    11: null,
    13: [],
    15: [],
    17: [],
  })
  expect(
    result.completionRoutes.map(({ kind, sourcePc, route }) => [
      kind,
      sourcePc,
      route,
    ]),
  ).toEqual([
    ['finally', 0, 'exceptional'],
    ['throw', 15, 'propagate'],
    ['return', 17, 'propagate'],
    ['finally', 9, 'normal'],
  ])
})
