import { test, expect } from 'vitest'
import { emitVmSwitchProgram } from '../../../../../src/vm/switch/to-source.js'
import {
  runSource,
  casesOf,
  emitRun,
  literalOf,
  add1,
  compareInto,
  loopEndOps,
} from '../models.js'

test('a nested exit past a tail of several blocks ends its labeled block where the exit lands', () => {
  // The compiler's `L: { if (A) { if (B) break L; } TAIL = 'tail'; } END = 'end';`: the exit
  // jump sits in the outer test's fallthrough arm and the tail spans two blocks, so a block
  // inside the tail also gives the arms a first block; only the end is reached past the merge.
  const operations = [
    { kind: 'global-read', destination: 0, name: 'A' },
    { kind: 'global-read', destination: 1, name: 'B' },
    { kind: 'branch', condition: 0, when: 'false', target: 5 },
    { kind: 'branch', condition: 1, when: 'false', target: 5 },
    { kind: 'jump', target: 7 },
    {
      kind: 'assign',
      destination: 2,
      value: { kind: 'literal', value: 'tail' },
    },
    { kind: 'global-write', name: 'TAIL', source: 2 },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: 'end' },
    },
    { kind: 'global-write', name: 'END', source: 3 },
    { kind: 'return', source: 3 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 4))
  for (const [A, B, TAIL] of [
    [1, 0, 'tail'],
    [1, 1, null],
    [0, 1, 'tail'],
  ]) {
    const context = { A, B, TAIL: null, END: null }
    context.globalThis = context
    runSource(output, context)
    expect([context.TAIL, context.END]).toEqual([TAIL, 'end'])
  }
})

test.each([
  [
    // `var i = 0; while (i < N) i = i + 1; RESULT = i;`, the same code as `for (i = 0; i < N; i++);`:
    // the write before the loop and the body's last write of the test's register are its clauses.
    'a top test whose run is one expression',
    [
      { kind: 'global-read', destination: 1, name: 'N' },
      literalOf(0, 0),
      compareInto(2, '<', 0, 1),
      { kind: 'branch', condition: 2, when: 'false', target: 7 },
      ...add1,
      { kind: 'jump', target: 2 },
      ...loopEndOps,
    ],
    'for (__recovered_r_0_0 = 0; __recovered_r_0_0 < __recovered_r_0_1; __recovered_r_0_0 = __recovered_r_0_0 + 1) {}',
    [
      [{ N: 3 }, 3],
      [{ N: 0 }, 0],
    ],
  ],
  [
    // `while (i < N && i !== S) i = i + 1;`: the run holds the short-circuit's own test.
    'a short-circuit test',
    [
      { kind: 'global-read', destination: 1, name: 'N' },
      { kind: 'global-read', destination: 4, name: 'S' },
      literalOf(0, 0),
      compareInto(2, '<', 0, 1),
      { kind: 'branch', condition: 2, when: 'false', target: 6 },
      compareInto(2, '!==', 0, 4),
      { kind: 'branch', condition: 2, when: 'false', target: 10 },
      ...add1,
      { kind: 'jump', target: 3 },
      ...loopEndOps,
    ],
    'for (__recovered_r_0_0 = 0; ',
    [
      [{ N: 5, S: 2 }, 2],
      [{ N: 1, S: 3 }, 1],
    ],
  ],
  [
    // `while (i < N) { if (i === S) break; i = i + 1; } RESULT = i;`: a break to the innermost
    // loop reaches it unlabeled.
    'a break to its own loop',
    [
      { kind: 'global-read', destination: 1, name: 'N' },
      { kind: 'global-read', destination: 4, name: 'S' },
      literalOf(0, 0),
      compareInto(2, '<', 0, 1),
      { kind: 'branch', condition: 2, when: 'false', target: 11 },
      compareInto(2, '===', 0, 4),
      { kind: 'branch', condition: 2, when: 'false', target: 8 },
      { kind: 'jump', target: 11 },
      ...add1,
      { kind: 'jump', target: 3 },
      ...loopEndOps,
    ],
    'for (__recovered_r_0_0 = 0; __recovered_r_0_0 < __recovered_r_0_1; __recovered_r_0_0 = __recovered_r_0_0 + 1) {',
    [
      [{ N: 3, S: 9 }, 3],
      [{ N: 3, S: 1 }, 1],
    ],
  ],
  [
    // `while (!(i >= N))` compiled as a jump-if-true exit, off the compiler's path.
    'a jump-if-true exit',
    [
      { kind: 'global-read', destination: 1, name: 'N' },
      literalOf(0, 0),
      compareInto(2, '>=', 0, 1),
      { kind: 'branch', condition: 2, when: 'true', target: 7 },
      ...add1,
      { kind: 'jump', target: 2 },
      ...loopEndOps,
    ],
    'for (__recovered_r_0_0 = 0; !(__recovered_r_0_0 >= __recovered_r_0_1); __recovered_r_0_0 = __recovered_r_0_0 + 1) {}',
    [
      [{ N: 3 }, 3],
      [{ N: 0 }, 0],
    ],
  ],
  [
    // `var i = 0; while (i < N) { i = i + 1; if (i === S) continue; i = i + 1; }`: the continue
    // skips the last write, which a for update would run.
    'a continue past the last write',
    [
      { kind: 'global-read', destination: 1, name: 'N' },
      { kind: 'global-read', destination: 4, name: 'S' },
      literalOf(0, 0),
      compareInto(2, '<', 0, 1),
      { kind: 'branch', condition: 2, when: 'false', target: 13 },
      ...add1,
      compareInto(2, '===', 0, 4),
      { kind: 'branch', condition: 2, when: 'false', target: 10 },
      { kind: 'jump', target: 3 },
      ...add1,
      { kind: 'jump', target: 3 },
      ...loopEndOps,
    ],
    'while (__recovered_r_0_0 < __recovered_r_0_1) {',
    [
      [{ N: 5, S: 1 }, 5],
      [{ N: 5, S: 9 }, 6],
    ],
  ],
  [
    // `var i = 0; var n = N; while (i < n) i = i + 1;`: the write before the loop is another
    // variable's, so nothing is the loop's init.
    'no write of its register just before it',
    [
      literalOf(0, 0),
      { kind: 'global-read', destination: 1, name: 'N' },
      compareInto(2, '<', 0, 1),
      { kind: 'branch', condition: 2, when: 'false', target: 7 },
      ...add1,
      { kind: 'jump', target: 2 },
      ...loopEndOps,
    ],
    'while (__recovered_r_0_0 < __recovered_r_0_1) {',
    [
      [{ N: 3 }, 3],
      [{ N: 0 }, 0],
    ],
  ],
  [
    // `var i = 0; do i = i + 1; while (i < N); RESULT = i;`
    'a do-while with a straight body',
    [
      { kind: 'global-read', destination: 1, name: 'N' },
      literalOf(0, 0),
      ...add1,
      compareInto(2, '<', 0, 1),
      { kind: 'branch', condition: 2, when: 'false', target: 7 },
      { kind: 'jump', target: 2 },
      ...loopEndOps,
    ],
    '} while (__recovered_r_0_0 < __recovered_r_0_1);',
    [
      [{ N: 3 }, 3],
      [{ N: 0 }, 1],
    ],
  ],
  [
    // `var n = 0; for (k in O) n = n + 1; RESULT = n;`: the setup and its step are the source's
    // own `for (k in O)`, with no enumeration helper.
    'a for-in step',
    [
      { kind: 'global-read', destination: 1, name: 'O' },
      literalOf(0, 0),
      { kind: 'for-in-setup', destination: 2, source: 1 },
      { kind: 'for-in-next', destination: 4, iterator: 2, exit: 7 },
      ...add1,
      { kind: 'jump', target: 3 },
      ...loopEndOps,
    ],
    'for (__recovered_r_0_4 in O) {',
    [
      [{ O: { a: 1, b: 2 } }, 2],
      [{ O: {} }, 0],
    ],
  ],
])(
  'a loop is written with its test in its head: %s',
  (name, operations, head, rows) => {
    const model = casesOf(operations, 5)
    for (const [globals, expected] of rows) {
      const { output, result } = emitRun(model, globals)
      expect(result).toBe(expected)
      expect(output).toContain(head)
      expect(output).not.toContain('while (true)')
      // Nothing transfers to the loop by name, so it carries no label.
      expect(output).not.toContain('__recovered_loop_')
      expect(output).not.toContain('__recovered_enumerable_keys')
    }
  },
)

test.each([
  [
    // `while (i < arguments)` at the root, where `arguments` is a global: its read keeps the
    // checked statement form (a bare name would read the function's own), so the test cannot
    // move into the head.
    'a header run with a statement',
    [
      literalOf(0, 0),
      { kind: 'global-read', destination: 1, name: 'arguments' },
      compareInto(2, '<', 0, 1),
      { kind: 'branch', condition: 2, when: 'false', target: 7 },
      ...add1,
      { kind: 'jump', target: 1 },
      ...loopEndOps,
    ],
    [
      [{ arguments: 3 }, [3, null]],
      [{ arguments: 0 }, [0, null]],
    ],
  ],
  [
    // `L: { while (i < N) { if (i === S) break L; i = i + 1; } T = 'tail'; } RESULT = i;`: the
    // loop's end moves past the tail, which its test's exit arm then holds.
    'an exit arm with code',
    [
      { kind: 'global-read', destination: 1, name: 'N' },
      { kind: 'global-read', destination: 4, name: 'S' },
      literalOf(0, 0),
      compareInto(2, '<', 0, 1),
      { kind: 'branch', condition: 2, when: 'false', target: 11 },
      compareInto(5, '===', 0, 4),
      { kind: 'branch', condition: 5, when: 'false', target: 8 },
      { kind: 'jump', target: 13 },
      ...add1,
      { kind: 'jump', target: 3 },
      literalOf('tail', 3),
      { kind: 'global-write', name: 'T', source: 3 },
      ...loopEndOps,
    ],
    [
      [{ N: 3, S: 9 }, [3, 'tail']],
      [{ N: 3, S: 1 }, [1, null]],
    ],
  ],
])(
  'a loop keeps `while (true)` where its test cannot lead it: %s',
  (name, operations, rows) => {
    const model = casesOf(operations, 6)
    for (const [globals, expected] of rows) {
      const { output, result } = emitRun(model, { T: null, ...globals })
      expect(output).toContain('while (true)')
      const context = { RESULT: null, T: null, ...globals }
      context.globalThis = context
      runSource(output, context)
      expect([result, context.T]).toEqual(expected)
    }
  },
)
