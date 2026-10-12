import fs from 'node:fs'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import { inspectCurrent } from '../../../scripts/qualify-jsconfuser-vm/oracles.mjs'
import { assertTimingRefusal } from '../../../scripts/qualify-jsconfuser-vm/timing.mjs'
import {
  timingSourceRoles,
  observeTimingKnown,
} from '../../../scripts/qualify-jsconfuser-vm/timing-observation.mjs'

const reference = fs.readFileSync(
  new URL('fixtures/reference/encoded.js', import.meta.url),
  'utf8',
)
const finalizers = fs.readFileSync(
  new URL('fixtures/runtime-finalizers/baseline.js', import.meta.url),
  'utf8',
)
const timing = (source, value) =>
  source.replace('var TIMING_CHECKS = false;', `var TIMING_CHECKS = ${value};`)

test('disabled false and zero prove the same shell; active and unsupported values refuse atomically', () => {
  for (const value of ['false', '0', '-0']) {
    const source = timing(reference, value)
    const result = inspectCurrent(source)
    expect(result.A.ok).toBe(true)
    expect(result.publicRecord.ok).toBe(true)
    expect(result.checks.ok).toBe(true)
    expect(result.inputState).toBe(true)
    expect(result.publicRecord.output).not.toBe(source)
  }
  for (const value of ['100', '1000', '-1', 'NaN', 'Infinity', '-Infinity']) {
    const source = timing(reference, value)
    const ast = parse(source),
      before = JSON.stringify(ast)
    const code = ['NaN', 'Infinity', '-Infinity'].includes(value)
      ? 'runtime-timing-mode'
      : 'runtime-active-timing'
    expect(diagnoseContainer(ast)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code },
    })
    expect(JSON.stringify(ast)).toBe(before)
    assertTimingRefusal(inspectCurrent(source), source, code)
  }
})

test('normal-source finalizer damages reach their own terminal source diagnostics', () => {
  for (const [from, to, code] of [
    [
      'VM.prototype.run = function',
      'VM.prototype.run += function',
      'runtime-dispatch-shell',
    ],
    [
      'var lastTime = now();',
      'var lastTime = now() + 1;',
      'runtime-dispatch-shell',
    ],
    [
      'currentTime - lastTime > TIMING_CHECKS',
      'currentTime - lastTime >= TIMING_CHECKS',
      'runtime-dispatch-shell',
    ],
    [
      'searchFrame = regs[searchFrame + SLOTS.CALLER];',
      'searchFrame = regs[searchFrame + SLOTS.CALLER] + 1;',
      'runtime-dispatch-shell',
    ],
    [
      'this._closeUpvaluesFor(fp);',
      'this._closeUpvaluesFor(fp + 1);',
      'runtime-return-finalizer',
    ],
    [
      'for (var i = regs[fp + SLOTS.REG_BASE]; i < hi; i++)',
      'for (var i = regs[fp + SLOTS.REG_BASE]; i <= hi; i++)',
      'runtime-capture-finalizer',
    ],
  ]) {
    const source = reference.replace(from, to)
    expect(source).not.toBe(reference)
    const ast = parse(source),
      before = JSON.stringify(ast)
    expect(diagnoseContainer(ast)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code },
    })
    expect(JSON.stringify(ast)).toBe(before)
    const current = decodeJsconfuserVm(source)
    expect(current).toMatchObject({
      ok: false,
      output: source,
      diagnostic: { code: 'container-declined' },
    })
  }
})

test('shell binds local and map identities while alpha renaming remains admissible', () => {
  const ast = parse(reference)
  let next = 0
  traverse(ast, {
    Scope(path) {
      for (const name of Object.keys(path.scope.bindings))
        path.scope.rename(name, `localAlias${next++}`)
    },
  })
  expect(diagnoseContainer(generate(ast).code).ok).toBe(true)
  const shadowed = reference.replace(
    /case OP.LOAD_INT:\s*\{/,
    'case OP.LOAD_INT: { var performance = globalThis.performance;',
  )
  expect(diagnoseContainer(shadowed)).toMatchObject({
    ok: false,
    diagnostic: { code: 'runtime-dispatch-shell' },
  })
})

test('complete selected Upvalue close semantics refuse consequential normal-source damages', () => {
  for (const [from, to, value] of [
    [
      'this._value = this._regs[this._absSlot];',
      'this._value += this._regs[this._absSlot];',
      [7, true, NaN],
    ],
    ['this._closed = true;', 'this._closed &= true;', [7, true, undefined]],
    [
      'Upvalue.prototype._close = function ()',
      'Upvalue.prototype._close = function* ()',
      [7, true, undefined],
    ],
  ]) {
    const source = finalizers.replace(from, to)
    expect(source).not.toBe(finalizers)
    // The generated program supplies an independent behavioral witness before
    // extraction; the observer does not use a disabled proof clone here.
    expect(observeTimingKnown(source, { clock: () => 0 }).behavior).toEqual({
      kind: 'value',
      value,
    })
    const ast = parse(source),
      before = JSON.stringify(ast)
    expect(diagnoseContainer(ast)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'runtime-capture-finalizer' },
    })
    expect(JSON.stringify(ast)).toBe(before)
    assertTimingRefusal(
      inspectCurrent(source),
      source,
      'runtime-capture-finalizer',
    )
  }
  const renamed = finalizers
    .replace('Upvalue.prototype._close =', 'Upvalue.prototype._seal =')
    .replaceAll('uv._close()', 'uv._seal()')
  const current = inspectCurrent(renamed)
  expect(current.A.ok).toBe(true)
  expect(current.publicRecord.ok).toBe(true)
  expect(current.checks.ok).toBe(true)
  expect(current.inputState).toBe(true)
  expect(observeTimingKnown(current.publicRecord.output).behavior).toEqual({
    kind: 'value',
    value: [7, true, 7],
  })
})

test('equal threshold preserves behavior and greater threshold poisons before dispatch', () => {
  const source = timing(reference, '100'),
    roles = timingSourceRoles(source)
  const equal = observeTimingKnown(source, {
    vmName: roles.vmName,
    clock: (index) => index * 100,
  })
  expect(equal.behavior).toEqual(
    observeTimingKnown(reference, { clock: () => 0 }).behavior,
  )
  const greater = observeTimingKnown(source, {
    vmName: roles.vmName,
    clock: (index) => (index === 0 ? 0 : 101),
  })
  expect(greater.behavior).toMatchObject({
    kind: 'error',
    name: 'Error',
    message: 'Unknown opcode: undefined at pc NaN',
  })
  expect(greater.state).toMatchObject({
    wordsZero: true,
    frame: undefined,
    currentFramePayloadCleared: true,
  })
  expect(() =>
    assertTimingRefusal(inspectCurrent(reference), reference),
  ).toThrow()
  expect(() =>
    assertTimingRefusal(
      inspectCurrent(source),
      source,
      'runtime-dispatch-shell',
    ),
  ).toThrow()
})

test('clock side effects are an explicit native host boundary', () => {
  const decoded = decodeJsconfuserVm(reference)
  expect(decoded.ok).toBe(true)
  const clock = () => {
    throw new Error('host clock failed')
  }
  expect(observeTimingKnown(reference, { clock }).behavior).toMatchObject({
    kind: 'error',
    message: 'host clock failed',
  })
  expect(observeTimingKnown(decoded.output, { clock }).behavior.kind).toBe(
    'value',
  )
  expect(decoded.result.finalJavaScriptSemantics).toBe(false)
})

test('active timing remains refused through numeric transport and table materialization', () => {
  for (const fixture of ['encoded-bytecode-arithmetic', 'handler-table-boot']) {
    const source = timing(
      fs.readFileSync(
        new URL(`fixtures/${fixture}/encoded.js`, import.meta.url),
        'utf8',
      ),
      '100',
    )
    expect(source).toContain('var TIMING_CHECKS = 100;')
    assertTimingRefusal(inspectCurrent(source), source)
  }
})
