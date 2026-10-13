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
import { diagnoseControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { diagnoseCallFrames } from '../../../src/vm/jsconfuser-vm/build-call-frames.js'
import { diagnoseClosureLifetimes } from '../../../src/vm/jsconfuser-vm/analyze-closure-lifetimes.js'
import { diagnoseExceptionFinally } from '../../../src/vm/jsconfuser-vm/analyze-exception-finally.js'
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
      if (path.node.id.name === container.roles.words.name) {
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
  const a = diagnoseContainer(source)
  if (!a.ok) return { stage: 'A', ...a }
  const b = diagnoseWordcode(a.result)
  if (!b.ok) return { stage: 'B', ...b }
  const c = diagnoseReferences(a.result, b.result)
  if (!c.ok) return { stage: 'C', ...c }
  const d = diagnoseFunctionPartition(a.result, b.result, c.result)
  if (!d.ok) return { stage: 'D', ...d }
  const e = diagnoseControlFlow(b.result, c.result, d.result)
  if (!e.ok) return { stage: 'E', ...e }
  const f = diagnoseCallFrames(b.result, c.result, d.result, e.result)
  if (!f.ok) return { stage: 'F', ...f }
  const g = diagnoseClosureLifetimes(
    b.result,
    c.result,
    d.result,
    e.result,
    f.result,
  )
  if (!g.ok) return { stage: 'G', ...g }
  const h = diagnoseExceptionFinally(
    b.result,
    c.result,
    d.result,
    e.result,
    f.result,
  )
  return { stage: 'H', ...h }
}
const controls = [
  [
    'wrong finalizer continuation register',
    'reference',
    (words) =>
      words.splice(
        0,
        words.length,
        59,
        7,
        0,
        1,
        12,
        55,
        57,
        1,
        2,
        10,
        58,
        2,
        46,
        1,
      ),
  ],
  [
    'backward finalizer continuation',
    'reference',
    (words) =>
      words.splice(
        0,
        words.length,
        59,
        7,
        0,
        1,
        12,
        55,
        57,
        1,
        0,
        6,
        58,
        0,
        46,
        1,
      ),
  ],
  [
    'capture owner without close event',
    'corpus/raw/f-closures-state',
    (words, instructions) => {
      const start = instructions.find((i) => i.name === 'MAKE_CLOSURE')
        .functionMeta.startPc
      const ret = instructions.find((i) => i.name === 'RETURN' && i.pc >= start)
      words[ret.pc] = 39
      words[ret.pc + 1] = start
    },
  ],
  [
    'active finalizer re-entry',
    'reference',
    (words) => {
      words.splice(0, words.length, 59, 7, 0, 1, 9, 39, 7, 39, 7, 46, 1)
    },
  ],
  [
    'active finalizer bypass',
    'reference',
    (words) => {
      words.splice(0, words.length, 59, 7, 0, 1, 9, 39, 9, 39, 7, 46, 1)
    },
  ],
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
    'register outside all frames',
    'reference',
    (words, instructions) => {
      const item = instructions.find((x) => x.operands[0]?.kind === 'register')
      words[item.pc + 1] = 0xffffffff
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
    'invalid descriptor counts',
    'corpus/raw/f-closures-state',
    (words, instructions) => {
      const item = instructions.find((x) => x.name === 'MAKE_CLOSURE')
      words[item.pc + 3] = words[item.pc + 4] + 1
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
  [
    'unknown indirect value',
    'corpus/raw/f-finally-abrupt',
    (words, instructions) => {
      const item = instructions.findLast((x) => x.name === 'JUMP_REG')
      words[item.pc + 1] = 0
    },
  ],
  [
    'indirect target inside operand',
    'corpus/raw/f-finally-abrupt',
    (words) => {
      words[408 + 2] = 409
    },
  ],
  [
    'indirect target outside words',
    'corpus/raw/f-finally-abrupt',
    (words) => {
      words[408 + 2] = words.length + 1
    },
  ],
  [
    'indirect target across functions',
    'corpus/raw/f-finally-abrupt',
    (words) => {
      words[408 + 2] = 174
    },
  ],
  [
    'local capture without parent register',
    'corpus/raw/f-closures-state',
    (words, instructions) => {
      const item = instructions.find(
        (x) => x.name === 'MAKE_CLOSURE' && x.functionMeta.captureCount > 0,
      )
      words[item.pc + 8] = 4
    },
  ],
  [
    'inherited capture without parent upvalue',
    'corpus/raw/f-closures-state',
    (words, instructions) => {
      const item = instructions.find(
        (x) => x.name === 'MAKE_CLOSURE' && x.functionMeta.captureCount > 0,
      )
      words[item.pc + 7] = 0
      words[item.pc + 8] = 0
    },
  ],
  [
    'unreachable finalizer setup',
    'corpus/raw/f-finally-abrupt',
    (words, instructions) => {
      const setup = instructions.find((x) => x.name === 'FINALLY_SETUP')
      const entry = instructions.find((x) => x.nextPc === setup.pc)
      expect(entry.width).toBe(2)
      words[entry.pc] = 39
      words[entry.pc + 1] = setup.words[4]
    },
  ],
]
const expectedDiagnostics = {
  'unknown word': {
    name: 'unknown word',
    stage: 'B',
    diagnostic: {
      code: 'unknown-opcode',
      message: 'Unknown opcode 61 at pc 0',
    },
    publicDiagnostic: {
      code: 'wordcode-declined',
      message: 'Packet B declined the input wordcode',
    },
  },
  'truncated call': {
    name: 'truncated call',
    stage: 'B',
    diagnostic: {
      code: 'truncated-instruction',
      message: 'CALL at 12 is truncated in its argc payload',
    },
    publicDiagnostic: {
      code: 'wordcode-declined',
      message: 'Packet B declined the input wordcode',
    },
  },
  'constant outside pool': {
    name: 'constant outside pool',
    stage: 'C',
    diagnostic: {
      code: 'invalid-constant-reference',
      message: 'LOAD_CONST@6 has an invalid constant pair',
    },
    publicDiagnostic: {
      code: 'references-declined',
      message: 'Packet C declined the input references',
    },
  },
  'register outside all frames': {
    name: 'register outside all frames',
    stage: 'C',
    diagnostic: {
      code: 'invalid-register-reference',
      message:
        'LOAD_THIS@0 references r4294967295 outside the known frame bounds',
    },
    publicDiagnostic: {
      code: 'references-declined',
      message: 'Packet C declined the input references',
    },
  },
  'entry inside operand': {
    name: 'entry inside operand',
    stage: 'C',
    diagnostic: {
      code: 'invalid-label-reference',
      message: 'MAKE_CLOSURE@2 has an invalid entry PC',
    },
    publicDiagnostic: {
      code: 'references-declined',
      message: 'Packet C declined the input references',
    },
  },
  'invalid descriptor counts': {
    name: 'invalid descriptor counts',
    stage: 'C',
    diagnostic: {
      code: 'invalid-descriptor',
      message: 'MAKE_CLOSURE@2 has invalid frame metadata',
    },
    publicDiagnostic: {
      code: 'references-declined',
      message: 'Packet C declined the input references',
    },
  },
  'direct branch across functions': {
    name: 'direct branch across functions',
    stage: 'D',
    diagnostic: {
      code: 'cross-function-target',
      message: 'JUMP@141 targets function 0 from 1',
    },
    publicDiagnostic: {
      code: 'functions-declined',
      message: 'Packet D declined the input function partition',
    },
  },
  'unknown indirect value': {
    name: 'unknown indirect value',
    stage: 'E',
    diagnostic: {
      code: 'unresolved-jump-reg',
      message: 'Function 4: JUMP_REG@487 has no finite known target set',
    },
    publicDiagnostic: {
      code: 'cfg-declined',
      message: 'Packet E declined the input control flow',
    },
  },
  'indirect target inside operand': {
    name: 'indirect target inside operand',
    stage: 'E',
    diagnostic: {
      code: 'out-of-range-target',
      message: 'Function 4: JUMP_REG@487 targets non-boundary pc 409',
    },
    publicDiagnostic: {
      code: 'cfg-declined',
      message: 'Packet E declined the input control flow',
    },
  },
  'indirect target outside words': {
    name: 'indirect target outside words',
    stage: 'E',
    diagnostic: {
      code: 'out-of-range-target',
      message: 'Function 4: JUMP_REG@487 targets non-boundary pc 518',
    },
    publicDiagnostic: {
      code: 'cfg-declined',
      message: 'Packet E declined the input control flow',
    },
  },
  'indirect target across functions': {
    name: 'indirect target across functions',
    stage: 'E',
    diagnostic: {
      code: 'cross-function-target',
      message: 'Function 4: JUMP_REG@487 targets function 1',
    },
    publicDiagnostic: {
      code: 'cfg-declined',
      message: 'Packet E declined the input control flow',
    },
  },
  'local capture without parent register': {
    name: 'local capture without parent register',
    stage: 'G',
    diagnostic: {
      code: 'incomplete-capture',
      message: 'Local capture 2:0 has no parent register owner',
    },
    publicDiagnostic: {
      code: 'closure-lifetimes-declined',
      message: 'Packet G declined the input closure model',
    },
  },
  'inherited capture without parent upvalue': {
    name: 'inherited capture without parent upvalue',
    stage: 'G',
    diagnostic: {
      code: 'incomplete-capture',
      message: 'Upvalue capture 2:0 has no parent upvalue owner',
    },
    publicDiagnostic: {
      code: 'closure-lifetimes-declined',
      message: 'Packet G declined the input closure model',
    },
  },
  'unreachable finalizer setup': {
    name: 'unreachable finalizer setup',
    stage: 'E',
    diagnostic: {
      code: 'unbalanced-handler-stack',
      message: 'Function 1: setup 104 is unreachable',
    },
    publicDiagnostic: {
      code: 'cfg-declined',
      message: 'Packet E declined the input control flow',
    },
  },
  'active finalizer re-entry': {
    name: 'active finalizer re-entry',
    stage: 'H',
    diagnostic: {
      code: 'invalid-handler-routing',
      message: 'JUMP@5 re-enters active finally@0',
    },
    publicDiagnostic: {
      code: 'exception-finally-declined',
      message: 'Packet H declined the input exception model',
    },
  },
  'active finalizer bypass': {
    name: 'active finalizer bypass',
    stage: 'H',
    diagnostic: {
      code: 'invalid-handler-routing',
      message: 'JUMP@5 bypasses finally@0',
    },
    publicDiagnostic: {
      code: 'exception-finally-declined',
      message: 'Packet H declined the input exception model',
    },
  },
  'wrong finalizer continuation register': {
    name: 'wrong finalizer continuation register',
    stage: 'H',
    diagnostic: {
      code: 'invalid-handler-routing',
      message: 'JUMP_REG@10 does not use finally@0 continuation register',
    },
    publicDiagnostic: {
      code: 'exception-finally-declined',
      message: 'Packet H declined the input exception model',
    },
  },
  'backward finalizer continuation': {
    name: 'backward finalizer continuation',
    stage: 'H',
    diagnostic: {
      code: 'invalid-handler-routing',
      message: 'JUMP_REG@10 leaves finally@0',
    },
    publicDiagnostic: {
      code: 'exception-finally-declined',
      message: 'Packet H declined the input exception model',
    },
  },
  'capture owner without close event': {
    name: 'capture owner without close event',
    stage: 'G',
    diagnostic: {
      code: 'unknown-lifetime',
      message: 'Binding binding:1:register:2 has no proved close event',
    },
    publicDiagnostic: {
      code: 'closure-lifetimes-declined',
      message: 'Packet G declined the input closure model',
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
    expect(first.stage).toBe(expectedDiagnostics[name].stage)
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
