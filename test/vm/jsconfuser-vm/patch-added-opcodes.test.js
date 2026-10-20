import fs from 'node:fs'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as t from '@babel/types'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnosePatchAddedOpcodes } from '../../../src/vm/jsconfuser-vm/observe-patch-added-opcodes.js'
import { diagnoseSelfModifyingRegions } from '../../../src/vm/jsconfuser-vm/observe-self-modifying.js'
import { diagnoseNormalizeSelfModifyingWordcode } from '../../../src/vm/jsconfuser-vm/normalize-self-modifying-wordcode.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import { patchAddedOpcodeCensus, assertNamedPatchDiagnostic } from '../../../scripts/qualify-jsconfuser-vm/patch.mjs'
import { observeKnown } from '../../../scripts/qualify-jsconfuser-vm/worker.mjs'
import { exactEqual } from '../../../scripts/qualify-jsconfuser-vm/codec.mjs'
import { outputChecks } from '../../../scripts/qualify-jsconfuser-vm/oracles.mjs'

const fixture = (name, suffix = '.js') => fs.readFileSync(new URL(`fixtures/patch-added-opcodes/${name}${suffix}`, import.meta.url), 'utf8')
const replaceWords = (source, words) => source.replace(/^var BYTECODE = \[[^\n]+\];$/m, `var BYTECODE = ${JSON.stringify(words)};`)

for (const [name, kind] of [['alias', 'alias'], ['macro', 'macro'], ['specialized', 'specialized'], ['anti', 'anti'], ['stack', null], ['finally', null], ['arrays', null]]) {
  test(`recovers reached PATCH ${name} widths, output and consumed records`, () => {
    const source = fixture(name)
    const container = diagnoseContainer(source).result
    const original = JSON.stringify(container)
    const addedOpcodes = diagnosePatchAddedOpcodes(source)
    expect(addedOpcodes.ok).toBe(true)
    const observed = diagnoseSelfModifyingRegions(container, addedOpcodes.result)
    expect(observed.ok).toBe(true)
    const census = patchAddedOpcodeCensus(source)
    expect(census.ok).toBe(true)
    expect(census.counts.selfModifying).toBeGreaterThan(0)
    if (kind) {
      expect(addedOpcodes.result[kind]).not.toBeNull()
      expect(census.patchedKinds).toContain({ alias: 'ALIAS', macro: 'MACRO', specialized: 'SPECIALIZED', anti: 'SYNTHETIC' }[kind])
    } else {
      for (const [option, count] of Object.entries(census.counts))
        if (name !== 'arrays' || option !== 'antiInstrumentation') expect(count).toBeGreaterThan(0)
      if (name === 'arrays') {
        const macros = observed.result.instructions.filter(instruction => instruction.name === 'MACRO' && instruction.steps.some(step => step.name === 'BUILD_ARRAY'))
        expect(new Set(macros.map(instruction => instruction.width)).size).toBeGreaterThan(1)
        expect(new Set(macros.flatMap(instruction => instruction.steps.filter(step => step.name === 'BUILD_ARRAY').map(step => step.words[2])))).toEqual(new Set([4, 6]))
      } else expect(census.patchedKinds).toEqual(expect.arrayContaining(['ALIAS', 'MACRO', 'SPECIALIZED', 'SYNTHETIC']))
    }
    const normalized = diagnoseNormalizeSelfModifyingWordcode(container, { source })
    expect(normalized.ok).toBe(true)
    const result = normalized.result
    // Added opcodes stay for their own stages; canonical B exists once none remains.
    const words = diagnoseWordcode(result.container)
    expect(result.wordcode).toEqual(words.ok ? words.result : null)
    expect(result.wordCount).toBeLessThan(result.originalWordCount)
    expect(JSON.stringify(container)).toBe(original)
    const current = decodeJsconfuserVm(source)
    expect(current.ok).toBe(true)
    expect(current.output).not.toBe(source)
    expect(outputChecks(current.output, source, current.result).ok).toBe(true)
    expect(exactEqual(observeKnown(current.output), observeKnown(fixture(name, '.src.js')))).toBe(true)
    expect(exactEqual(observeKnown(source), observeKnown(fixture(name, '.src.js')))).toBe(true)
    expect(current.result.finalJavaScriptSemantics).toBe(false)
  })
  if (kind) test(`PATCH ${kind} reader extension is load bearing`, () => {
    const source = fixture(name)
    const container = diagnoseContainer(source).result
    const addedOpcodes = diagnosePatchAddedOpcodes(source).result
    const removed = diagnoseSelfModifyingRegions(container, { ...addedOpcodes, [kind]: null })
    assertNamedPatchDiagnostic(removed, 'patch-ciphertext')
    expect(removed.result).toBeNull()
    expect(diagnoseWordcode(container).ok).toBe(false)
  })
}

test('normal-source interval and ciphertext damage reach named atomic refusals', () => {
  const source = fixture('stack')
  const container = diagnoseContainer(source).result
  const addedOpcodes = diagnosePatchAddedOpcodes(source).result
  const patch = diagnoseSelfModifyingRegions(container, addedOpcodes).result.patches[0]
  for (const [code, offset, mutate] of [
    ['patch-ciphertext', patch.sourceStart, value => (value ^ 0xffffffff) >>> 0],
  ]) {
    const words = container.roles.words.values.slice()
    words[offset] = mutate(words[offset])
    const damaged = replaceWords(source, words)
    expect(damaged).not.toBe(source)
    const admitted = diagnoseContainer(damaged)
    expect(admitted.ok).toBe(true)
    const refused = diagnoseNormalizeSelfModifyingWordcode(admitted.result, { source: damaged })
    assertNamedPatchDiagnostic(refused, code)
    const current = decodeJsconfuserVm(damaged)
    expect(current).toMatchObject({ ok: false, output: damaged })
  }
})

// Opcodes are named by what their handlers do, never by their values: moving an added handler to
// another label leaves the words that use it without a handler, and the decode declines.
test('a moved added handler label leaves its PATCH words without a handler', () => {
  const source = fixture('alias')
  const damaged = source.replace('case 61:', 'case 4294967295:')
  expect(damaged).not.toBe(source)
  expect(diagnoseContainer(damaged).ok).toBe(true)
  expect(decodeJsconfuserVm(damaged)).toMatchObject({ ok: false, output: damaged, diagnostic: { code: 'wordcode-declined' } })
})

test('named damage and behavior oracles fail on counterexamples', () => {
  expect(() => assertNamedPatchDiagnostic({ ok: true }, 'patch-ciphertext')).toThrow('Expected PATCH mechanism')
  expect(() => assertNamedPatchDiagnostic({ ok: false, diagnostic: { code: 'patch-destination' } }, 'patch-ciphertext')).toThrow('observed patch-destination')
  const source = fixture('stack')
  const current = decodeJsconfuserVm(source)
  const wrong = current.output.replace('= 6;', '= 60;')
  expect(wrong).not.toBe(current.output)
  expect(exactEqual(observeKnown(wrong), observeKnown(fixture('stack', '.src.js')))).toBe(false)
})

// The producer omits JUMP_REG from its nonterminal macro exclusion. This
// source-admitted synthetic macro passes the PATCH stage, which reads widths
// only; after macro expansion the canonical CFG refuses the register jump.
test('refuses a source-reachable nonterminal macro register jump', () => {
  const ast = parse(fixture('macro'))
  let jumpBody, loadBody, macro
  traverse(ast, { SwitchCase(path) {
    const node = path.node
    if (t.isMemberExpression(node.test) && t.isIdentifier(node.test.property, { name: 'JUMP_REG' })) jumpBody = node.consequent
    if (t.isMemberExpression(node.test) && t.isIdentifier(node.test.property, { name: 'LOAD_INT' })) loadBody = node.consequent
    if (t.isNumericLiteral(node.test, { value: 61 })) macro = node
  } })
  expect(jumpBody).toBeDefined()
  expect(loadBody).toBeDefined()
  const body = statements => statements.flatMap(statement => t.isBlockStatement(statement) ? statement.body : [statement]).filter(statement => !t.isBreakStatement(statement))
  macro.consequent = [t.blockStatement([...body(jumpBody), ...body(loadBody)].map(node => t.cloneNode(node, true)).concat(t.breakStatement()))]
  const clear = [61, 0, 0, 7]
  let key = (7 ^ 5) | 0
  const cipher = clear.map(word => { key = (key + 0x9e3779b9) | 0; return (word ^ key ^ (key >>> 13)) >>> 0 })
  const words = [56, 5, 11, 15, 7, 0, 0, 0, 0, 45, 0, ...cipher]
  traverse(ast, { VariableDeclarator(path) { if (t.isIdentifier(path.node.id, { name: 'BYTECODE' })) path.node.init = t.arrayExpression(words.map(word => t.numericLiteral(word))) } })
  const source = generate(ast).code
  const container = diagnoseContainer(source)
  expect(container.ok).toBe(true)
  const addedOpcodes = diagnosePatchAddedOpcodes(source)
  expect(addedOpcodes.ok).toBe(true)
  expect(addedOpcodes.result.macro.macros[0].steps.map(step => step.name)).toEqual(['JUMP_REG', 'LOAD_INT'])
  expect(diagnoseSelfModifyingRegions(container.result, addedOpcodes.result).ok).toBe(true)
  expect(decodeJsconfuserVm(source)).toMatchObject({ ok: false, output: source, diagnostic: { code: 'cfg-declined' } })
})
