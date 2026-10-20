import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { buildControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { buildCallFrames } from '../../../src/vm/jsconfuser-vm/build-call-frames.js'
import { analyzeClosureLifetimes } from '../../../src/vm/jsconfuser-vm/analyze-closure-lifetimes.js'
import {
  diagnoseCallCompletion,
  emitCallCompletion,
} from '../../../src/vm/jsconfuser-vm/emit-call-completion.js'

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
  const closureLifetimes = analyzeClosureLifetimes(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  expect(closureLifetimes, `Packet G declined ${relativePath}`).not.toBeNull()
  return {
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
    closureLifetimes,
  }
}

function resultAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnoseCallCompletion(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
    packet.callFrames,
    packet.closureLifetimes,
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

const referenceCase = 'test/vm/jsconfuser-vm/fixtures/reference/encoded.js'
const methodCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js'
const newCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-new-spread/encoded.js'
const closureCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-closures-state/encoded.js'
const throwCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-throw-catch/encoded.js'
const abruptCase =
  'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-finally-abrupt/encoded.js'

test('emits exact all-instruction coverage and the reference completion boundary', () => {
  const packet = resultAt(referenceCase)
  expect(packet.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-call-completion.v1',
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
    opcodeScope: {
      family: 'L-call-receiver-construction-completion',
      count: 5,
    },
  })
  expect(packet.result.calls).toHaveLength(0)
  expect(packet.result.returns).toHaveLength(1)
  expect(packet.result.throws).toHaveLength(0)
  expect(packet.result.instructions).toHaveLength(9)
  expect(packet.result.coverage).toMatchObject({
    instructions: { expected: 9, emitted: 9, unique: true, complete: true },
    calls: { expected: 0, emitted: 0, unique: true, complete: true },
    completions: { expected: 1, emitted: 1, unique: true, complete: true },
    completionRoutes: { unique: true, complete: true },
  })
  expect(packet.result.returns[0]).toMatchObject({
    pc: 30,
    sourceRegister: { kind: 'register', index: 2 },
    reachable: true,
    semanticBoundary: 'later-packet',
  })
  expect(packet.result.returns[0].routes).toHaveLength(1)
  expect(deepFrozen(packet.result)).toBe(true)
})

test('preserves plain, method, and constructor call grammar exactly', () => {
  const method = resultAt(methodCase)
  const methodCalls = method.result.calls
  expect(methodCalls.map(({ name }) => name)).toEqual([
    'CALL_METHOD',
    'CALL_METHOD',
  ])
  expect(methodCalls[0]).toMatchObject({
    pc: 58,
    width: 6,
    receiver: { kind: 'register', index: 4 },
    callee: { kind: 'register', index: 7 },
    grammar: {
      kind: 'fixed',
      argcWord: 1,
      count: 1,
      sentinel: null,
    },
    receiverPreservation: {
      kind: 'call-method-this-argument',
      register: { kind: 'register', index: 4 },
    },
    evaluationOrder: {
      roles: ['receiver', 'callee', 'argument-count', 'argument[0]'],
    },
  })
  expect(methodCalls[1]).toMatchObject({
    pc: 64,
    width: 6,
    grammar: {
      kind: 'spread',
      argcWord: 65535,
      sentinel: 65535,
      arrayRegister: { kind: 'register', index: 6 },
      payloadWords: [6],
    },
    arguments: {
      kind: 'spread',
      arrayRegister: { kind: 'register', index: 6 },
    },
  })

  const constructor = resultAt(newCase)
  const newCall = constructor.result.calls.find(({ name }) => name === 'NEW')
  expect(newCall).toMatchObject({
    pc: 45,
    width: 5,
    receiver: null,
    grammar: {
      kind: 'spread',
      argcWord: 65535,
      sentinel: 65535,
      arrayRegister: { kind: 'register', index: 6 },
      payloadWords: [6],
    },
    target: { kind: 'internal-closure', functionIds: [1] },
    constructorState: { isConstructor: true, mode: 'allocate-this' },
    construction: {
      kind: 'new-construction',
      allocationMode: 'allocate-this',
      returnRule: 'explicit-object-or-allocated-this',
    },
  })
  expect(newCall.evaluationOrder.roles).toEqual([
    'callee',
    'argument-count',
    'spread-array',
  ])
})

test('preserves internal/host call targets and closure owner facts', () => {
  const internal = resultAt(closureCase)
  expect(internal.result.calls.map(({ target }) => target.kind)).toEqual([
    'internal-closure',
    'internal-closure',
    'internal-closure',
    'internal-closure',
  ])
  expect(internal.result.calls[1].target).toMatchObject({
    functionIds: [2],
    closureSiteIds: ['closure:1:64'],
  })
  expect(internal.result.ownerFacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        functionId: 1,
        parentFunctionId: 0,
        closureSiteIds: ['closure:1:64'],
      }),
    ]),
  )
  expect(internal.result.closureLifetimes.bindings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'binding:1:register:2',
        lifecycle: expect.objectContaining({
          initialState: 'open-upvalue',
          afterCloseState: 'closed-captured-value',
        }),
      }),
    ]),
  )

  const host = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-spread-order/encoded.js',
  )
  expect(
    host.result.calls.some(({ target }) => target.kind === 'host-or-dynamic'),
  ).toBe(true)
  expect(
    host.result.calls
      .filter(({ target }) => target.kind === 'host-or-dynamic')
      .every(({ target }) => target.functionIds.length === 0),
  ).toBe(true)
})

test('retains reachable and unreachable return/throw records with routes', () => {
  const abrupt = resultAt(abruptCase)
  expect(abrupt.result.returns.length).toBeGreaterThan(0)
  expect(abrupt.result.throws.length).toBeGreaterThan(0)
  expect(abrupt.result.returns.some(({ reachable }) => !reachable)).toBe(true)
  expect(abrupt.result.throws.every(({ routes }) => routes.length > 0)).toBe(
    true,
  )
  expect(
    abrupt.result.completionRoutes.some(({ kind }) => kind === 'finally'),
  ).toBe(true)
  expect(
    abrupt.result.calls.some(
      ({ completion }) => completion.exceptional?.kind === 'finally',
    ),
  ).toBe(true)

  const throws = resultAt(throwCase)
  expect(throws.result.throws.map(({ pc }) => pc)).toEqual([15, 68, 137])
  expect(throws.result.throws[0]).toMatchObject({
    payloadRegister: { kind: 'register', index: 4 },
    reachable: true,
    routes: [
      {
        kind: 'handler',
        route: 'exceptional',
        payload: { throwRegister: 4 },
      },
    ],
  })
})

test('accepts every reference, raw, and focused input with exact L census', () => {
  const paths = [referenceCase, ...corpusPaths()]
  expect(paths).toHaveLength(38)
  for (const relativePath of paths) {
    const { result } = resultAt(relativePath)
    expect(result.coverage.instructions).toMatchObject({
      expected: result.instructionCount,
      emitted: result.instructionCount,
      unique: true,
      complete: true,
    })
    expect(result.coverage.calls).toMatchObject({
      unique: true,
      complete: true,
    })
    expect(result.coverage.completions).toMatchObject({
      unique: true,
      complete: true,
    })
    expect(result.coverage.completionRoutes).toMatchObject({
      unique: true,
      complete: true,
    })
    expect(result.census.dropped).toEqual([])
    expect(result.census.duplicated).toEqual([])
    expect(result.coverage.instructions.complete).toBe(true)
  }
})

test('does not mutate inputs and deeply freezes results and diagnoses', () => {
  const packet = packetAt(methodCase)
  const before = structuredClone(packet)
  const result = emitCallCompletion(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
    packet.callFrames,
    packet.closureLifetimes,
  )
  expect(result).not.toBeNull()
  expect(deepFrozen(result)).toBe(true)
  expect(packet).toEqual(before)
  expect(() => result.calls.push({})).toThrow()
  expect(() => {
    result.calls[0].width = 99
  }).toThrow()
})
