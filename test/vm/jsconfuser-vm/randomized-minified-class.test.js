import fs from 'node:fs'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { test, expect } from 'vitest'
import { materializeRandomizedMinifiedClass } from '../../../src/vm/jsconfuser-vm/materialize-randomized-minified-class.js'
import { diagnoseMinifiedClassRuntime } from '../../../src/vm/jsconfuser-vm/observe-minified-class-runtime.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import { expectConsistentState } from '../../helper.js'
import {
  assertNoVmResidue,
  assertDerivedStateConsistency,
  parseSuccessfulOutput,
} from './integration/harness.js'
import {
  completeNoiseAst,
  mutateNoise,
  noiseSource,
} from './randomized-class-noise-controls.js'
const sourceAt = (name) =>
  fs.readFileSync(
    new URL(`fixtures/randomized-class/${name}.js`, import.meta.url),
    'utf8',
  )
for (const kind of ['arithmetic', 'spread', 'exceptionRoutes'])
  for (const seed of [191, 192, 193])
    test(`${kind}/${seed}: randomized minified complete graph and actual recovery`, () => {
      const source = sourceAt(`${kind}-minified-${seed}`),
        ast = parse(source)
      traverse(ast, {})
      const before = JSON.stringify(ast),
        normal = materializeRandomizedMinifiedClass(ast)
      expect(Object.keys(normal.layout.opcodes)).toHaveLength(61)
      expect(normal.layout.headerSize).toBeGreaterThanOrEqual(8)
      expect(normal.layout.frameStart).toBeGreaterThanOrEqual(1)
      expect(diagnoseMinifiedClassRuntime(normal.ast).ok).toBe(true)
      const A = diagnoseContainer(ast),
        baseline = diagnoseContainer(sourceAt(`${kind}.baseline`))
      expect(A.ok, JSON.stringify(A.diagnostic)).toBe(true)
      expect(A.result.roles.words.values).toEqual(
        baseline.result.roles.words.values,
      )
      expect(A.result.roles.pool.values).toEqual(
        baseline.result.roles.pool.values,
      )
      expect(diagnoseWordcode(A.result).result.consumedWords).toBe(
        A.result.roles.words.values.length,
      )
      expect(JSON.stringify(ast)).toBe(before)
      expectConsistentState(ast, source, { sourceType: 'script' })
      const result = decodeJsconfuserVm(source)
      expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
      expect(result.output).not.toBe(source)
      expect(result.result.finalJavaScriptSemantics).toBe(false)
      expect(result.result.proof).toMatchObject({
        freshJavaScriptEmission: true,
        freshSimplificationState: true,
        finalParseValidated: true,
        finalResidueValidated: true,
      })
      const output = parseSuccessfulOutput(result.output)
      expect(assertNoVmResidue(output).ok).toBe(true)
      expect(assertDerivedStateConsistency(output, result.output).ok).toBe(true)
    })
function damaged(seed, recipe) {
  const source = sourceAt(`arithmetic-minified-${seed}`),
    ast = parse(source)
  const layout = materializeRandomizedMinifiedClass(ast).layout
  let dispatch
  traverse(ast, {
    SwitchStatement(path) {
      dispatch = path
    },
  })
  const handler = (role) =>
    dispatch
      .get('cases')
      .find((p) => p.node.test?.value === layout.opcodes[role])
  recipe({ ast, dispatch, handler, layout })
  return generate(ast).code
}
function refused(source, code, message = null) {
  const A = diagnoseContainer(source)
  expect(A, JSON.stringify(A.diagnostic)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code },
  })
  expect(A.diagnostic.code).not.toBe('deliberately-wrong-diagnostic')
  if (message) expect(A.diagnostic.message).toBe(message)
  expect(decodeJsconfuserVm(source)).toMatchObject({
    ok: false,
    result: null,
    output: source,
    diagnostic: { code: 'container-declined' },
  })
}

for (const [seed, role] of [
  [191, 'ACC'],
  [192, 'PC'],
])
  test(`${seed}: foreign ${role} RHS reaches read ownership refusal`, () => {
    refused(
      mutateNoise(parse(noiseSource(seed)), role, 'dispatch', 'foreign-read'),
      'randomized-minified-class',
      'Noise register read receiver changed',
    )
  })

const noisePhases = [
  ...['END', 'PARAMS', 'ARGS', 'PC', 'COUNTER'].map((role) => [role, 'push']),
  ...['PC', 'COUNTER', 'MIRROR', 'ACC'].map((role) => [role, 'dispatch']),
]
for (const [role, phase, mutation] of [
  ['PC', 'dispatch', 'foreign-word-array'],
  ['ACC', 'dispatch', 'foreign-cursor'],
  ['PC', 'push', 'foreign-descriptor'],
  ['PARAMS', 'push', 'foreign-descriptor'],
])
  test(`synthetic ${role}/${phase}: ${mutation} retains connected dependencies`, () => {
    refused(
      mutateNoise(completeNoiseAst(), role, phase, mutation),
      'randomized-minified-class',
      phase === 'push'
        ? 'Noise frame effect is outside the pinned shape'
        : 'Noise dispatch effect is outside the pinned shape',
    )
  })
for (const [role, phase] of noisePhases)
  for (const mutation of ['compound', 'conditional', 'value', 'after-phase'])
    test(`synthetic ${role}/${phase}: ${mutation} reaches exact recipe refusal`, () => {
      const source = mutateNoise(completeNoiseAst(), role, phase, mutation)
      const message =
        mutation === 'compound'
          ? 'Noise assignment operator changed'
          : phase === 'push'
            ? 'Noise seed is not an unconditional unused effect in its phase'
            : mutation === 'after-phase'
              ? 'Noise churn is outside dispatch prefix'
              : 'Noise churn is not an unconditional unused effect in its phase'
      refused(source, 'randomized-minified-class', message)
      const ast = parse(source),
        before = JSON.stringify(ast)
      expect(diagnoseContainer(ast).ok).toBe(false)
      expect(JSON.stringify(ast)).toBe(before)
      expectConsistentState(ast, source, { sourceType: 'script' })
    })

const seedOrChurn = (phase) => (phase === 'push' ? 'seed' : 'churn')
const placementMessage = (phase, mutation) =>
  ({
    logical: `Noise ${seedOrChurn(phase)} is not an unconditional unused effect in its phase`,
    'conditional-value': `Noise ${seedOrChurn(phase)} is not an unconditional unused effect in its phase`,
    returned: `Noise ${seedOrChurn(phase)} is not an unconditional unused effect in its phase`,
    'before-phase':
      phase === 'push'
        ? 'Noise seed is not an unconditional unused effect in its phase'
        : 'Noise churn is outside dispatch prefix',
    'foreign-frame':
      phase === 'push'
        ? 'Noise seed phase contains another effect'
        : 'Noise register/frame receiver changed',
    'foreign-write': `Noise ${seedOrChurn(phase)} phase contains another effect`,
  })[mutation]
function refusedUnchanged(source, message) {
  refused(source, 'randomized-minified-class', message)
  const ast = parse(source),
    before = JSON.stringify(ast)
  expect(diagnoseContainer(ast).ok).toBe(false)
  expect(JSON.stringify(ast)).toBe(before)
  expectConsistentState(ast, source, { sourceType: 'script' })
}
for (const [role, phase] of noisePhases)
  for (const mutation of [
    'logical',
    'conditional-value',
    'returned',
    'before-phase',
    'foreign-frame',
    'foreign-write',
  ])
    test(`synthetic ${role}/${phase}: ${mutation} reaches its placement refusal`, () => {
      refusedUnchanged(
        mutateNoise(completeNoiseAst(), role, phase, mutation),
        placementMessage(phase, mutation),
      )
    })
for (const mutation of ['prefix', 'decrement'])
  test(`synthetic COUNTER/dispatch: ${mutation} update reaches shape refusal`, () => {
    refusedUnchanged(
      mutateNoise(completeNoiseAst(), 'COUNTER', 'dispatch', mutation),
      'Noise dispatch effect is outside the pinned shape',
    )
  })
for (const [role, phase] of [
  ['END', 'push'],
  ['ACC', 'dispatch'],
])
  for (const [mutation, message] of [
    [
      'alias-receiver',
      phase === 'push'
        ? 'Noise frame register alias is detached from VM'
        : 'Noise dispatch register alias is detached from VM',
    ],
    ['alias-compound', 'Noise dependency assignment operator changed'],
    [
      'interposed-effect',
      `Noise ${seedOrChurn(phase)} phase contains another effect`,
    ],
  ])
    test(`synthetic ${role}/${phase}: ${mutation} reaches dependency refusal`, () => {
      refusedUnchanged(
        mutateNoise(completeNoiseAst(), role, phase, mutation),
        message,
      )
    })

test('synthetic complete optional-noise contract remains an atomic positive', () => {
  const ast = completeNoiseAst(),
    before = JSON.stringify(ast),
    source = generate(ast).code
  const normal = materializeRandomizedMinifiedClass(ast)
  expect(normal.layout.noise).toHaveLength(9)
  expect(diagnoseMinifiedClassRuntime(normal.ast).ok).toBe(true)
  const A = diagnoseContainer(ast),
    baseline = diagnoseContainer(sourceAt('arithmetic.baseline'))
  expect(A.ok).toBe(true)
  expect(A.result.roles.words.values).toEqual(
    baseline.result.roles.words.values,
  )
  expect(JSON.stringify(ast)).toBe(before)
  const result = decodeJsconfuserVm(source)
  expect(result.ok).toBe(true)
  expect(result.output).not.toBe(source)
  expect(result.result.finalJavaScriptSemantics).toBe(false)
  const output = parseSuccessfulOutput(result.output)
  expect(assertDerivedStateConsistency(output, result.output).ok).toBe(true)
  expect(assertNoVmResidue(output).ok).toBe(true)
  traverse(ast, {
    Program(p) {
      for (const name of Object.keys(p.scope.bindings))
        p.scope.rename(name, `alpha_${name}`)
    },
    SwitchStatement(p) {
      p.node.cases.reverse()
    },
  })
  expect(diagnoseContainer(generate(ast).code).ok).toBe(true)
})
for (const seed of [191, 192, 193]) {
  test(`${seed}: live mapping damage reaches word refusal`, () => {
    refused(
      damaged(seed, ({ handler, layout }) => {
        let value = 0
        while (Object.values(layout.opcodes).includes(value)) value++
        handler('LOAD_CONST').node.test.value = value
      }),
      'randomized-minified-class-wordcode',
    )
  })
  test(`${seed}: duplicate labels reach mapping refusal`, () => {
    refused(
      damaged(seed, ({ handler }) => {
        handler('ADD').node.test.value = handler('SUB').node.test.value
      }),
      'randomized-minified-class',
    )
  })
  test(`${seed}: semantic damage reaches case refusal`, () => {
    refused(
      damaged(seed, ({ handler }) => {
        handler('ADD').traverse({
          BinaryExpression(p) {
            if (p.node.operator === '+') p.node.operator = '-'
          },
        })
      }),
      'randomized-minified-class',
    )
  })
  test(`${seed}: noise damage reaches source refusal`, () => {
    refused(
      damaged(seed, ({ ast, layout }) => {
        const offset = layout.noise.find((n) => n.phase === 'dispatch').offset
        let changed = false
        traverse(ast, {
          MemberExpression(p) {
            const n = p.node
            if (
              !changed &&
              n.computed &&
              n.property.type === 'BinaryExpression' &&
              n.property.right.value === offset &&
              p.findParent(
                (q) => q.isAssignmentExpression() || q.isUpdateExpression(),
              ) &&
              !p.findParent((q) => q.isTryStatement())
            ) {
              const effect = p.findParent(
                (q) => q.isAssignmentExpression() || q.isUpdateExpression(),
              )
              if (effect.isUpdateExpression()) effect.node.operator = '--'
              else effect.node.right = { type: 'NumericLiteral', value: 999 }
              changed = true
            }
          },
        })
        expect(changed).toBe(true)
      }),
      'randomized-minified-class',
    )
  })
  test(`${seed}: foreign noise receiver reaches binding refusal`, () => {
    refused(
      damaged(seed, ({ ast, layout }) => {
        const offset = layout.noise.find((n) => n.phase === 'dispatch').offset
        let changed = false
        traverse(ast, {
          MemberExpression(p) {
            const n = p.node
            if (
              !changed &&
              n.computed &&
              n.property.type === 'BinaryExpression' &&
              n.property.right.value === offset &&
              !p.findParent((q) => q.isTryStatement())
            ) {
              n.object = { type: 'Identifier', name: 'unownedNoiseRegisters' }
              changed = true
            }
          },
        })
        expect(changed).toBe(true)
      }),
      'randomized-minified-class',
    )
  })
  test(`${seed}: alpha bindings and case order retain source proof`, () => {
    const source = damaged(seed, ({ ast, dispatch }) => {
      dispatch.node.cases.reverse()
      traverse(ast, {
        Program(p) {
          for (const name of Object.keys(p.scope.bindings))
            p.scope.rename(name, `renamed_${name}`)
        },
      })
    })
    expect(diagnoseContainer(source).ok).toBe(true)
  })
}

// Consistent full remapping: every case label and every instruction-boundary
// opcode word move together. Closure folds the disabled-timing branch, so the
// minified source has no other owned opcode use to remap.
for (const seed of [191, 192, 193])
  test(`${seed}: consistent full remapping admits identical canonical words`, () => {
    const original = diagnoseContainer(sourceAt(`arithmetic-minified-${seed}`))
    expect(original.ok).toBe(true)
    const B = diagnoseWordcode(original.result)
    expect(B.ok).toBe(true)
    const words = original.result.roles.words.values
    const source = damaged(seed, ({ ast, dispatch, layout }) => {
      const remap = new Map(
        Object.values(layout.opcodes).map((value) => [
          value,
          (value + 1) % 65536,
        ]),
      )
      for (const item of dispatch.node.cases)
        if (item.test) item.test.value = remap.get(item.test.value)
      const arrays = []
      traverse(ast, {
        ArrayExpression(p) {
          const { elements } = p.node
          if (
            elements.length === words.length &&
            elements.every((element) => element?.type === 'NumericLiteral')
          )
            arrays.push(elements)
        },
      })
      expect(arrays).toHaveLength(1)
      for (const { pc } of B.result.instructions) {
        expect(remap.has(arrays[0][pc].value)).toBe(true)
        arrays[0][pc].value = remap.get(arrays[0][pc].value)
      }
    })
    const A = diagnoseContainer(source)
    expect(A.ok, JSON.stringify(A.diagnostic)).toBe(true)
    expect(A.result.roles.words.values).toEqual(words)
    const result = decodeJsconfuserVm(source)
    expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
    expect(result.output).not.toBe(source)
  })
