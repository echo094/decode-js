import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as t from '@babel/types'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { diagnoseReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { diagnoseFunctionPartition } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { diagnoseStandaloneInput } from '../../../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'

const fixture = (name) =>
  fs.readFileSync(`test/vm/jsconfuser-vm/fixtures/${name}/encoded.js`, 'utf8')
function changedWords(name, change) {
  const source = fixture(name)
  const container = diagnoseContainer(source).result
  const wordcode = diagnoseWordcode(container).result
  const words = [...wordcode.words]
  change(words, wordcode.instructions, container)
  const ast = parse(source)
  let changed = false
  traverse(ast, {
    VariableDeclarator(path) {
      // The words variable: the array literal holding the container's words.
      const values = path.node.init?.elements?.map((node) => node?.value)
      if (
        JSON.stringify(values) === JSON.stringify(container.roles.words.values)
      ) {
        expect(path.node.init.type).toBe('ArrayExpression')
        path.node.init.elements = words.map((value) => t.numericLiteral(value))
        changed = true
      }
    },
  })
  expect(changed).toBe(true)
  return generate(ast).code
}
function firstDecline(source) {
  const container = diagnoseContainer(source)
  if (!container.ok) return { component: 'extract-container', ...container }
  const wordcode = diagnoseWordcode(container.result)
  if (!wordcode.ok) return { component: 'read-wordcode', ...wordcode }
  const references = diagnoseReferences(container.result, wordcode.result)
  if (!references.ok) return { component: 'validate-references', ...references }
  const functions = diagnoseFunctionPartition(
    container.result,
    wordcode.result,
    references.result,
  )
  return { component: 'partition-functions', ...functions }
}
const controls = [
  [
    'unknown word',
    'reference',
    (words) => {
      words[0] = 61
    },
  ],
  [
    'truncated call',
    'corpus/raw/f-closures-state',
    (words, instructions) => {
      const call = instructions.find((x) => x.name === 'CALL')
      words[call.pc + 3] = 0xffffffff
    },
  ],
  [
    'constant outside pool',
    'reference',
    (words, instructions, container) => {
      const item = instructions.find((x) => x.name === 'LOAD_CONST')
      words[item.pc + 2] = container.roles.pool.values.length
    },
  ],
  [
    'entry inside operand',
    'corpus/raw/f-closures-state',
    (words, instructions) => {
      const item = instructions.find((x) => x.name === 'MAKE_CLOSURE')
      words[item.pc + 2] = item.pc + 1
    },
  ],
  [
    'direct branch across functions',
    'corpus/raw/f-finally-abrupt',
    (words, instructions) => {
      const item = instructions.find((x) => x.name === 'JUMP')
      words[item.pc + 1] = 0
    },
  ],
]
const expectedDiagnostics = {
  'unknown word': {
    name: 'unknown word',
    component: 'read-wordcode',
    diagnostic: {
      code: 'unknown-opcode',
      message: 'Unknown opcode 61 at pc 0',
    },
    publicDiagnostic: {
      code: 'wordcode-declined',
      message: 'readWordcode declined the input wordcode',
    },
  },
  'truncated call': {
    name: 'truncated call',
    component: 'read-wordcode',
    diagnostic: {
      code: 'truncated-instruction',
      message: 'CALL at 12 is truncated in its argc payload',
    },
    publicDiagnostic: {
      code: 'wordcode-declined',
      message: 'readWordcode declined the input wordcode',
    },
  },
  'constant outside pool': {
    name: 'constant outside pool',
    component: 'validate-references',
    diagnostic: {
      code: 'invalid-constant-reference',
      message: 'LOAD_CONST@6 has an invalid constant pair',
    },
    publicDiagnostic: {
      code: 'references-declined',
      message: 'validateReferences declined the input references',
    },
  },
  'entry inside operand': {
    name: 'entry inside operand',
    component: 'validate-references',
    diagnostic: {
      code: 'invalid-label-reference',
      message: 'MAKE_CLOSURE@2 has an invalid entry PC',
    },
    publicDiagnostic: {
      code: 'references-declined',
      message: 'validateReferences declined the input references',
    },
  },
  'direct branch across functions': {
    name: 'direct branch across functions',
    component: 'partition-functions',
    diagnostic: {
      code: 'cross-function-target',
      message: 'JUMP@141 targets function 0 from 1',
    },
    publicDiagnostic: {
      code: 'functions-declined',
      message: 'partitionFunctions declined the input function partition',
    },
  },
}
for (const [name, path, change] of controls)
  test(name + ' declines through the normal source entry', () => {
    const source = changedWords(path, change)
    const first = firstDecline(source)
    expect(first.ok, JSON.stringify(first.diagnostic)).toBe(false)
    expect(first.result).toBeNull()
    const publicResult = diagnoseStandaloneInput(source)
    expect(publicResult.ok).toBe(false)
    expect(first.component).toBe(expectedDiagnostics[name].component)
    expect(first.diagnostic).toEqual(expectedDiagnostics[name].diagnostic)
    expect(publicResult.diagnostic).toEqual(
      expectedDiagnostics[name].publicDiagnostic,
    )
    const decoded = diagnoseStandalone(source)
    expect(decoded.ok).toBe(false)
    expect(decoded.result).toBeNull()
    expect(decoded.diagnostic).toEqual(
      expectedDiagnostics[name].publicDiagnostic,
    )
  })
for (const name of [
  'reference',
  'corpus/raw/f-closures-state',
  'corpus/raw/f-expression-mutation',
  'corpus/raw/f-for-in-enumeration',
])
  test(
    name + ' preserves source behavior after the owned chain succeeds',
    () => {
      const source = fixture(name)
      const diagnosis = diagnoseStandaloneInput(source)
      expect(diagnosis.ok, diagnosis.diagnostic?.message).toBe(true)
      const decoded = diagnoseStandalone(source)
      expect(decoded.ok, decoded.diagnostic?.message).toBe(true)
      const run = (code) => {
        const window = {}
        vm.runInNewContext(
          code,
          { window, Buffer, performance: { now: () => 0 } },
          { timeout: 1000 },
        )
        return JSON.stringify(window.TEST_OUTPUT)
      }
      expect(run(decoded.result.output)).toBe(run(source))
    },
  )
