import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { buildControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import {
  buildCallFrames,
  diagnoseCallFrames,
} from '../../../src/vm/jsconfuser-vm/build-call-frames.js'

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
  return { container, wordcode, references, functions, cfg }
}

function frameAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnoseCallFrames(
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

test('materializes the pinned frame layout and root completion', () => {
  const packet = frameAt('test/vm/jsconfuser-vm/fixtures/reference/encoded.js')

  expect(packet.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-call-frames.v1',
    encoding: 'numeric-u32',
    wordCount: 32,
    instructionCount: 9,
    functionCount: 1,
    frame: {
      frameStart: 1,
      headerSize: 8,
      slots: {
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
    frames: [
      {
        functionId: 0,
        frameBase: 1,
        frameSize: 15,
        registerBaseOffset: 8,
        registerWindow: { start: 8, end: 15 },
      },
    ],
  })
  expect(packet.result.returns).toEqual([
    {
      pc: 30,
      sourceRegister: { kind: 'register', index: 2 },
      reachable: true,
      routes: [
        expect.objectContaining({
          kind: 'return',
          sourcePc: 30,
          targetPc: null,
          route: 'propagate',
        }),
      ],
      callerDestinations: [],
    },
  ])
})

test('resolves closure call provenance through return values and MOVE', () => {
  const packet = frameAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-closures-state/encoded.js',
  )

  expect(
    packet.result.callSites.map(({ pc, calleeFunctions }) => [
      pc,
      calleeFunctions,
    ]),
  ).toEqual([
    [12, [1]],
    [27, [2]],
    [31, [2]],
    [35, [2]],
  ])
  expect(
    packet.result.functions
      .find(({ id }) => id === 2)
      .returns.map((record) => ({
        pc: record.pc,
        callers: record.callerDestinations.map(({ callSitePc }) => callSitePc),
      })),
  ).toEqual([
    { pc: 103, callers: [27, 31, 35] },
    { pc: 109, callers: [27, 31, 35] },
  ])
  expect(
    packet.result.callSites.every(
      ({ exceptionalCompletion }) => exceptionalCompletion !== null,
    ),
  ).toBe(true)
})

test('preserves method receivers, constructor state, and spread arrays', () => {
  const method = frameAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-call-method-spread/encoded.js',
  )
  const methodSpread = method.result.callSites.find(
    ({ kind, arguments: args }) =>
      kind === 'CALL_METHOD' && args.kind === 'spread',
  )
  expect(methodSpread).toMatchObject({
    receiver: { kind: 'register' },
    arguments: { kind: 'spread', arrayRegister: { kind: 'register' } },
    constructorState: { isConstructor: false, mode: 'ordinary' },
  })

  const constructor = frameAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-new-spread/encoded.js',
  )
  const newSpread = constructor.result.callSites.find(
    ({ kind, arguments: args }) => kind === 'NEW' && args.kind === 'spread',
  )
  expect(newSpread).toMatchObject({
    constructorState: { isConstructor: true, mode: 'allocate-this' },
    arguments: { kind: 'spread', arrayRegister: { kind: 'register' } },
  })
})

test('accepts every stripped raw and focused corpus call-frame packet', () => {
  const paths = [
    'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
    ...corpusPaths(),
  ]
  expect(paths).toHaveLength(38)
  for (const relativePath of paths) {
    const packet = frameAt(relativePath)
    const expectedCalls = packet.wordcode.instructions.filter(({ name }) =>
      ['CALL', 'CALL_METHOD', 'NEW'].includes(name),
    )
    expect(packet.result.callSites).toHaveLength(expectedCalls.length)
    expect(packet.result.functions).toHaveLength(packet.result.functionCount)
    expect(packet.result.source).toEqual({
      wordcodeSchema: 'jsconfuser-vm-wordcode.v1',
      referencesSchema: 'jsconfuser-vm-references.v1',
      functionsSchema: 'jsconfuser-vm-functions.v1',
      cfgSchema: 'jsconfuser-vm-cfg.v1',
    })
  }
})

test('retains dynamic host calls without inventing internal targets', () => {
  const packet = frameAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-spread-order/encoded.js',
  )
  const hostCalls = packet.result.callSites.filter(
    ({ calleeFunctions }) => calleeFunctions.length === 0,
  )
  expect(hostCalls.length).toBeGreaterThan(0)
  expect(
    hostCalls.every(
      ({ continuationPc, returnDestination, exceptionalCompletion }) =>
        continuationPc !== null &&
        returnDestination.kind === 'register' &&
        exceptionalCompletion !== null,
    ),
  ).toBe(true)
})

test('does not mutate frozen predecessors and deeply freezes output', () => {
  const packet = packetAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/focused/focused-new-spread/encoded.js',
  )
  const before = structuredClone(packet)
  const result = buildCallFrames(
    packet.wordcode,
    packet.references,
    packet.functions,
    packet.cfg,
  )
  expect(result).not.toBeNull()
  expect(packet).toEqual(before)
  expect(deepFrozen(result)).toBe(true)
  expect(() => result.callSites.push({})).toThrow()
  expect(() => (result.frame.headerSize = 99)).toThrow()
})

// The synthetic worked example from the call-frame specification, on a private
// A cloned from the reference fixture. Function 1 returns function 2, but the
// call-result transfer at PC 7 reads fixed r2, so the returned-closure target
// at PC 11 is lost unless the callee happens to sit in r2.
test('pins the fixed-slot call-result lookup on the returned-closure scaffold', () => {
  const reference = extractContainerFromSource(
    sourceAt('test/vm/jsconfuser-vm/fixtures/reference/encoded.js'),
  )
  const words = [
    47, 4, 17, 0, 1, 0, 0, 42, 0, 4, 0, 42, 1, 0, 0, 45, 1, 47, 0, 26, 0, 1, 0,
    0, 45, 0, 1, 0, 7, 45, 0,
  ]
  const frames = (values) => {
    const container = structuredClone(reference)
    container.roles.words.values = values
    container.roles.scalars.MAIN_REG_COUNT.value = 5
    container.roles.pool.values = []
    const wordcode = readWordcode(container)
    expect(wordcode).not.toBeNull()
    const references = validateReferences(container, wordcode)
    expect(references).not.toBeNull()
    const functions = partitionFunctions(container, wordcode, references)
    expect(functions).not.toBeNull()
    const cfg = buildControlFlow(wordcode, references, functions)
    expect(cfg).not.toBeNull()
    expect(
      functions.functions.map(({ startPc, endPc, parentFunctionId }) => [
        startPc,
        endPc,
        parentFunctionId,
      ]),
    ).toEqual([
      [0, 17, null],
      [17, 26, 0],
      [26, 31, 1],
    ])
    const supplied = JSON.stringify([
      container,
      wordcode,
      references,
      functions,
      cfg,
    ])
    const diagnosis = diagnoseCallFrames(wordcode, references, functions, cfg)
    expect(
      JSON.stringify([container, wordcode, references, functions, cfg]),
    ).toBe(supplied)
    expect(diagnosis.ok, diagnosis.diagnostic?.message).toBe(true)
    return diagnosis.result.callSites.map(({ pc, callee, calleeFunctions }) => [
      pc,
      callee,
      calleeFunctions,
    ])
  }
  expect(words).toHaveLength(31)
  expect(frames(words)).toEqual([
    [7, { kind: 'register', index: 4 }, [1]],
    [11, { kind: 'register', index: 0 }, []],
  ])

  const calleeInR2 = [...words]
  calleeInR2[1] = 2
  calleeInR2[9] = 2
  expect(frames(calleeInR2)).toEqual([
    [7, { kind: 'register', index: 2 }, [1]],
    [11, { kind: 'register', index: 0 }, [2]],
  ])
})
