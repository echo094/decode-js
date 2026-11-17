import { test, expect } from 'vitest'
import { emitVmSwitchProgram } from '../../../../../src/vm/switch/to-source.js'
import { runSource, casesOf, switchInFunction, runSwitch } from '../models.js'

test("a switch's own break past a later clause takes no labeled block", () => {
  // The compiler's `switch (X) { case 1: R = 'one'; break; case 2: A = 'two'; case 3: B = 'three';
  // break; default: R = 'default'; } E = 'end';`: case 1's break skips the clauses after it, yet
  // not every clause body reaches anything before the switch's end, so it is a plain `break`.
  const value = (destination, literal) => ({
    kind: 'assign',
    destination,
    value: { kind: 'literal', value: literal },
  })
  const test = (literal, miss) => [
    value(1, literal),
    {
      kind: 'assign',
      destination: 2,
      value: { kind: 'binary', operator: '===', left: 0, right: 1 },
    },
    { kind: 'branch', condition: 2, when: 'false', target: miss },
  ]
  const operations = [
    { kind: 'global-read', destination: 0, name: 'X' },
    ...test(1, 5),
    { kind: 'jump', target: 14 },
    ...test(2, 9),
    { kind: 'jump', target: 17 },
    ...test(3, 13),
    { kind: 'jump', target: 19 },
    { kind: 'jump', target: 22 },
    value(1, 'one'),
    { kind: 'global-write', name: 'R', source: 1 },
    { kind: 'jump', target: 24 },
    value(1, 'two'),
    { kind: 'global-write', name: 'A', source: 1 },
    value(1, 'three'),
    { kind: 'global-write', name: 'B', source: 1 },
    { kind: 'jump', target: 24 },
    value(1, 'default'),
    { kind: 'global-write', name: 'R', source: 1 },
    value(1, 'end'),
    { kind: 'global-write', name: 'E', source: 1 },
    { kind: 'return', source: 1 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 3))
  expect(output).toContain('switch (')
  expect(output).not.toContain('__recovered_block_')
  // The switch compares its labels itself: no compare statement, no label run.
  expect(output).not.toContain('===')
  for (const label of [1, 2, 3]) expect(output).toContain(`case ${label}:`)
  for (const [X, expected] of [
    [1, ['one', null, null]],
    [2, [null, 'two', 'three']],
    [3, [null, null, 'three']],
    [4, ['default', null, null]],
  ]) {
    const context = { X, R: null, A: null, B: null, E: null }
    context.globalThis = context
    runSource(output, context)
    expect([context.R, context.A, context.B, context.E]).toEqual([
      ...expected,
      'end',
    ])
  }
})

test('a discriminant only the compares read is still bound and declared once the compares go', () => {
  const { output } = emitVmSwitchProgram(switchInFunction())
  expect(output).toContain('switch (__recovered_r_1_0)')
  expect(output).toContain('function (__recovered_r_1_0) {')
  expect(output).not.toContain('===')
  expect(output).toContain('case 1:')
  expect(output).toContain('case 2:')
  expect(runSwitch(output, ['A', 'B'], [1, 2, 3])).toEqual([
    ['a', 'b'],
    [null, 'b'],
    [null, null],
  ])
})

test.each([
  [
    // `T = <the last compare>;` after the switch reads the compares' register.
    'a compare also read after the switch',
    { after: [{ kind: 'global-write', name: 'T', source: 2 }] },
    ['A', 'B', 'T'],
    [
      ['a', 'b', true],
      [null, 'b', true],
      [null, null, false],
    ],
  ],
  [
    // A closure captures the compares' register: the function it creates may read it at any call.
    'a compare register a closure captures',
    { captured: true },
    ['A', 'B'],
    [
      ['a', 'b'],
      [null, 'b'],
      [null, null],
    ],
  ],
])(
  'a compare stays where something else reads it: %s',
  (name, shape, names, rows) => {
    const { output } = emitVmSwitchProgram(switchInFunction(shape))
    expect(output).toContain('__recovered_r_1_0 === 1')
    expect(output).toContain('__recovered_r_1_0 === 2')
    expect(runSwitch(output, names, [1, 2, 3])).toEqual(rows)
  },
)

test('`case g():` keeps the call in its label, and the compare goes', () => {
  // case 2's value is `g()`, a call of the parameter g into r3, which its label evaluates.
  const { output } = emitVmSwitchProgram(
    switchInFunction({
      withG: true,
      value2: [
        {
          kind: 'call',
          mode: 'apply',
          destination: 3,
          receiver: { kind: 'none' },
          callee: 1,
          arguments: { kind: 'fixed', registers: [] },
        },
      ],
    }),
  )
  expect(output).not.toContain('===')
  const calls = []
  const rows = [1, 2, 3].map((X) => {
    const context = { X, A: null, B: null, G: () => (calls.push(X), 2) }
    context.globalThis = context
    runSource(output, context)
    return [context.A, context.B]
  })
  expect(rows).toEqual([
    ['a', 'b'],
    [null, 'b'],
    [null, null],
  ])
  // G runs only when case 1 misses, as the chain runs it.
  expect(calls).toEqual([2, 3])
})
