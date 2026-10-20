import fs from 'node:fs'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { expect, test } from 'vitest'
import { diagnoseAntiRuntime } from '../../../src/vm/jsconfuser-vm/analyze-anti-runtime.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import {
  diagnoseAntiWordStream,
  diagnoseWordcode,
} from '../../../src/vm/jsconfuser-vm/read-wordcode.js'

const fixture = fs.readFileSync(
  new URL('fixtures/anti-runtime-boot/encoded.js', import.meta.url),
  'utf8',
)
const duplicateStepFixture = fs.readFileSync(
  new URL('fixtures/anti-runtime-duplicate-step/encoded.js', import.meta.url),
  'utf8',
)

function parsed() {
  return parse(fixture, {
    sourceType: 'script',
    allowReturnOutsideFunction: true,
  })
}

function syntheticCase(ast, opcode) {
  let found = null
  traverse(ast, {
    SwitchCase(path) {
      if (path.node.test?.value !== opcode) return
      found = path.node
      path.stop()
    },
  })
  return found
}

test('observes the connected synthetic operand permutations without Packet B admission', () => {
  const observation = diagnoseAntiRuntime(fixture)
  expect(observation).toMatchObject({
    ok: true,
    diagnostic: null,
    result: {
      schemaVersion: 'jsconfuser-vm-anti-runtime-observation.v1',
      syntheticCases: [
        { opcode: 61, arity: 13 },
        { opcode: 62, arity: 15 },
        { opcode: 63, arity: 8 },
      ],
    },
  })
  expect(observation.result.syntheticCases[0].canonicalToStored).toEqual([
    4, 7, 6, 0, 9, 11, 1, 5, 2, 12, 10, 3, 8,
  ])
  expect(observation.result.syntheticCases[0].steps).toEqual([
    { name: 'NEQ', operandStart: 0, operandCount: 3 },
    { name: 'ADD', operandStart: 3, operandCount: 3 },
    { name: 'MUL', operandStart: 6, operandCount: 3 },
    { name: 'BUILD_OBJECT', operandStart: 9, operandCount: 4 },
  ])
  expect(Object.isFrozen(observation.result.syntheticCases[0])).toBe(true)
  const packetA = diagnoseContainer(fixture)
  expect(packetA.ok).toBe(true)
  expect(diagnoseWordcode(packetA.result)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'unknown-opcode' },
  })
})

test('segments repeated operator steps without selecting a real step', () => {
  const observation = diagnoseAntiRuntime(duplicateStepFixture)
  expect(observation.ok).toBe(true)
  expect(
    observation.result.syntheticCases.find(({ opcode }) => opcode === 62).steps,
  ).toEqual([
    { name: 'ADD', operandStart: 0, operandCount: 3 },
    { name: 'JUMP_IF_TRUE', operandStart: 3, operandCount: 2 },
    { name: 'ADD', operandStart: 5, operandCount: 3 },
  ])
})

test('reads synthetic words at exact PCs and restores each step operand span', () => {
  for (const source of [fixture, duplicateStepFixture]) {
    const observation = diagnoseAntiRuntime(source)
    const container = diagnoseContainer(source)
    expect(observation.ok).toBe(true)
    expect(container.ok).toBe(true)
    const read = diagnoseAntiWordStream(container.result, observation.result)
    expect(read.ok).toBe(true)
    const { instructions, wordCount } = read.result
    expect(instructions[0].pc).toBe(0)
    expect(instructions.at(-1).nextPc).toBe(wordCount)
    expect(
      instructions.every(
        (instruction, index) =>
          instruction.nextPc === instruction.pc + instruction.width &&
          (index === 0 || instructions[index - 1].nextPc === instruction.pc),
      ),
    ).toBe(true)
    const synthetic = instructions.filter(({ name }) => name === 'SYNTHETIC')
    expect(synthetic.length).toBeGreaterThan(0)
    for (const instruction of synthetic) {
      const metadata = observation.result.syntheticCases.find(
        ({ opcode }) => opcode === instruction.opcode.value,
      )
      expect(instruction.width).toBe(metadata.arity + 1)
      expect(instruction.canonicalOperands).toEqual(
        metadata.canonicalToStored.map((index) => instruction.words[index + 1]),
      )
      expect(instruction.steps.flatMap(({ words }) => words)).toEqual(
        instruction.canonicalOperands,
      )
    }
    expect(Object.isFrozen(synthetic[0].steps[0].words)).toBe(true)
    expect(diagnoseWordcode(container.result).diagnostic.code).toBe(
      'unknown-opcode',
    )
  }
})

test.each(['truncated-instruction', 'unknown-opcode'])(
  'declines source-reachable synthetic word damage at %s',
  (code) => {
    const runtime = diagnoseAntiRuntime(fixture).result
    const container = diagnoseContainer(fixture).result
    const stream = diagnoseAntiWordStream(container, runtime).result
    const first = stream.instructions.find(({ name }) => name === 'SYNTHETIC')
    const original = container.roles.words.values
    const words = original.slice()
    if (code === 'truncated-instruction') words.length = first.pc + 2
    else words[first.pc] = 65534
    const ast = parsed()
    traverse(ast, {
      VariableDeclarator(path) {
        // The words variable: the array literal holding A's words.
        const values = path.node.init?.elements?.map((node) => node?.value)
        if (JSON.stringify(values) !== JSON.stringify(original)) return
        path.node.init.elements = words.map((value) => ({
          type: 'NumericLiteral',
          value,
        }))
        path.stop()
      },
    })
    const damaged = generate(ast).code
    const observed = diagnoseAntiRuntime(damaged)
    const admitted = diagnoseContainer(damaged)
    expect(observed.ok).toBe(true)
    expect(admitted.ok).toBe(true)
    expect(admitted.result.roles.words.values).toEqual(words)
    expect(
      diagnoseAntiWordStream(admitted.result, observed.result),
    ).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code },
    })
    expect(diagnoseStandalone(damaged)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'wordcode-declined' },
    })
  },
)

test('declines altered synthetic operand reads and permutations atomically', () => {
  const duplicatePermutation = parsed()
  const case61 = syntheticCase(duplicatePermutation, 61)
  case61.consequent[0].body[1].declarations[0].init.elements[1].property.value =
    case61.consequent[0].body[1].declarations[0].init.elements[0].property.value

  const changedRead = parsed()
  syntheticCase(
    changedRead,
    61,
  ).consequent[0].body[0].declarations[0].init.elements[0] = {
    type: 'NumericLiteral',
    value: 0,
  }

  const duplicateUse = parsed()
  traverse(duplicateUse, {
    SwitchCase(path) {
      if (path.node.test?.value !== 61) return
      path.traverse({
        MemberExpression(inner) {
          if (
            inner.node.object?.name !== '_operands' ||
            inner.node.property?.value !== 1
          ) {
            return
          }
          inner.node.property.value = 0
          inner.stop()
        },
      })
      path.stop()
    },
  })

  const missingOpcode = parsed()
  syntheticCase(missingOpcode, 62).test.value = 67

  // Opcodes are named by what their handlers do, never by their values: a moved synthetic label
  // leaves the words that use it without a handler, so only the decode declines.
  expect(diagnoseStandalone(generate(missingOpcode).code)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
  for (const ast of [duplicatePermutation, changedRead, duplicateUse]) {
    expect(diagnoseAntiRuntime(ast)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'anti-runtime' },
    })
    expect(diagnoseStandalone(generate(ast).code)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'wordcode-declined' },
    })
  }

  const changedStep = parsed()
  traverse(changedStep, {
    SwitchCase(path) {
      if (path.node.test?.value !== 61) return
      path.traverse({
        BinaryExpression(inner) {
          if (inner.node.operator !== '!==') return
          inner.node.operator = '**'
          inner.stop()
        },
      })
      path.stop()
    },
  })
  expect(diagnoseAntiRuntime(changedStep)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'anti-runtime' },
  })
  expect(diagnoseStandalone(generate(changedStep).code)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'wordcode-declined' },
  })
})
