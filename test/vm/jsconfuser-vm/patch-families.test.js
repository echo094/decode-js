import fs from 'node:fs'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as t from '@babel/types'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnosePatchFamilies } from '../../../src/vm/jsconfuser-vm/observe-patch-families.js'
import { diagnoseSelfModifyingRegions } from '../../../src/vm/jsconfuser-vm/observe-self-modifying.js'
import { diagnoseNormalizeSelfModifyingWordcode } from '../../../src/vm/jsconfuser-vm/normalize-self-modifying-wordcode.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { diagnoseReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { diagnoseFunctionPartition } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { diagnoseControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import { patchFamilyCensus, assertNamedPatchDiagnostic } from '../../../scripts/qualify-jsconfuser-vm/patch.mjs'
import { observeKnown } from '../../../scripts/qualify-jsconfuser-vm/worker.mjs'
import { exactEqual } from '../../../scripts/qualify-jsconfuser-vm/codec.mjs'
import { outputChecks } from '../../../scripts/qualify-jsconfuser-vm/oracles.mjs'

const fixture = (name, suffix = '.js') => fs.readFileSync(new URL(`fixtures/patch-families/${name}${suffix}`, import.meta.url), 'utf8')
const replaceWords = (source, words) => source.replace(/^var BYTECODE = \[[^\n]+\];$/m, `var BYTECODE = ${JSON.stringify(words)};`)

for (const [name, family] of [['alias', 'alias'], ['macro', 'macro'], ['specialized', 'specialized'], ['anti', 'anti'], ['stack', null], ['finally', null], ['arrays', null]]) {
  test(`recovers reached PATCH ${name} widths, output and consumed records`, () => {
    const source = fixture(name)
    const container = diagnoseContainer(source).result
    const original = JSON.stringify(container)
    const families = diagnosePatchFamilies(source)
    expect(families.ok).toBe(true)
    const observed = diagnoseSelfModifyingRegions(container, families.result)
    expect(observed.ok).toBe(true)
    const census = patchFamilyCensus(source)
    expect(census.ok).toBe(true)
    expect(census.namedRuntimeRoles).toBe(true)
    expect(census.counts.selfModifying).toBeGreaterThan(0)
    if (family) {
      expect(families.result[family]).not.toBeNull()
      expect(census.patchedKinds).toContain({ alias: 'ALIAS', macro: 'MACRO', specialized: 'SPECIALIZED', anti: 'SYNTHETIC' }[family])
    } else {
      for (const [option, count] of Object.entries(census.counts))
        if (name !== 'arrays' || option !== 'antiInstrumentation') expect(count).toBeGreaterThan(0)
      if (name === 'arrays') {
        const macros = observed.result.reachableInstructions.filter(instruction => instruction.name === 'MACRO' && instruction.steps.some(step => step.name === 'BUILD_ARRAY'))
        expect(new Set(macros.map(instruction => instruction.width)).size).toBeGreaterThan(1)
        expect(new Set(macros.flatMap(instruction => instruction.steps.filter(step => step.name === 'BUILD_ARRAY').map(step => step.words[2])))).toEqual(new Set([4, 6]))
      } else expect(census.patchedKinds).toEqual(expect.arrayContaining(['ALIAS', 'MACRO', 'SPECIALIZED', 'SYNTHETIC']))
    }
    const normalized = diagnoseNormalizeSelfModifyingWordcode(container, { source })
    expect(normalized.ok).toBe(true)
    const result = normalized.result
    const words = diagnoseWordcode(result.container).result
    const references = diagnoseReferences(result.container, words).result
    const functions = diagnoseFunctionPartition(result.container, words, references).result
    const cfg = diagnoseControlFlow(words, references, functions).result
    expect(result.wordcode).toEqual(words)
    expect(result.references).toEqual(references)
    expect(result.functions).toEqual(functions)
    expect(result.cfg).toEqual(cfg)
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
  if (family) test(`PATCH ${family} reader extension is load bearing`, () => {
    const source = fixture(name)
    const container = diagnoseContainer(source).result
    const families = diagnosePatchFamilies(source).result
    const removed = diagnoseSelfModifyingRegions(container, { ...families, [family]: null })
    assertNamedPatchDiagnostic(removed, 'patch-ciphertext')
    expect(removed.result).toBeNull()
    expect(diagnoseWordcode(container).ok).toBe(false)
  })
}

test('normal-source interval and ciphertext damage reach named atomic refusals', () => {
  const source = fixture('stack')
  const container = diagnoseContainer(source).result
  const families = diagnosePatchFamilies(source).result
  const patch = diagnoseSelfModifyingRegions(container, families).result.patches[0]
  for (const [code, offset, mutate] of [
    ['patch-destination', patch.pc + 1, value => value + 1],
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

test('a changed enclosing added suffix cannot hide behind canonical PATCH words', () => {
  const source = fixture('alias')
  const damaged = source.replace('case 61:', 'case 4294967295:')
  expect(damaged).not.toBe(source)
  expect(diagnoseContainer(damaged).ok).toBe(true)
  assertNamedPatchDiagnostic(diagnosePatchFamilies(damaged), 'patch-family-runtime')
  expect(decodeJsconfuserVm(damaged)).toMatchObject({ ok: false, output: damaged })
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
// source-admitted synthetic macro reaches the consequent refusal without
// executing its deliberately unsupported control path.
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
  const families = diagnosePatchFamilies(source)
  expect(families.ok).toBe(true)
  expect(families.result.macro.macros[0].steps.map(step => step.name)).toEqual(['JUMP_REG', 'LOAD_INT'])
  assertNamedPatchDiagnostic(diagnoseSelfModifyingRegions(container.result, families.result), 'patch-family-control')
  expect(decodeJsconfuserVm(source)).toMatchObject({ ok: false, output: source })
})
