import fs from 'node:fs'
import { expect, test } from 'vitest'
import { extractContainerFromSource } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { partitionFunctions } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { buildControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { buildCallFrames } from '../../../src/vm/jsconfuser-vm/build-call-frames.js'
import { diagnoseClosureLifetimes } from '../../../src/vm/jsconfuser-vm/analyze-closure-lifetimes.js'

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

function resultAt(relativePath) {
  const packet = packetAt(relativePath)
  const diagnosis = diagnoseClosureLifetimes(
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

test('identifies a local capture, owner return close, and closed child uses', () => {
  const packet = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-closures-state/encoded.js',
  )
  const predecessorSnapshot = JSON.stringify(packet)
  const pair = packet.result.capturePairs.find(
    ({ id }) => id === 'capture:1:64:0',
  )
  expect(pair).toMatchObject({
    source: {
      kind: 'local',
      parentFunctionId: 1,
      register: { kind: 'register', index: 2 },
    },
    bindingId: 'binding:1:register:2',
    childFunctionId: 2,
  })
  const binding = packet.result.bindings.find(
    ({ id }) => id === 'binding:1:register:2',
  )
  expect(binding.lifecycle).toMatchObject({
    initialState: 'open-upvalue',
    afterCloseState: 'closed-captured-value',
    runtimeIdentity: 'owner-function-register-slot',
  })
  expect(binding.lifecycle.closeEvents).toEqual([
    expect.objectContaining({
      functionId: 1,
      sourcePc: 73,
      completion: 'return',
    }),
  ])
  expect(packet.result.uses).toEqual([
    expect.objectContaining({ pc: 83, operation: 'read', state: 'closed' }),
    expect.objectContaining({ pc: 97, operation: 'write', state: 'closed' }),
    expect.objectContaining({ pc: 100, operation: 'read', state: 'closed' }),
  ])
  expect(
    packet.result.closureSites.find(({ id }) => id === 'closure:1:64')
      .escapeEvents,
  ).toContainEqual(
    expect.objectContaining({
      kind: 'return',
      functionId: 1,
      pc: 73,
      provenEscape: true,
    }),
  )
  expect(deepFrozen(packet.result)).toBe(true)
  expect(JSON.stringify(packet)).toBe(predecessorSnapshot)
})

test('resolves nested upvalue pairs to an ancestor binding identity', () => {
  const packet = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/program-cash/encoded.js',
  )
  const pair = packet.result.capturePairs.find(
    ({ source }) => source.kind === 'upvalue',
  )
  expect(pair).toBeDefined()
  expect(pair.source.parentFunctionId).not.toBe(pair.bindingOwnerFunctionId)
  expect(pair.bindingId).toBe(
    `binding:${pair.bindingOwnerFunctionId}:register:${pair.bindingRegister.index}`,
  )
  expect(
    packet.result.uses.filter(({ bindingId }) => bindingId === pair.bindingId),
  ).not.toHaveLength(0)
  expect(packet.result.capturePairCount).toBe(531)
  expect(packet.result.uses).toHaveLength(451)
})

test('records host use without inventing an internal closure target', () => {
  const packet = resultAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-arrow-lexical-state/encoded.js',
  )
  const hostUse = packet.result.closureSites
    .find(({ id }) => id === 'closure:0:14')
    .escapeEvents.find(({ kind }) => kind === 'external-call-receiver')
  expect(hostUse).toMatchObject({
    provenEscape: false,
    targetFunctions: [],
  })
  expect(
    packet.result.closureSites.find(({ id }) => id === 'closure:1:158')
      .escapeEvents,
  ).toContainEqual(
    expect.objectContaining({ kind: 'return', provenEscape: true }),
  )
})

test('accepts every complete stripped raw and focused corpus packet', () => {
  const paths = [
    'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
    ...corpusPaths(),
  ]
  expect(paths).toHaveLength(38)
  for (const relativePath of paths) {
    const packet = resultAt(relativePath)
    expect(packet.result.capturePairCount).toBe(
      packet.result.capturePairs.length,
    )
    expect(packet.result.bindingCount).toBe(packet.result.bindings.length)
    expect(packet.result.closureSiteCount).toBe(
      packet.result.closureSites.length,
    )
    expect(deepFrozen(packet.result)).toBe(true)
  }
})

// The private-record scaffold of the call-frame specification: an A cloned
// from the reference fixture with only its words, root register count and
// pool replaced, B-F rebuilt, and G run against unchanged predecessors.
function scaffoldLifetimes(words, regCount, pool) {
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
  const callFrames = buildCallFrames(wordcode, references, functions, cfg)
  expect(callFrames).not.toBeNull()
  const packet = [container, wordcode, references, functions, cfg, callFrames]
  const supplied = JSON.stringify(packet)
  const diagnosis = diagnoseClosureLifetimes(
    wordcode,
    references,
    functions,
    cfg,
    callFrames,
  )
  expect(JSON.stringify(packet)).toBe(supplied)
  expect(diagnosis.ok, diagnosis.diagnostic?.message).toBe(true)
  expect(deepFrozen(diagnosis.result)).toBe(true)
  return { callFrames, result: diagnosis.result }
}

// G4: CALL_METHOD at PC 18 has destination r0 and receiver r4, and the
// receiver event follows the destination's closure. Moving the receiver to r0
// leaves that assignment unchanged, so the lookup reads the destination.
test('pins the receiver event on the destination closure in the G4 scaffold', () => {
  const words = [
    47, 0, 25, 0, 1, 0, 0, 47, 4, 25, 0, 1, 0, 0, 2, 3, 0, 0, 43, 0, 4, 3, 0,
    45, 0, 1, 0, 0, 45, 0,
  ]
  const lifetimes = (values) => {
    const { callFrames, result } = scaffoldLifetimes(values, 5, ['fn'])
    const callSite = callFrames.callSites.find(({ pc }) => pc === 18)
    return {
      call: [callSite.destination.index, callSite.receiver.index],
      events: result.closureSites.map(({ id, escapeEvents }) => [
        id,
        escapeEvents.map(({ kind, pc }) => [kind, pc]),
      ]),
    }
  }
  const events = [
    ['closure:0:0', [['external-call-receiver', 18]]],
    ['closure:0:7', []],
  ]
  expect(words).toHaveLength(30)
  expect(lifetimes(words)).toEqual({ call: [0, 4], events })

  const receiverInR0 = [...words]
  receiverInR0[20] = 0
  expect(lifetimes(receiverInR0)).toEqual({ call: [0, 0], events })
})

// G6: CALL at PC 23 passes captured closure:0:3 alongside r5. While r5 is an
// imprecise LOAD_GLOBAL the joined argument suppresses the site's event and the
// child's upvalue read falls back to closed; a precise LOAD_CONST restores both.
test('pins argument aggregation and its use-state fallback in the G6 scaffold', () => {
  const words = [
    1, 0, 7, 47, 1, 31, 0, 1, 1, 0, 1, 0, 47, 2, 36, 0, 1, 0, 0, 2, 5, 0, 0, 42,
    3, 2, 2, 1, 5, 45, 0, 3, 0, 0, 45, 0, 1, 0, 0, 45, 0,
  ]
  const lifetimes = (values) => {
    const { callFrames, result } = scaffoldLifetimes(values, 6, ['unknown'])
    expect(
      callFrames.callSites.map(({ pc, calleeFunctions }) => [
        pc,
        calleeFunctions,
      ]),
    ).toEqual([[23, [2]]])
    expect(result.bindings).toHaveLength(1)
    expect(result.bindings[0].lifecycle).toMatchObject({
      initialState: 'open-upvalue',
      afterCloseState: 'closed-captured-value',
    })
    expect(result.uses).toHaveLength(1)
    const [use] = result.uses
    return {
      events: result.closureSites
        .find(({ id }) => id === 'closure:0:3')
        .escapeEvents.filter(({ kind }) => kind === 'internal-call-argument'),
      use: [use.pc, use.state, use.possibleStates],
    }
  }
  expect(words).toHaveLength(41)
  expect(lifetimes(words)).toEqual({
    events: [],
    use: [31, 'closed', ['closed']],
  })

  const preciseArgument = [...words]
  preciseArgument[19] = 0 // LOAD_CONST replaces LOAD_GLOBAL
  expect(lifetimes(preciseArgument)).toEqual({
    events: [
      {
        kind: 'internal-call-argument',
        functionId: 0,
        pc: 23,
        provenEscape: false,
        targetFunctions: [2],
      },
    ],
    use: [31, 'open', ['open']],
  })
})
