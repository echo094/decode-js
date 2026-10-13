import fs from 'node:fs'
import vm from 'node:vm'
import generate from '@babel/generator'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { diagnoseMinifiedRuntime } from '../../../src/vm/jsconfuser-vm/observe-minified-runtime.js'

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
    { window, performance: { now: () => 0 } },
    { timeout: 1000 },
  )
  return window.TEST_OUTPUT
}

test.each([
  'minified-runtime-boot',
  'minified-runtime-closures',
  'minified-runtime-finally',
  'minified-runtime-exceptions',
])(
  'minification embeds bytecode and pool arrays in the VM construction for %s',
  (name) => {
    const source = fixture(name, 'source.js')
    const encoded = fixture(name, 'encoded.js')
    const qualification = JSON.parse(fixture(name, 'qualification.json'))
    const ast = parse(encoded, { sourceType: 'script' })
    const topLevelArrays = ast.program.body
      .filter((statement) => statement.type === 'VariableDeclaration')
      .flatMap((statement) => statement.declarations)
      .filter((declaration) => declaration.init?.type === 'ArrayExpression')
    expect(topLevelArrays).toHaveLength(0)
    const boot = ast.program.body
      .filter((statement) => statement.type === 'ExpressionStatement')
      .flatMap((statement) => {
        const call = statement.expression
        if (call.type !== 'CallExpression') return []
        return call.arguments.filter(
          (argument) =>
            argument.type === 'NewExpression' &&
            argument.arguments[0]?.type === 'ArrayExpression' &&
            argument.arguments[1]?.type === 'ArrayExpression',
        )
      })
    expect(boot).toHaveLength(1)
    expect(boot[0].arguments[0].elements.length).toBeGreaterThan(0)
    expect(boot[0].arguments[1].elements.length).toBeGreaterThan(0)
    expect(diagnoseContainer(encoded).ok).toBe(true)
    const decoded = diagnoseStandalone(encoded)
    expect(decoded.ok).toBe(true)
    expect(decoded.result.proof).toMatchObject({
      noTargetExecution: true,
      noVmRuntimeEmission: true,
      finalParseValidated: true,
      finalResidueValidated: true,
    })
    expect(observe(encoded)).toEqual(observe(source))
    expect(observe(decoded.result.output)).toEqual(observe(source))
    expect(qualification.effectObservation).toEqual({
      axis: 'runtime-minification',
      observed: true,
    })
  },
)

test('runtime body proof is independent of minified binding and field names', () => {
  const ast = parse(fixture('minified-runtime-boot', 'encoded.js'), {
    sourceType: 'script',
  })
  traverse(ast, {
    Program(path) {
      path.scope.rename('T', 'RenamedRun')
    },
    MemberExpression(path) {
      if (!path.node.computed && path.node.property.name === 'j') {
        path.node.property.name = 'q'
      }
    },
  })
  expect(diagnoseMinifiedRuntime(generate(ast).code).ok).toBe(true)
})

test('runtime body proof rejects a changed unanchored opcode handler', () => {
  const encoded = fixture('minified-runtime-boot', 'encoded.js')
  expect(encoded).toContain('h*b[d+D(a)]')
  const damaged = encoded.replace('h*b[d+D(a)]', 'h/b[d+D(a)]')
  expect(diagnoseMinifiedRuntime(damaged)).toMatchObject({
    ok: false,
    diagnostic: {
      code: 'incomplete-role',
      message: 'Minified runtime body differs from pinned source',
    },
  })
  expect(diagnoseContainer(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'missing-role' },
  })
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'container-declined' },
  })
})

test.each([
  ['minified-runtime-boot', 7],
  ['minified-runtime-closures', 9],
  ['minified-runtime-finally', 8],
  ['minified-runtime-exceptions', 10],
])('parse-only observer proves minified roles for %s', (name, regCount) => {
  const encoded = fixture(name, 'encoded.js')
  const observed = diagnoseMinifiedRuntime(encoded)
  expect(observed.ok).toBe(true)
  expect(observed.result).toMatchObject({
    root: { startPc: 0, regCount },
    frame: { headerSize: 8, frameStart: 1 },
    sentinels: { CALL_SPREAD: 65535 },
    slots: {
      PC: 0,
      CALLER: 1,
      RET_DST: 2,
      THIS: 3,
      CLOSURE: 4,
      HANDLERS: 5,
      FRAME_SIZE: 6,
      REG_BASE: 7,
    },
  })
  expect(observed.result.words.length).toBeGreaterThan(0)
  expect(observed.result.pool.length).toBeGreaterThan(0)
  expect(Object.keys(observed.result.opcodes)).toHaveLength(61)
  if (name === 'minified-runtime-exceptions') {
    expect(observed.result.pool).toContain(true)
  }
})

test.each([
  [
    'dispatch label',
    'case 60:',
    'case 61:',
    'Dispatch labels differ from pinned opcode order',
  ],
  [
    'frame register base',
    'k[n+7]=e',
    'k[n+7]=w',
    'Frame header writes differ from pinned layout',
  ],
  [
    'spread sentinel',
    'u===65535',
    'u===65534',
    'CALL_SPREAD sentinel is not in all call handlers',
  ],
])(
  'observer declines altered %s through its named proof',
  (_role, before, after, message) => {
    const encoded = fixture('minified-runtime-boot', 'encoded.js')
    expect(encoded).toContain(before)
    expect(
      diagnoseMinifiedRuntime(encoded.replace(before, after)),
    ).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'incomplete-role', message },
    })
  },
)
