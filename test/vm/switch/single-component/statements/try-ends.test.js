import { test, expect } from 'vitest'
import { emitVmSwitchProgram } from '../../../../../src/vm/switch/to-source.js'
import { runSource, casesOf, runRoutes } from '../models.js'

test('a labeled exit out of a try past its tail ends a labeled block around the try', () => {
  // The compiler's `L: { try { if (C) break L; } finally { } TAIL = 'tail'; } END = 'end';`: the
  // exit's pad jumps to the end, past the tail the normal exit runs, so the end is a member of the
  // try entered from that tail; the try closes at its tail with the end cut as a later end.
  const operations = [
    { kind: 'global-read', destination: 0, name: 'C' },
    {
      kind: 'finally-setup',
      target: 9,
      continuation: 1,
      payload: 2,
      throwPad: 10,
    },
    { kind: 'branch', condition: 0, when: 'false', target: 6 },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 11 } },
    { kind: 'handler-pop' },
    { kind: 'jump', target: 9 },
    { kind: 'handler-pop' },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 12 } },
    { kind: 'jump', target: 9 },
    { kind: 'indirect-jump', source: 1 },
    { kind: 'throw', source: 2 },
    { kind: 'jump', target: 14 },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: 'tail' },
    },
    { kind: 'global-write', name: 'TAIL', source: 3 },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: 'end' },
    },
    { kind: 'global-write', name: 'END', source: 3 },
    { kind: 'return', source: 3 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 4))
  for (const [C, TAIL] of [
    [1, null],
    [0, 'tail'],
  ]) {
    const context = { C, TAIL: null, END: null }
    context.globalThis = context
    runSource(output, context)
    expect([context.TAIL, context.END]).toEqual([TAIL, 'end'])
  }
})

test('a labeled exit out of a try past its tail ends a labeled block where an exit before the try lands too', () => {
  // The compiler's `L: { if (D) break L; try { if (C) break L; } finally { } TAIL = 'tail'; }
  // END = 'end';`: the exit before the try reaches the end too, so the end is no member of the
  // try and the try closes at its tail; the exit's pad still lands past that tail, at a later end.
  const operations = [
    { kind: 'global-read', destination: 0, name: 'C' },
    { kind: 'global-read', destination: 4, name: 'D' },
    { kind: 'branch', condition: 4, when: 'false', target: 4 },
    { kind: 'jump', target: 17 },
    {
      kind: 'finally-setup',
      target: 12,
      continuation: 1,
      payload: 2,
      throwPad: 13,
    },
    { kind: 'branch', condition: 0, when: 'false', target: 9 },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 14 } },
    { kind: 'handler-pop' },
    { kind: 'jump', target: 12 },
    { kind: 'handler-pop' },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 15 } },
    { kind: 'jump', target: 12 },
    { kind: 'indirect-jump', source: 1 },
    { kind: 'throw', source: 2 },
    { kind: 'jump', target: 17 },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: 'tail' },
    },
    { kind: 'global-write', name: 'TAIL', source: 3 },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: 'end' },
    },
    { kind: 'global-write', name: 'END', source: 3 },
    { kind: 'return', source: 3 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 5))
  for (const [D, C, TAIL] of [
    [1, 0, null],
    [0, 1, null],
    [0, 0, 'tail'],
  ]) {
    const context = { D, C, TAIL: null, END: null }
    context.globalThis = context
    runSource(output, context)
    expect([context.TAIL, context.END]).toEqual([TAIL, 'end'])
  }
})

test("a labeled exit from a loop in a try to the try's end ends a labeled block around the try", () => {
  // The compiler's `L: try { while (N) { if (C) break L; N = C; } AFTER = 'after'; } finally { }
  // END = 'end';`: the exit's pad lands at the try's own end, which the loop cannot reach with a
  // break of its own, so the try takes its end as a block end.
  const operations = [
    { kind: 'global-read', destination: 0, name: 'C' },
    {
      kind: 'finally-setup',
      target: 15,
      continuation: 1,
      payload: 2,
      throwPad: 16,
    },
    { kind: 'global-read', destination: 3, name: 'N' },
    { kind: 'branch', condition: 3, when: 'false', target: 10 },
    { kind: 'branch', condition: 0, when: 'false', target: 8 },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 17 } },
    { kind: 'handler-pop' },
    { kind: 'jump', target: 15 },
    { kind: 'global-write', name: 'N', source: 0 },
    { kind: 'jump', target: 2 },
    {
      kind: 'assign',
      destination: 4,
      value: { kind: 'literal', value: 'after' },
    },
    { kind: 'global-write', name: 'AFTER', source: 4 },
    { kind: 'handler-pop' },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 18 } },
    { kind: 'jump', target: 15 },
    { kind: 'indirect-jump', source: 1 },
    { kind: 'throw', source: 2 },
    { kind: 'jump', target: 18 },
    {
      kind: 'assign',
      destination: 4,
      value: { kind: 'literal', value: 'end' },
    },
    { kind: 'global-write', name: 'END', source: 4 },
    { kind: 'return', source: 4 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 5))
  for (const [N, C, AFTER] of [
    [1, 1, null],
    [1, 0, 'after'],
    [0, 1, 'after'],
  ]) {
    const context = { N, C, AFTER: null, END: null }
    context.globalThis = context
    runSource(output, context)
    expect([context.AFTER, context.END]).toEqual([AFTER, 'end'])
  }
})

test("a labeled exit from a catch past the try's tail closes the catch's test at the try's end", () => {
  // The compiler's `L: { try { P; } catch (e) { if (C) break L; } TAIL = 'tail'; } END = 'end';`:
  // the test's branch arm runs on through the try's end and its tail to the block's end, where
  // the exit jumps; the try's end is a stop, so the test closes there and the exit is a break.
  const operations = [
    { kind: 'global-read', destination: 0, name: 'C' },
    { kind: 'catch-setup', target: 5, exceptionRegister: 2 },
    { kind: 'global-read', destination: 3, name: 'P' },
    { kind: 'handler-pop' },
    { kind: 'jump', target: 7 },
    { kind: 'branch', condition: 0, when: 'false', target: 7 },
    { kind: 'jump', target: 9 },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: 'tail' },
    },
    { kind: 'global-write', name: 'TAIL', source: 3 },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: 'end' },
    },
    { kind: 'global-write', name: 'END', source: 3 },
    { kind: 'return', source: 3 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 4))
  for (const [C, P, TAIL] of [
    [1, false, null],
    [0, false, 'tail'],
    [1, true, 'tail'],
  ]) {
    const context = { C, TAIL: null, END: null, ...(P ? { P: 1 } : {}) }
    context.globalThis = context
    runSource(output, context)
    expect([context.TAIL, context.END]).toEqual([TAIL, 'end'])
  }
})

test("a labeled exit from a catch past the tail of a try that never completes closes at the try's layout end", () => {
  // The compiler's `L: { try { throw 1; } catch (e) { if (C) break L; } TAIL = 'tail'; } END = 'end';`:
  // the block always throws, so its pop and jump are dead and the try has no reachable end; the
  // catch's layout end places it at the tail, the exit lands past it, and the test closes there.
  const operations = [
    { kind: 'global-read', destination: 0, name: 'C' },
    { kind: 'catch-setup', target: 6, exceptionRegister: 2, layoutEnd: 8 },
    { kind: 'assign', destination: 3, value: { kind: 'literal', value: 1 } },
    { kind: 'throw', source: 3 },
    { kind: 'handler-pop' },
    { kind: 'jump', target: 8 },
    { kind: 'branch', condition: 0, when: 'false', target: 8 },
    { kind: 'jump', target: 10 },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: 'tail' },
    },
    { kind: 'global-write', name: 'TAIL', source: 3 },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'literal', value: 'end' },
    },
    { kind: 'global-write', name: 'END', source: 3 },
    { kind: 'return', source: 3 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 4))
  for (const [C, TAIL] of [
    [1, null],
    [0, 'tail'],
  ]) {
    const context = { C, TAIL: null, END: null }
    context.globalThis = context
    runSource(output, context)
    expect([context.TAIL, context.END]).toEqual([TAIL, 'end'])
  }
})

test("a catch's break out of a switch is no end of a try whose tail falls into the next clause", () => {
  // The compiler's `switch (X) { case 1: try { if (T) throw T; R2 = 'two'; } catch (e) { R3 =
  // 'three'; break; } R4 = 'four'; case 2: R5 = 'five'; } R7 = 'seven';`: the catch reaches only
  // the switch's end, a break target the try cannot tell from its own end until the switch row is
  // found, so the function is planned again with it.
  const write = (name, literal) => [
    {
      kind: 'assign',
      destination: 2,
      value: { kind: 'literal', value: literal },
    },
    { kind: 'global-write', name, source: 2 },
  ]
  const test = (literal, miss) => [
    {
      kind: 'assign',
      destination: 2,
      value: { kind: 'literal', value: literal },
    },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'binary', operator: '===', left: 0, right: 2 },
    },
    { kind: 'branch', condition: 3, when: 'false', target: miss },
  ]
  const operations = [
    { kind: 'global-read', destination: 0, name: 'X' },
    { kind: 'global-read', destination: 1, name: 'T' },
    ...test(1, 6),
    { kind: 'jump', target: 11 },
    ...test(2, 10),
    { kind: 'jump', target: 23 },
    { kind: 'jump', target: 25 },
    { kind: 'catch-setup', target: 18, exceptionRegister: 4, layoutEnd: 21 },
    { kind: 'branch', condition: 1, when: 'false', target: 14 },
    { kind: 'throw', source: 1 },
    ...write('R2', 'two'),
    { kind: 'handler-pop' },
    { kind: 'jump', target: 21 },
    ...write('R3', 'three'),
    { kind: 'jump', target: 25 },
    ...write('R4', 'four'),
    ...write('R5', 'five'),
    ...write('R7', 'seven'),
    { kind: 'return', source: 2 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 5))
  expect(output).toContain('switch (')
  runRoutes(
    output,
    ['R2', 'R3', 'R4', 'R5', 'R7'],
    [
      [{ X: 1, T: 0 }, ['R2', 'R4', 'R5', 'R7']],
      [{ X: 1, T: 1 }, ['R3', 'R7']],
      [{ X: 2, T: 0 }, ['R5', 'R7']],
      [{ X: 3, T: 0 }, ['R7']],
    ],
  )
})

test("a labeled exit from a catch is found through the catch's own route", () => {
  // The compiler's `switch (X) { case 3: try { if (T) throw T; R1 = 'one'; } catch (e) { R2 =
  // 'two'; break; } R3 = 'three'; default: R4 = 'four'; } E = 'end';`: one test is no switch, so
  // the test's arms meet without a first block, and only the catch's route, entered from the
  // try's setup, reaches the exit's landing past the default's body.
  const write = (name, literal) => [
    {
      kind: 'assign',
      destination: 2,
      value: { kind: 'literal', value: literal },
    },
    { kind: 'global-write', name, source: 2 },
  ]
  const operations = [
    { kind: 'global-read', destination: 0, name: 'X' },
    { kind: 'global-read', destination: 1, name: 'T' },
    { kind: 'assign', destination: 2, value: { kind: 'literal', value: 3 } },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'binary', operator: '===', left: 0, right: 2 },
    },
    { kind: 'branch', condition: 3, when: 'false', target: 6 },
    { kind: 'jump', target: 7 },
    { kind: 'jump', target: 19 },
    { kind: 'catch-setup', target: 14, exceptionRegister: 4, layoutEnd: 17 },
    { kind: 'branch', condition: 1, when: 'false', target: 10 },
    { kind: 'throw', source: 1 },
    ...write('R1', 'one'),
    { kind: 'handler-pop' },
    { kind: 'jump', target: 17 },
    ...write('R2', 'two'),
    { kind: 'jump', target: 21 },
    ...write('R3', 'three'),
    ...write('R4', 'four'),
    ...write('E', 'end'),
    { kind: 'return', source: 2 },
  ]
  const { output } = emitVmSwitchProgram(casesOf(operations, 5))
  runRoutes(
    output,
    ['R1', 'R2', 'R3', 'R4', 'E'],
    [
      [{ X: 3, T: 0 }, ['R1', 'R3', 'R4', 'E']],
      [{ X: 3, T: 1 }, ['R2', 'E']],
      [{ X: 0, T: 0 }, ['R4', 'E']],
    ],
  )
})
