import fs from 'node:fs'
import { expect, test } from 'vitest'
import {
  timingSourceRoles,
  observeTimingKnown,
  runTimingNative,
} from '../../../scripts/qualify-jsconfuser-vm/timing-observation.mjs'
import { assertTimingBehavior } from '../../../scripts/qualify-jsconfuser-vm/timing.mjs'

const fixture = (name) =>
  fs.readFileSync(
    new URL(
      `../../vm/jsconfuser-vm/fixtures/${name}/encoded.js`,
      import.meta.url,
    ),
    'utf8',
  )

test('transport/table emitted-effects detector sees present, absent and active-timing inputs', () => {
  const baseline = fixture('reference')
  expect(timingSourceRoles(baseline).emitted).toEqual({
    numericTransport: false,
    handlerTable: false,
  })
  for (const [name, expected] of [
    ['handler-table-boot', { numericTransport: false, handlerTable: true }],
    [
      'encoded-bytecode-arithmetic',
      { numericTransport: true, handlerTable: false },
    ],
  ]) {
    const source = fixture(name)
    expect(timingSourceRoles(source).emitted).toEqual(expected)
    expect(
      timingSourceRoles(
        source.replace(
          'var TIMING_CHECKS = false;',
          'var TIMING_CHECKS = 100;',
        ),
      ).emitted,
    ).toEqual(expected)
  }
  const table = fixture('handler-table-boot')
  const damaged = table.replace('this[op]();', 'this[op + 1]();')
  expect(damaged).not.toBe(table)
  expect(() => timingSourceRoles(damaged)).toThrow('Timing shell is not proved')
})

test('known-source real pause has observed stop/resume and completed child process', async () => {
  const source = 'window.pauseGate(); window.TEST_OUTPUT = 7;'
  const paused = await runTimingNative({ source, mode: 'paused' })
  expect(paused.result.behavior).toEqual({ kind: 'value', value: 7 })
  expect(paused.result.blockedMs).toBeGreaterThan(100)
  expect(paused.process).toMatchObject({
    exitCode: 0,
    signal: null,
    timedOut: false,
    pause: { signal: 'SIGSTOP', resumeSignal: 'SIGCONT' },
  })
  expect(() =>
    assertTimingBehavior(
      observeTimingKnown('window.TEST_OUTPUT = 8;').behavior,
      paused.result.behavior,
    ),
  ).toThrow()
})
