import fs from 'node:fs'
import { expect, test } from 'vitest'
import { inspectCurrent } from '../../../scripts/qualify-jsconfuser-vm/oracles.mjs'
import {
  timingProfiles,
  timingSources,
  assertTimingBehavior,
} from '../../../scripts/qualify-jsconfuser-vm/timing.mjs'
import {
  timingSourceRoles,
  observeTimingKnown,
  runTimingNative,
} from '../../../scripts/qualify-jsconfuser-vm/timing-observation.mjs'
import { diagnoseNormalizeSelfModifyingWordcode } from '../../../src/vm/jsconfuser-vm/normalize-self-modifying-wordcode.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'

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
  test(`current ${profile.name} finalizer recovery, real clocks and consumed state`, async () => {
    const source = fixture(`${profile.name}.js`),
      roles = timingSourceRoles(source)
    const current = inspectCurrent(source)
    const active = Boolean(profile.options.timingChecks)
    expect(current.publicRecord.ok).toBe(true)
    expect(current.publicRecord.output).not.toBe(source)
    expect(current.checks.ok).toBe(true)
    expect(current.inputState).toBe(true)
    expect(current.publicRecord.result.finalJavaScriptSemantics).toBe(false)
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
      // The decoded program carries no timing check: it behaves as the source in every mode.
      const decodedRun = await runTimingNative({
        source: current.publicRecord.output,
        mode,
      })
      assertTimingBehavior(
        decodedRun.result.behavior,
        sourceRun.result.behavior,
      )
      if (!active)
        expect(encodedRun.result.state).toMatchObject({
          frame: 0,
          top: 1,
          captures: [],
          cleaned: true,
        })
      if (mode === 'paused')
        expect(decodedRun.process.pause?.resumeSignal).toBe('SIGCONT')
      if (mode === 'paused') {
        expect(sourceRun.process.pause?.resumeSignal).toBe('SIGCONT')
        expect(encodedRun.process.pause?.resumeSignal).toBe('SIGCONT')
      }
    }
  })

// The PATCH stage removes only its own words; added opcodes stay for their own routes, so
// canonical B exists only after them. The consumed model holds neither.
test('retained strongest PATCH peer leaves its added opcodes to their own routes', () => {
  const source = fixture('patch.js'),
    current = inspectCurrent(source)
  const container = current.A.result,
    before = JSON.stringify(container)
  const normalized = diagnoseNormalizeSelfModifyingWordcode(container, {
    source,
  })
  expect(normalized.ok).toBe(true)
  const result = normalized.result
  const B = diagnoseWordcode(result.container)
  expect(result.wordcode).toEqual(B.ok ? B.result : null)
  expect(result.wordCount).toBeLessThan(result.originalWordCount)
  expect(JSON.stringify(container)).toBe(before)
  expect(current.analysis.ok).toBe(true)
  expect(
    current.analysis.model.wordcode.instructions.some(({ name }) =>
      ['PATCH', 'ALIAS', 'MACRO', 'SPECIALIZED', 'SYNTHETIC'].includes(name),
    ),
  ).toBe(false)
})

test('top-level normal-continuation finally recovers with source behaviour', async () => {
  const source = fixture('top-level-finally.js'),
    current = inspectCurrent(source)
  expect(current.A.ok).toBe(true)
  expect(current.analysis.ok).toBe(true)
  expect(current.publicRecord.ok).toBe(true)
  expect(current.publicRecord.output).not.toBe(source)
  expect(current.checks.ok).toBe(true)
  expect(current.inputState).toBe(true)
  const topLevelSource = fixture('top-level-finally.src.js')
  for (const mode of ['fast', 'slow', 'paused']) {
    const sourceRun = await runTimingNative({ source: topLevelSource, mode })
    const decodedRun = await runTimingNative({
      source: current.publicRecord.output,
      mode,
    })
    assertTimingBehavior(decodedRun.result.behavior, sourceRun.result.behavior)
  }
})
