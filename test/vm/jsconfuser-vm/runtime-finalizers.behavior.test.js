import fs from 'node:fs'
import { expect, test } from 'vitest'
import { inspectCurrent } from '../../../scripts/qualify-jsconfuser-vm/oracles.mjs'
import {
  timingProfiles,
  timingSources,
  assertTimingRefusal,
  assertTimingBehavior,
} from '../../../scripts/qualify-jsconfuser-vm/timing.mjs'
import {
  timingSourceRoles,
  observeTimingKnown,
  runTimingNative,
} from '../../../scripts/qualify-jsconfuser-vm/timing-observation.mjs'
import { diagnoseNormalizeSelfModifyingWordcode } from '../../../src/vm/jsconfuser-vm/normalize-self-modifying-wordcode.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { diagnoseReferences } from '../../../src/vm/jsconfuser-vm/validate-references.js'
import { diagnoseFunctionPartition } from '../../../src/vm/jsconfuser-vm/partition-functions.js'
import { diagnoseControlFlow } from '../../../src/vm/jsconfuser-vm/build-cfg.js'

const fixture = (name) =>
  fs.readFileSync(
    new URL(`fixtures/runtime-finalizers/${name}`, import.meta.url),
    'utf8',
  )
const original = fixture('finalizers.src.js')
const oracle = JSON.parse(fixture('oracle.json'))

test('retained generation metadata separates population inputs from the worker-only boundary', () => {
  const generation = JSON.parse(fixture('generation.json'))
  expect(generation.generator).toBe('scripts/qualify-jsconfuser-vm/timing.mjs')
  expect(generation.cases).toEqual({ finalizers: 'finalizers.src.js' })
  expect(original.trim()).toBe(timingSources.finalizers)
  expect(generation.profiles).toEqual(
    Object.fromEntries(
      timingProfiles.map(({ name, options }) => [name, options]),
    ),
  )
  const boundary = generation.separateGeneration.topLevelFinally
  expect(boundary).toMatchObject({
    worker: 'scripts/qualify-jsconfuser-vm/worker.mjs',
    driver: 'scripts/qualify-jsconfuser-vm/qualify.mjs',
    api: 'runWorker(request, 65000)',
    sourceFile: 'top-level-finally.src.js',
    outputFile: 'top-level-finally.js',
    request: {
      action: 'generate',
      seed: 231,
      options: generation.baselineOptions,
    },
    rng: generation.rng,
    toolchain: generation.toolchain,
    encoderPin: generation.encoderPin,
  })
  expect(fixture(boundary.sourceFile)).toContain('finally')
  expect(fixture(boundary.outputFile)).toContain('TIMING_CHECKS = false')
})

for (const profile of timingProfiles)
  test(`current ${profile.name} finalizer recovery/refusal, real clocks and consumed state`, async () => {
    const source = fixture(`${profile.name}.js`),
      roles = timingSourceRoles(source)
    const current = inspectCurrent(source)
    const active = Boolean(profile.options.timingChecks)
    if (active) assertTimingRefusal(current, source)
    else {
      expect(current.publicRecord.ok).toBe(true)
      expect(current.publicRecord.output).not.toBe(source)
      expect(current.checks.ok).toBe(true)
      expect(current.inputState).toBe(true)
      expect(current.publicRecord.result.finalJavaScriptSemantics).toBe(false)
    }
    const equal = observeTimingKnown(source, {
      vmName: roles.vmName,
      clock: (index) => index * 100,
    })
    assertTimingBehavior(equal.behavior, {
      kind: 'value',
      value: oracle.normal,
    })
    for (const mode of ['fast', 'slow', 'paused']) {
      const sourceRun = await runTimingNative({ source: original, mode })
      const encodedRun = await runTimingNative({
        source,
        mode,
        vmName: roles.vmName,
      })
      assertTimingBehavior(sourceRun.result.behavior, {
        kind: 'value',
        value: oracle.normal,
      })
      expect(encodedRun.process).toMatchObject({
        exitCode: 0,
        signal: null,
        timedOut: false,
      })
      if (active && mode !== 'fast') {
        expect(encodedRun.result.behavior.kind).toBe('error')
        expect(oracle.poisonErrorKinds).toContain(
          encodedRun.result.behavior.name,
        )
        expect(encodedRun.result.state).toMatchObject({
          wordsZero: true,
          frame: undefined,
          cleaned: undefined,
          currentFramePayloadCleared: true,
        })
        expect(
          encodedRun.result.state.captures.some(
            (capture) => !capture.closed && capture.backing === undefined,
          ),
        ).toBe(true)
        expect(
          encodedRun.result.state.captures.some(
            (capture) => capture.backing?.runtimeType === 'function',
          ),
        ).toBe(true)
        expect(encodedRun.result.blockedMs).toBeGreaterThan(
          oracle.activeThreshold,
        )
      } else
        assertTimingBehavior(
          encodedRun.result.behavior,
          sourceRun.result.behavior,
        )
      if (!active) {
        const decodedRun = await runTimingNative({
          source: current.publicRecord.output,
          mode,
        })
        assertTimingBehavior(
          decodedRun.result.behavior,
          sourceRun.result.behavior,
        )
        expect(encodedRun.result.state).toMatchObject({
          frame: 0,
          top: 1,
          captures: [],
          cleaned: true,
        })
        if (mode === 'paused')
          expect(decodedRun.process.pause?.resumeSignal).toBe('SIGCONT')
      }
      if (mode === 'paused') {
        expect(sourceRun.process.pause?.resumeSignal).toBe('SIGCONT')
        expect(encodedRun.process.pause?.resumeSignal).toBe('SIGCONT')
      }
    }
  })

test('retained strongest PATCH peer has independently rebuilt current B-E state', () => {
  const source = fixture('patch.js'),
    current = inspectCurrent(source)
  const container = current.A.result,
    before = JSON.stringify(container)
  const normalized = diagnoseNormalizeSelfModifyingWordcode(container, {
    source,
  })
  expect(normalized.ok).toBe(true)
  const result = normalized.result
  const B = diagnoseWordcode(result.container).result
  const C = diagnoseReferences(result.container, B).result
  const D = diagnoseFunctionPartition(result.container, B, C).result
  const E = diagnoseControlFlow(B, C, D).result
  expect(result.wordcode).toEqual(B)
  expect(result.references).toEqual(C)
  expect(result.functions).toEqual(D)
  expect(result.cfg).toEqual(E)
  expect(current.analysis.model.wordcode).toEqual(B)
  expect(current.analysis.model.functions).toEqual(D)
  expect(JSON.stringify(container)).toBe(before)
})

test('top-level normal-continuation finally stays an exact named emission decline', () => {
  const source = fixture('top-level-finally.js'),
    current = inspectCurrent(source)
  expect(current.A.ok).toBe(true)
  expect(current.analysis.ok).toBe(true)
  expect(current.publicRecord).toMatchObject({
    ok: false,
    output: source,
    diagnostic: { code: 'unemittable-structured-control' },
  })
  expect(current.publicRecord.diagnostic.message).toContain(
    'has no proved return continuation',
  )
  expect(current.inputState).toBe(true)
})
