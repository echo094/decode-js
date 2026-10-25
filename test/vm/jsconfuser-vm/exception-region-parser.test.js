import fs from 'node:fs'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expectConsistentState } from '../../helper.js'
import { diagnoseStandaloneInput } from '../../../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { numericToVmSwitch } from '../../../src/vm/jsconfuser-vm/numeric-to-vm-switch.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import { emitVmSwitchProgram } from '../../../src/vm/switch/vm-switch-to-source.js'

const directory = new URL('fixtures/exception-region/', import.meta.url)
const provenance = JSON.parse(
  fs.readFileSync(new URL('provenance.json', directory), 'utf8'),
)
const read = (file) => fs.readFileSync(new URL(file, directory), 'utf8')
const baseline = () => {
  const input = diagnoseStandaloneInput(read(provenance.records[0].encoded))
  expect(input.ok, JSON.stringify(input.diagnostic)).toBe(true)
  return structuredClone(numericToVmSwitch(input.model))
}
const caseAt = (model, pc) =>
  model.instructionsByFunction.get(2).find((item) => item.pc === pc)
const snapshot = (model) =>
  JSON.stringify(model, (_, value) =>
    value instanceof Map
      ? [...value]
      : value instanceof Set
        ? [...value]
        : value,
  )
// Each damage breaks one property the try-region rule relies on; the unchanged data emits.
function refusal(change, reason) {
  const model = baseline()
  expect(emitVmSwitchProgram(structuredClone(model)).output).toContain(
    '} finally {',
  )
  change(model)
  const before = snapshot(model)
  expect(() => emitVmSwitchProgram(model)).toThrowError(reason)
  expect(snapshot(model)).toBe(before)
}
function members(node, type) {
  const found = []
  const walk = (item) => {
    if (!item || typeof item !== 'object') return
    if (item.type === type) found.push(item)
    for (const [key, value] of Object.entries(item)) {
      if (['loc', 'start', 'end'].includes(key)) continue
      if (Array.isArray(value)) value.forEach(walk)
      else if (value?.type) walk(value)
    }
  }
  walk(node)
  return found
}
for (const record of provenance.records) {
  test(`${record.id}: exact frozen data reaches current public structured output`, () => {
    expect(provenance.encoderPin).toBe(
      '20c5b96bf57337c568579352758d7685358650de',
    )
    expect(record.rng.seed).toBe(record.seed)
    expect(record.options.minify).toBe(
      ['minify', 'minifyClassObfuscation'].includes(record.profile),
    )
    expect(record.options.classObfuscation).toBe(
      ['classObfuscation', 'minifyClassObfuscation'].includes(record.profile),
    )
    const source = read(record.encoded),
      input = diagnoseStandaloneInput(source)
    expect(input.ok, JSON.stringify(input.diagnostic)).toBe(true)
    const beforeNumeric = snapshot(input.model),
      model = numericToVmSwitch(input.model),
      before = snapshot(model)
    const shared = emitVmSwitchProgram(model),
      result = decodeJsconfuserVm(source)
    expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
    expect(result.output).toBe(shared.output)
    expect(result.output).not.toBe(source)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.result)).toBe(true)
    expect(result.result.proof).toMatchObject({
      freshJavaScriptEmission: true,
      finalParseValidated: true,
      finalResidueValidated: true,
    })
    expect(result.result.finalJavaScriptSemantics).toBe(false)
    const ast = parse(result.output)
    traverse(ast, {})
    expectConsistentState(ast, result.output)
    const fn = members(ast, 'FunctionDeclaration').find(
      ({ id }) => id.name === '__recovered_function_2',
    )
    const outer = fn.body.body.find((item) => item.type === 'TryStatement'),
      inner = outer.block.body[0]
    expect(outer.finalizer.type).toBe('BlockStatement')
    expect(inner.handler.param.name).toBe('__recovered_error')
    expect(members(inner.block, 'IfStatement')).toHaveLength(5) // three bytecode tests and two global-read guards
    expect(members(inner.block, 'ReturnStatement')).toHaveLength(1)
    expect(members(inner.handler, 'ReturnStatement')).toHaveLength(1)
    expect(members(inner.block, 'ThrowStatement')).toHaveLength(3) // explicit throw plus two global guards
    const writes = members(fn, 'AssignmentExpression').filter(
      (node) =>
        node.left.type === 'MemberExpression' &&
        node.left.object?.type === 'MemberExpression' &&
        node.left.object.object?.name === '__recovered_captures',
    )
    expect(writes).toHaveLength(2)
    for (const phase of [inner.block, inner.handler]) {
      const returnBlock = members(phase, 'BlockStatement').find(
        (item) => item.body.at(-1)?.type === 'ReturnStatement',
      )
      expect(returnBlock).toBeDefined()
      const statements = returnBlock.body
      const tail = statements.at(-1)
      // Saved return is committed after the captured increment and before the finalizer.
      expect(tail.type).toBe('ReturnStatement')
      expect(tail.argument.name).toBe('__recovered_r_2_5')
      expect(statements.at(-2).expression.left.name).toBe('__recovered_r_2_5')
      expect(statements.at(-3).expression.left.property.name).toBe('value')
    }
    expect(members(outer.finalizer, 'ReturnStatement')).toHaveLength(0)
    expect(
      members(outer.finalizer, 'Identifier').some(({ name }) =>
        ['__recovered_r_2_4', '__recovered_r_2_5'].includes(name),
      ),
    ).toBe(false)
    expect(
      members(ast, 'Identifier').some(({ name }) =>
        [
          'VM',
          'BYTECODE',
          'CONSTANTS',
          'Closure',
          'Upvalue',
          'decodeBytecode',
          '__recovered_pc',
          '__recovered_dispatch',
          '__recovered_handlers',
        ].includes(name),
      ),
    ).toBe(false)
    expect(
      shared.simplification.functions
        .find(({ functionId }) => functionId === 2)
        .copies.every(
          ({ sourceRegister, destinationRegister }) =>
            ![3, 4, 5].includes(sourceRegister) &&
            ![3, 4, 5].includes(destinationRegister),
        ),
    ).toBe(true)
    expect(snapshot(model)).toBe(before)
    expect(snapshot(input.model)).toBe(beforeNumeric)
  })
}
// The control solver reads the resume's targets from the definitions reaching its register, so a
// damaged continuation write or resume register leaves the resume without a finite target set.
test('frozen finalizer cannot overwrite continuation', () =>
  refusal((model) => {
    caseAt(model, 326).operation.destination = 4
  }, /indirect-jump@351 has no finite target set/))
test('frozen return pad cannot read the wrong payload', () =>
  refusal((model) => {
    caseAt(model, 355).operation.source = 9
  }, /return payload at 355/))
test('frozen finalizer cannot read the pending payload', () =>
  refusal((model) => {
    caseAt(model, 337).operation.value = {
      kind: 'register',
      index: 5,
    }
  }, /completion register used at 337/))
test('frozen throw pad must rethrow the pending payload', () =>
  refusal((model) => {
    caseAt(model, 353).operation.source = 9
  }, /has no payload throw pad/))
test('frozen finalizer resume must read its continuation', () =>
  refusal((model) => {
    caseAt(model, 351).operation.source = 7
  }, /indirect-jump@351 has no finite target set/))

for (const name of [
  'focused/return-through-finally',
  'focused/caught-return-through-finally',
  'focused/protected-conditional-catch',
  'focused/terminal-switch-arms',
]) {
  test(`existing ${name} remains source-derived parser supported`, () => {
    const source = fs.readFileSync(
      new URL(`fixtures/corpus/${name}/encoded.js`, import.meta.url),
      'utf8',
    )
    const result = decodeJsconfuserVm(source)
    expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
    expect(result.output).not.toBe(source)
    expect(result.output).not.toContain('__recovered_dispatch')
    const ast = parse(result.output)
    traverse(ast, {})
    expectConsistentState(ast, result.output)
  })
}

test('a stale numeric finalizer target retains atomic public refusal', () => {
  const source = fs.readFileSync(
    new URL(
      'fixtures/corpus/negative/finally-stale-target/encoded.js',
      import.meta.url,
    ),
    'utf8',
  )
  const result = decodeJsconfuserVm(source)
  expect(result.ok).toBe(false)
  expect(result.result).toBeNull()
  expect(result.output).toBe(source)
})
