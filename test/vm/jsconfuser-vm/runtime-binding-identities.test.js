import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { makeContext } from '../../../src/vm/jsconfuser-vm/container-role-helpers.js'
import { runtimeFragmentPattern } from '../../../src/vm/jsconfuser-vm/runtime-fragment-pattern.js'
import { runtimeSignature } from '../../../src/vm/jsconfuser-vm/runtime-source-signature.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'

function renamedBindings(source) {
  const ast = parse(source, { sourceType: 'script' })
  const scopes = new Set()
  traverse(ast, {
    enter(path) {
      scopes.add(path.scope)
    },
  })
  let index = 0
  for (const scope of scopes) {
    for (const name of Object.keys(scope.bindings))
      scope.rename(name, `lexical_binding_${index++}`)
  }
  return generate(ast).code
}

function observe(source) {
  const window = {}
  vm.runInNewContext(
    source,
    { window, atob, btoa, Buffer, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test.each([
  'encoded-bytecode-arithmetic',
  'concealed-constants-exceptions',
  'randomized-runtime-exceptions',
  'class-handler-alias-stack-exceptions',
  'encoded-class-stack-exceptions',
])(
  'decodes %s after every lexical binding is renamed',
  (name) => {
    const directory = new URL(`fixtures/${name}/`, import.meta.url)
    const source = fs.readFileSync(new URL('source.js', directory), 'utf8')
    const encoded = fs.readFileSync(new URL('encoded.js', directory), 'utf8')
    const renamed = renamedBindings(encoded)
    expect(renamed).not.toBe(encoded)
    const diagnosis = diagnoseStandalone(renamed)
    expect(diagnosis.diagnostic).toBe(null)
    expect(diagnosis.ok).toBe(true)
    expect(observe(renamed)).toEqual(observe(source))
    expect(observe(diagnosis.result.output)).toEqual(observe(source))
  },
)

test('fragment alpha equivalence preserves captured reads, writes, and shadows', () => {
  const ast = parse(`
    let first = 1, second = 2;
    function one(input) { let value = input; first = value; return first; }
    function two(argument) { let local = argument; first = local; return first; }
    function changed(argument) { let local = argument; second = local; return second; }
    function shadow(first) { let value = first; first = value; return first; }
  `)
  const context = makeContext(ast)
  const bodies = ast.program.body
    .slice(1)
    .map((fn) =>
      runtimeFragmentPattern([...fn.params, ...fn.body.body], context),
    )
  expect(bodies[0]).toEqual(bodies[1])
  expect(bodies[0]).not.toEqual(bodies[2])
  expect(bodies[0]).not.toEqual(bodies[3])
})

test('complete-body signatures preserve lexical binding topology', () => {
  const signature = (source) => {
    const ast = parse(source)
    return runtimeSignature(ast.program.body[0], makeContext(ast))
  }
  expect(signature('function one(value) { return value + value }')).toBe(
    signature('function two(renamed) { return renamed + renamed }'),
  )
  expect(signature('function one(value) { return value + value }')).not.toBe(
    signature('function one(value) { return value + other }'),
  )
  expect(signature('function one(value) { return () => value }')).not.toBe(
    signature('function one(value) { return (value) => value }'),
  )
})

test.each([
  ['encoded-bytecode-arithmetic', '>>> 0;', '>> 0;', 'container-declined'],
  [
    'concealed-constants-exceptions',
    'k = k + 0x9e3779b9 | 0',
    'k = k + 1 | 0',
    'concealed-constants-declined',
  ],
  [
    'encoded-class-stack-exceptions',
    'Buffer.from(s, "base64")',
    'Buffer.from(s, "hex")',
    'container-declined',
  ],
  [
    'class-handler-alias-stack-exceptions',
    'Buffer.from(s, "base64")',
    'Buffer.from(s, "hex")',
    'container-declined',
  ],
])(
  'refuses damaged %s bodies after lexical renaming',
  (name, before, after, code) => {
    const encoded = fs.readFileSync(
      new URL(`fixtures/${name}/encoded.js`, import.meta.url),
      'utf8',
    )
    const damaged = encoded.replace(before, after)
    expect(damaged).not.toBe(encoded)
    const renamed = renamedBindings(damaged)
    expect(diagnoseStandalone(renamed)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code },
    })
  },
)
