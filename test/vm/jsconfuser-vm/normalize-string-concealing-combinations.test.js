import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { readWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import {
  diagnoseFunctionPartition,
  partitionFunctions,
} from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { diagnoseNormalizeStringConcealing } from '../../../src/vm/jsconfuser-vm/normalize-string-concealing.js'
import { diagnoseNormalizeConcealedConstants } from '../../../src/vm/jsconfuser-vm/normalize-concealed-constants.js'
import { diagnoseNormalizeCffWordcode } from '../../../src/vm/jsconfuser-vm/normalize-cff-wordcode.js'
import { diagnoseNormalizeDispatcherWordcode } from '../../../src/vm/jsconfuser-vm/normalize-dispatcher-wordcode.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

function fixture(name, file) {
  return fs.readFileSync(
    new URL(`fixtures/${name}/${file}`, import.meta.url),
    'utf8',
  )
}

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, Buffer, performance: { now: () => 0 } },
    { timeout: 10000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

function withWords(encoded, words) {
  const original = encoded.match(/var BYTECODE = \[[\s\S]*?\];/)?.[0]
  expect(original).toBeDefined()
  return encoded.replace(original, `var BYTECODE = [${words.join(',')}];`)
}

test.each([
  'string-concealing-cff',
  'string-concealing-dispatcher',
  'string-concealing-nested-cff',
  'string-concealing-cff-dispatcher-exceptions',
  'string-concealing-cff-dispatcher-switch',
])('restores stacked string helpers in %s', (name) => {
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const record = JSON.parse(fixture(name, 'qualification.json'))
  const container = diagnoseContainer(encoded).result
  const wordcode = readWordcode(container)
  const references = validateReferences(container, wordcode)
  expect(partitionFunctions(container, wordcode, references)).toBeNull()
  expect(
    diagnoseNormalizeStringConcealing(container, wordcode, references).ok,
  ).toBe(false)
  const result = diagnoseStandalone(encoded)
  expect(result.ok).toBe(true)
  const output = parseSuccessfulOutput(result.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, result.result.output).ok).toBe(
    true,
  )
  expect(observe(source)).toEqual(observe(encoded))
  expect(observe(source)).toEqual(observe(result.result.output))
  expect(record.effectObservation).toMatchObject({
    axis: 'serialized-bytecode-components',
    observed: true,
    components: { stringConcealing: true },
  })
})

test.each(['string-concealing-cff', 'string-concealing-dispatcher'])(
  'declines an altered decoded helper in %s',
  (name) => {
    const encoded = fixture(name, 'encoded.js')
    const container = diagnoseContainer(encoded).result
    const wordcode = readWordcode(container)
    const decodeStart = wordcode.instructions.find(
      (item) =>
        item.name === 'MAKE_CLOSURE' && item.functionMeta.paramCount === 4,
    ).words[2]
    const helper = wordcode.instructions.find(
      (item) => item.pc > decodeStart && item.name === 'USHR',
    )
    expect(helper).toBeDefined()
    const changed = container.roles.words.values.slice()
    changed[helper.pc] = container.roles.op.values.BXOR
    expect(diagnoseStandalone(withWords(encoded, changed))).toMatchObject({
      ok: false,
      result: null,
    })
  },
)

test('restores a finalizer when CFF and dispatcher are stacked', () => {
  const name = 'cff-dispatcher-try-finally'
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const record = JSON.parse(fixture(name, 'qualification.json'))
  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(source)).toEqual(observe(encoded))
  expect(observe(source)).toEqual(observe(decoded.result.output))
  expect(record.effectObservation).toMatchObject({
    observed: true,
    components: { controlFlowFlattening: true, dispatcher: true },
  })
})

test('restores the signed Weyl increment after constant concealment', () => {
  const name = 'string-concealing-concealed-constants'
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const record = JSON.parse(fixture(name, 'qualification.json'))
  const container = diagnoseContainer(encoded).result
  const wordcode = readWordcode(container)
  const normalizedConstants = diagnoseNormalizeConcealedConstants(
    encoded,
    container,
    wordcode,
  )
  expect(normalizedConstants.ok).toBe(true)
  const plain = normalizedConstants.result.container
  const plainWordcode = readWordcode(plain)
  const references = validateReferences(plain, plainWordcode)
  expect(plain.roles.pool.values).toContain(-1640531527)
  expect(
    diagnoseNormalizeStringConcealing(plain, plainWordcode, references).ok,
  ).toBe(true)
  const changed = structuredClone(plain)
  changed.roles.pool.values[changed.roles.pool.values.indexOf(-1640531527)] += 1
  expect(
    diagnoseNormalizeStringConcealing(
      changed,
      readWordcode(changed),
      validateReferences(changed, readWordcode(changed)),
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: 'string-concealing-shape' },
  })

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(source)).toEqual(observe(encoded))
  expect(observe(source)).toEqual(observe(decoded.result.output))
  expect(record.effectObservation).toMatchObject({
    observed: true,
    components: { stringConcealing: true, concealConstants: true },
  })
})

test('restores strings and finalizer behavior through all four bytecode passes', () => {
  const name = 'string-concealing-cff-dispatcher-concealed-constants'
  const source = fixture(name, 'source.js')
  const encoded = fixture(name, 'encoded.js')
  const record = JSON.parse(fixture(name, 'qualification.json'))
  const container = diagnoseContainer(encoded).result
  const wordcode = readWordcode(container)
  const normalizedConstants = diagnoseNormalizeConcealedConstants(
    encoded,
    container,
    wordcode,
  )
  expect(normalizedConstants.ok).toBe(true)
  const plain = normalizedConstants.result.container
  const plainWordcode = readWordcode(plain)
  expect(
    partitionFunctions(
      plain,
      plainWordcode,
      validateReferences(plain, plainWordcode),
    ),
  ).toBeNull()
  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(source)).toEqual(observe(encoded))
  expect(observe(source)).toEqual(observe(decoded.result.output))
  expect(record.effectObservation).toMatchObject({
    observed: true,
    components: {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
    },
  })
})

test('keeps a live branch into the middle of a string site as a decline', () => {
  const encoded = fixture(
    'string-concealing-cff-dispatcher-exceptions',
    'encoded.js',
  )
  let container = diagnoseContainer(encoded).result
  for (const adapter of [
    diagnoseNormalizeDispatcherWordcode,
    diagnoseNormalizeCffWordcode,
  ]) {
    const wordcode = readWordcode(container)
    const references = validateReferences(container, wordcode)
    const counts = new Map()
    for (const descriptor of references.frame.descriptors) {
      if (descriptor.paramCount !== 4 || descriptor.captureCount !== 0) continue
      counts.set(descriptor.startPc, (counts.get(descriptor.startPc) ?? 0) + 1)
    }
    const options = {
      allowSharedParentStarts: new Set(
        [...counts].filter(([, count]) => count > 1).map(([pc]) => pc),
      ),
      deferControlFlow: adapter === diagnoseNormalizeDispatcherWordcode,
    }
    const partition = diagnoseFunctionPartition(
      container,
      wordcode,
      references,
      options,
    )
    expect(partition.ok).toBe(true)
    const prepared = adapter(container, wordcode, partition.result, options)
    expect(prepared.ok).toBe(true)
    container = prepared.result.container
  }
  const wordcode = readWordcode(container)
  const references = validateReferences(container, wordcode)
  expect(
    diagnoseNormalizeStringConcealing(container, wordcode, references).ok,
  ).toBe(true)
  const partition = diagnoseFunctionPartition(container, wordcode, references, {
    allowSharedParentStarts: new Set(
      references.frame.descriptors
        .filter((item) => item.paramCount === 4 && item.captureCount === 0)
        .map((item) => item.startPc),
    ),
  }).result
  const body = wordcode.instructions.filter(
    (item) =>
      item.pc >= partition.functions[1].startPc &&
      item.pc < partition.functions[1].endPc,
  )
  // A site's three loads run straight into its call, directly or through a kept jump.
  const callAt = (item) =>
    item?.name === 'JUMP'
      ? body.find((target) => target.pc === item.words[1])
      : item
  const loads = body.findIndex(
    (item, index) =>
      body.slice(index, index + 3).every((load) => load.name === 'LOAD_INT') &&
      callAt(body[index + 3])?.name === 'CALL' &&
      callAt(body[index + 3]).words[3] === 4,
  )
  expect(loads).toBeGreaterThan(-1)
  const thirdLoad = body[loads + 2]
  const branch = body.find((item) => item.name === 'JUMP_IF_FALSE')
  expect(branch).toBeDefined()
  const damaged = structuredClone(container)
  damaged.roles.words.values[branch.pc + 2] = thirdLoad.pc
  const changedWordcode = readWordcode(damaged)
  const changedReferences = validateReferences(damaged, changedWordcode)
  expect(
    diagnoseNormalizeStringConcealing(
      damaged,
      changedWordcode,
      changedReferences,
    ),
  ).toMatchObject({
    ok: false,
    diagnostic: { code: 'string-concealing-shape' },
  })
})
