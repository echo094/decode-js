import fs from 'node:fs'
import { expect, test } from 'vitest'
import { diagnoseAntiRuntime } from '../../../src/vm/jsconfuser-vm/analyze-anti-runtime.js'
import { diagnoseAntiRegisterFlow } from '../../../src/vm/jsconfuser-vm/analyze-anti-register-flow.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseAntiWordStream } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'

function fixture(name) {
  return fs.readFileSync(
    new URL(`fixtures/${name}/encoded.js`, import.meta.url),
    'utf8',
  )
}

function observed(name) {
  const source = fixture(name)
  const packetA = diagnoseContainer(source).result
  const runtime = diagnoseAntiRuntime(source).result
  expect(packetA).not.toBeNull()
  expect(runtime).not.toBeNull()
  return { packetA, runtime }
}

test('identifies real steps from closed fake register flow', () => {
  const { packetA, runtime } = observed('anti-runtime-boot')
  const result = diagnoseAntiRegisterFlow(packetA, runtime)
  expect(result).toMatchObject({
    ok: true,
    diagnostic: null,
    result: {
      schemaVersion: 'jsconfuser-vm-anti-register-flow-observation.v1',
      functionCount: 1,
      fusedFunctionCount: 1,
      realSteps: [
        { opcode: 61, index: 2, name: 'MUL' },
        { opcode: 62, index: 2, name: 'ADD' },
        { opcode: 63, index: 2, name: 'MOD' },
      ],
    },
  })
  expect(Object.isFrozen(result.result.realSteps)).toBe(true)
})

test('selects the real ADD when a synthetic handler has two ADD steps', () => {
  const { packetA, runtime } = observed('anti-runtime-duplicate-step')
  const result = diagnoseAntiRegisterFlow(packetA, runtime)
  expect(result.result.realSteps).toEqual([
    { opcode: 61, index: 0, name: 'MUL' },
    { opcode: 62, index: 0, name: 'ADD' },
    { opcode: 63, index: 2, name: 'MOD' },
  ])
})

test('declines cross-pool fake writes, changed fake jumps, and damaged seeds', () => {
  const boot = observed('anti-runtime-boot')
  const bootStream = diagnoseAntiWordStream(boot.packetA, boot.runtime).result
  const case61 = bootStream.instructions.find(
    ({ opcode }) => opcode.value === 61,
  )
  const crossPool = structuredClone(boot.packetA)
  const storedPosition = boot.runtime.syntheticCases[0].canonicalToStored[0]
  crossPool.roles.words.values[case61.pc + 1 + storedPosition] = 8
  expect(diagnoseAntiRegisterFlow(crossPool, boot.runtime)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'register-isolation' },
  })

  const duplicate = observed('anti-runtime-duplicate-step')
  const duplicateStream = diagnoseAntiWordStream(
    duplicate.packetA,
    duplicate.runtime,
  ).result
  const case62 = duplicateStream.instructions.find(
    ({ opcode }) => opcode.value === 62,
  )
  const jump = structuredClone(duplicate.packetA)
  const jumpCanonical =
    duplicate.runtime.syntheticCases[1].steps[1].operandStart + 1
  const jumpStored =
    duplicate.runtime.syntheticCases[1].canonicalToStored[jumpCanonical]
  jump.roles.words.values[case62.pc + 1 + jumpStored] = case62.nextPc + 1
  expect(diagnoseAntiRegisterFlow(jump, duplicate.runtime)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'register-isolation' },
  })

  const case63 = duplicateStream.instructions.find(
    ({ opcode }) => opcode.value === 63,
  )
  const fakeConstant = structuredClone(duplicate.packetA)
  const constantStored =
    duplicate.runtime.syntheticCases[2].canonicalToStored[1]
  fakeConstant.roles.words.values[case63.pc + 1 + constantStored] = 6
  expect(
    diagnoseAntiRegisterFlow(fakeConstant, duplicate.runtime),
  ).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'register-isolation' },
  })

  const seed = structuredClone(boot.packetA)
  seed.roles.words.values[1] = 8
  expect(diagnoseAntiRegisterFlow(seed, boot.runtime)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'register-isolation' },
  })
})

// Pins the historical FOR_IN_NEXT word tags as the flow consumer reads them:
// the iterator operand is checked as a direct target and the exit operand is not.
test('reads appended FOR_IN_NEXT operands with their historical tags', () => {
  const lines = fixture('anti-runtime-boot').split('\n')
  const line = lines.findIndex((text) => text.startsWith('var BYTECODE = ['))
  const words = JSON.parse(
    lines[line].slice('var BYTECODE = '.length).replace(/;\s*$/, ''),
  )
  const flow = (iter, exit) => {
    const changed = [...lines]
    changed[line] = `var BYTECODE = ${JSON.stringify([
      ...words,
      ...[53, 0, iter, exit, 45, 0],
    ])};`
    const source = changed.join('\n')
    const packetA = diagnoseContainer(source)
    const runtime = diagnoseAntiRuntime(source)
    expect(packetA.ok).toBe(true)
    expect(runtime.ok).toBe(true)
    return diagnoseAntiRegisterFlow(packetA.result, runtime.result)
  }
  expect(flow(1, 87)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: {
      code: 'function-boundary',
      message: 'Direct target crosses a function interval',
    },
  })
  expect(flow(0, 87).ok).toBe(true)
  expect(flow(0, 1).ok).toBe(true)
})
