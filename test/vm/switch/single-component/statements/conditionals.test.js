import { test, expect } from 'vitest'
import { emitVmSwitchProgram } from '../../../../../src/vm/switch/to-source.js'
import { casesOf, runRoutes } from '../models.js'

test('a conditional whose arms exit to two nested ends takes a labeled block for each', () => {
  // The compiler's `L1: { L2: { if (A) { if (X) break L2; if (Y) break L1; } R2 = 'two'; } R1 =
  // 'one'; } R0 = 'zero';`: the outer test's arms meet without a first block; its labeled block
  // ends at L2's end, and the exit past it, to L1's end, nests a second block outside the first.
  const write = (name, literal) => [
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: literal },
    },
    { kind: 'global-write', name, source: 3 },
  ]
  const operations = [
    { kind: 'global-read', destination: 0, name: 'A' },
    { kind: 'global-read', destination: 1, name: 'X' },
    { kind: 'global-read', destination: 2, name: 'Y' },
    { kind: 'branch', condition: 0, when: 'false', target: 8 },
    { kind: 'branch', condition: 1, when: 'false', target: 6 },
    { kind: 'jump', target: 10 },
    { kind: 'branch', condition: 2, when: 'false', target: 8 },
    { kind: 'jump', target: 12 },
    ...write('R2', 'two'),
    ...write('R1', 'one'),
    ...write('R0', 'zero'),
    { kind: 'return', source: 3 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 4))
  runRoutes(
    output,
    ['R2', 'R1', 'R0'],
    [
      [{ A: 1, X: 0, Y: 0 }, ['R2', 'R1', 'R0']],
      [{ A: 1, X: 1, Y: 0 }, ['R1', 'R0']],
      [{ A: 1, X: 0, Y: 1 }, ['R0']],
      [{ A: 0, X: 1, Y: 1 }, ['R2', 'R1', 'R0']],
    ],
  )
})

test('an inner test breaking a labeled block closes where the other arm completes', () => {
  // The compiler's `L1: { if (A) { if (X) R3 = 'three'; else break L1; } else R2 = 'two'; R1 =
  // 'one'; } R0 = 'zero';`: the inner test's arms reach the outer test's merge and the block's
  // end, never meeting; its else-or-end is the block's end, a break, so it closes at the merge.
  const write = (name, literal) => [
    {
      kind: 'assign',
      destination: 2,
      value: { kind: 'literal', value: literal },
    },
    { kind: 'global-write', name, source: 2 },
  ]
  const operations = [
    { kind: 'global-read', destination: 0, name: 'A' },
    { kind: 'global-read', destination: 1, name: 'X' },
    { kind: 'branch', condition: 0, when: 'false', target: 9 },
    { kind: 'branch', condition: 1, when: 'false', target: 7 },
    ...write('R3', 'three'),
    { kind: 'jump', target: 8 },
    { kind: 'jump', target: 13 },
    { kind: 'jump', target: 11 },
    ...write('R2', 'two'),
    ...write('R1', 'one'),
    ...write('R0', 'zero'),
    { kind: 'return', source: 2 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 3))
  runRoutes(
    output,
    ['R3', 'R2', 'R1', 'R0'],
    [
      [{ A: 1, X: 0 }, ['R0']],
      [{ A: 1, X: 1 }, ['R3', 'R1', 'R0']],
      [{ A: 0, X: 0 }, ['R2', 'R1', 'R0']],
    ],
  )
})

test('a break guard inside a labeled block keeps its guard reading', () => {
  // The compiler's `L: { if (A) { if (C) break L; R1 = 'one'; } T = 'tail'; } E = 'end';`: the
  // inner test's else-or-end is its own code, not the block's end, so it stays `if (C) break L;`
  // rather than closing at the outer test's merge with its code in an else.
  const write = (name, literal) => [
    {
      kind: 'assign',
      destination: 2,
      value: { kind: 'literal', value: literal },
    },
    { kind: 'global-write', name, source: 2 },
  ]
  const operations = [
    { kind: 'global-read', destination: 0, name: 'A' },
    { kind: 'global-read', destination: 1, name: 'C' },
    { kind: 'branch', condition: 0, when: 'false', target: 7 },
    { kind: 'branch', condition: 1, when: 'false', target: 5 },
    { kind: 'jump', target: 9 },
    ...write('R1', 'one'),
    ...write('T', 'tail'),
    ...write('E', 'end'),
    { kind: 'return', source: 2 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 3))
  expect(output).toContain('__recovered_block_')
  expect(output).not.toContain('} else {')
  runRoutes(
    output,
    ['R1', 'T', 'E'],
    [
      [{ A: 1, C: 0 }, ['R1', 'T', 'E']],
      [{ A: 1, C: 1 }, ['E']],
      [{ A: 0, C: 1 }, ['T', 'E']],
    ],
  )
})
