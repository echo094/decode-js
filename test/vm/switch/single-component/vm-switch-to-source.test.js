import { test, expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { emitVmSwitchProgram } from '../../../../src/vm/switch/vm-switch-to-source.js'
import { scriptTimeout } from '../../../helper.js'

function runSource(source, context) {
  return runInNewContext(source, context, { timeout: scriptTimeout })
}

function sourceSwitchModel() {
  const cases = [
    {
      pc: 0,
      nextPc: 1,
      operation: {
        kind: 'assign',
        destination: 0,
        value: { kind: 'literal', value: 7 },
      },
    },
    {
      pc: 1,
      nextPc: 2,
      operation: { kind: 'global-write', name: 'RESULT', source: 0 },
    },
    { pc: 2, nextPc: 3, operation: { kind: 'return', source: 0 } },
  ]
  return {
    schemaVersion: 'decode-js-vm-switch.v1',
    storage: {
      kind: 'register-machine',
      functions: [{ id: 0, registerCount: 1, captureCount: 0 }],
    },
    functions: {
      functions: [
        {
          id: 0,
          startPc: 0,
          regCount: 1,
          paramCount: 0,
          captureCount: 0,
          hasRest: false,
        },
      ],
    },
    instructionsByFunction: new Map([[0, cases]]),
    instructionCount: 3,
  }
}

function withCases(cases, registerCount) {
  const model = sourceSwitchModel()
  model.storage.functions[0].registerCount = registerCount
  model.functions.functions[0].regCount = registerCount
  model.instructionsByFunction.set(0, cases)
  model.instructionCount = cases.length
  return model
}

test.each(['structured', 'dispatch'])(
  '%s: DEBUGGER emits no statement and preserves the following effect',
  (mode) => {
    const operations = [
      { kind: 'assign', destination: 0, value: { kind: 'literal', value: 7 } },
      { kind: 'debugger' },
      { kind: 'global-write', name: 'RESULT', source: 0 },
      { kind: 'return', source: 0 },
    ]
    const model = withCases(
      operations.map((operation, pc) => ({ pc, nextPc: pc + 1, operation })),
      1,
    )
    const { output } = emitVmSwitchProgram(model, {
      dispatch: mode === 'dispatch',
    })
    expect(output).not.toContain('debugger;')
    expect(output).not.toContain('void 0;')
    expect(output.includes('__recovered_dispatch')).toBe(mode === 'dispatch')
    const context = { RESULT: null }
    context.globalThis = context
    runSource(output, context)
    expect(context.RESULT).toBe(7)
  },
)

// One case per operation, each falling through to the next PC.
function casesOf(operations, registerCount) {
  return withCases(
    operations.map((operation, pc) => ({ pc, nextPc: pc + 1, operation })),
    registerCount,
  )
}

// Run the program; return RESULT, the copy proofs and the declared and used registers.
function emitCopies(model) {
  const { output, simplification } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  const [declaration, ...body] = output
    .split('\n')
    .filter((line) => line.includes('__recovered_r_0_'))
  const names = (lines) =>
    [...new Set(lines.join('\n').match(/__recovered_r_0_\d+/g) ?? [])].sort()
  return {
    output,
    result: context.RESULT,
    copies: simplification.functions[0].copies,
    declared: names([declaration]),
    used: names(body),
  }
}

// var w = 140; var d = w; (js-confuser-vm default options: LOAD_CONST, MOVE w, MOVE d = w).
// Both moves coalesce: the second move's producer is the first move, so the chain resolves to
// one write of the final register at the retained root.
const chain = [
  { kind: 'assign', destination: 0, value: { kind: 'literal', value: 140 } },
  { kind: 'assign', destination: 1, value: { kind: 'register', index: 0 } },
  { kind: 'assign', destination: 2, value: { kind: 'register', index: 1 } },
  { kind: 'global-write', name: 'RESULT', source: 2 },
  { kind: 'return', source: 2 },
]
const chainRows = (root, links) =>
  links.map(([producerPc, movePc, sourceRegister]) => ({
    producerPc: root,
    movePc,
    sourceRegister,
    destinationRegister: 2,
    reachingDefinitions: [String(producerPc)],
  }))
const row = ({
  producerPc,
  movePc,
  sourceRegister,
  destinationRegister,
  reachingDefinitions,
}) => ({
  producerPc,
  movePc,
  sourceRegister,
  destinationRegister,
  reachingDefinitions,
})

test.each([
  [
    'across blocks',
    chain,
    0,
    [
      [0, 1, 0],
      [1, 2, 1],
    ],
  ],
  // The root is laid out after its move and reaches it through a jump step, so the later
  // link (1 -> 2) is planned before the earlier one (5 -> 1), as in VM-1 vm-full.
  [
    'in reverse visit order through jump steps',
    [
      { kind: 'jump', target: 5 },
      chain[1],
      chain[2],
      chain[3],
      chain[4],
      chain[0],
      { kind: 'jump', target: 1 },
    ],
    5,
    [
      [1, 2, 1],
      [5, 1, 0],
    ],
  ],
])(
  'a copy chain %s resolves to one write of its final register',
  (_, operations, root, links) => {
    const emitted = emitCopies(casesOf(operations, 3))
    expect(emitted.result).toBe(140)
    expect(emitted.copies.map(row)).toEqual(chainRows(root, links))
    const removed = new Set(emitted.copies.map(({ movePc }) => movePc))
    expect(
      emitted.copies.some(({ producerPc }) => removed.has(producerPc)),
    ).toBe(false)
    expect(emitted.output).toContain('__recovered_r_0_2 = 140;')
    expect(emitted.declared).toEqual(emitted.used)
    expect(emitted.declared).not.toContain('__recovered_r_0_1')
  },
)

test('a single copy still coalesces into its producer', () => {
  const operations = [
    { kind: 'assign', destination: 0, value: { kind: 'literal', value: 140 } },
    { kind: 'assign', destination: 1, value: { kind: 'register', index: 0 } },
    { kind: 'global-write', name: 'RESULT', source: 1 },
    { kind: 'return', source: 1 },
  ]
  const emitted = emitCopies(casesOf(operations, 2))
  expect(emitted.result).toBe(140)
  expect(emitted.copies.map(row)).toEqual([
    {
      producerPc: 0,
      movePc: 1,
      sourceRegister: 0,
      destinationRegister: 1,
      reachingDefinitions: ['0'],
    },
  ])
  expect(emitted.output).toContain('__recovered_r_0_1 = 140;')
  expect(emitted.declared).toEqual(emitted.used)
})

test('declines a throw after handler pop, which is not a transfer', () => {
  const operations = [
    { kind: 'catch-setup', target: 4, exceptionRegister: 0 },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 7 } },
    { kind: 'handler-pop' },
    { kind: 'throw', source: 1 },
    { kind: 'global-write', name: 'CAUGHT', source: 0 },
    { kind: 'return', source: 0 },
  ]
  const model = casesOf(operations, 2)
  // After TRY_END the code is no longer protected but would sit inside the native try
  // block; the compiler only places transfers there, so anything else declines.
  expect(() => emitVmSwitchProgram(model)).toThrowError(/is not a transfer/)
})

test('declines an effect after handler pop, which is not a transfer', () => {
  const operations = [
    { kind: 'assign', destination: 0, value: { kind: 'literal', value: 9 } },
    { kind: 'catch-setup', target: 6, exceptionRegister: 1 },
    { kind: 'assign', destination: 2, value: { kind: 'literal', value: 7 } },
    { kind: 'handler-pop' },
    { kind: 'global-write', name: 'RESULT', source: 0 },
    { kind: 'return', source: 2 },
    { kind: 'return', source: 1 },
  ]
  const model = casesOf(operations, 3)
  // After TRY_END the code is no longer protected but would sit inside the native try
  // block; the compiler only places transfers there, so anything else declines.
  expect(() => emitVmSwitchProgram(model)).toThrowError(/is not a transfer/)
})

test('declines normal-completion work after handler pop', () => {
  const operations = [
    { kind: 'assign', destination: 0, value: { kind: 'literal', value: 9 } },
    { kind: 'catch-setup', target: 6, exceptionRegister: 1 },
    { kind: 'global-write', name: 'BODY', source: 0 },
    { kind: 'handler-pop' },
    { kind: 'global-write', name: 'NORMAL', source: 0 },
    { kind: 'jump', target: 7 },
    { kind: 'global-write', name: 'CAUGHT', source: 1 },
    { kind: 'global-write', name: 'RESULT', source: 0 },
    { kind: 'return', source: 0 },
  ]
  const model = casesOf(operations, 2)
  // The normal completion's work between TRY_END and its jump is not compiler grammar.
  expect(() => emitVmSwitchProgram(model)).toThrowError(/is not a transfer/)
})

test('a finalizer that never completes leaves its resume unreachable and stays native', () => {
  // The compiler's `try { } finally { RESULT = 2; return 2; }`: the resume after the finalizer's
  // return, the throw pad and after_finally are unreachable, yet the resume is the region's own.
  const operations = [
    {
      kind: 'finally-setup',
      target: 4,
      continuation: 1,
      payload: 2,
      throwPad: 8,
    },
    { kind: 'handler-pop' },
    { kind: 'assign', destination: 1, value: { kind: 'literal', value: 9 } },
    { kind: 'jump', target: 4 },
    { kind: 'assign', destination: 3, value: { kind: 'literal', value: 2 } },
    { kind: 'global-write', name: 'RESULT', source: 3 },
    { kind: 'return', source: 3 },
    { kind: 'indirect-jump', source: 1 },
    { kind: 'throw', source: 2 },
    { kind: 'assign', destination: 3, value: { kind: 'literal', value: 0 } },
    { kind: 'return', source: 3 },
  ]
  const { output, simplification } = emitVmSwitchProgram(casesOf(operations, 4))
  expect(output).toMatch(/try \{\s*\} finally \{/)
  // The resume, the throw pad and after_finally are dropped, not rendered.
  expect(output).not.toMatch(/if \(false\)/)
  expect(simplification.summary.provenUnreachable).toBe(4)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(2)
})

test('code after a return leaves no trace: no block, no function it alone creates, no for-in helper', () => {
  // The compiler's `RESULT = 7; return 7; f = function () { return 1; }; for (k in f);`: the
  // closure and the enumeration after the return are unreachable, and so is the child function.
  const model = casesOf(
    [
      { kind: 'assign', destination: 0, value: { kind: 'literal', value: 7 } },
      { kind: 'global-write', name: 'RESULT', source: 0 },
      { kind: 'return', source: 0 },
      { kind: 'closure', destination: 1, entry: 6, captures: [] },
      { kind: 'for-in-setup', destination: 2, source: 1 },
      { kind: 'return', source: 1 },
    ],
    3,
  )
  model.storage.functions.push({ id: 1, registerCount: 1, captureCount: 0 })
  model.functions.functions.push({
    id: 1,
    startPc: 6,
    regCount: 1,
    paramCount: 0,
    captureCount: 0,
    hasRest: false,
  })
  model.instructionsByFunction.set(1, [
    {
      pc: 6,
      nextPc: 7,
      operation: {
        kind: 'assign',
        destination: 0,
        value: { kind: 'literal', value: 1 },
      },
    },
    { pc: 7, nextPc: 8, operation: { kind: 'return', source: 0 } },
  ])
  model.instructionCount = 8
  const { output, simplification } = emitVmSwitchProgram(model)
  expect(output).not.toMatch(/if \(false\)/)
  expect(output).not.toContain('__recovered_function_1')
  expect(output).not.toContain('__recovered_enumerable_keys')
  expect(output).not.toMatch(/__recovered_r_0_[12]\b/)
  const { summary } = simplification
  expect(summary.provenUnreachable).toBe(5)
  expect(summary.unreachableFunctions).toBe(1)
  expect(
    summary.emitted + summary.safelyEliminated + summary.provenUnreachable,
  ).toBe(model.instructionCount)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(7)
})

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

// Run `output` once per [globals, expected] row; each row lists the globals the program writes.
function runRoutes(output, names, rows) {
  for (const [inputs, written] of rows) {
    const context = { ...inputs }
    for (const name of names) context[name] = null
    context.globalThis = context
    runSource(output, context)
    expect(names.filter((name) => context[name] !== null)).toEqual(written)
  }
}

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

test('emits a source-switch model without numeric wordcode', () => {
  const model = sourceSwitchModel()
  const { output } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(7)
  expect(output).not.toContain('BYTECODE')
  expect(output).not.toContain('__recovered_dispatch')
})

test('retains a catch dispatch when a typed case installs a handler', () => {
  const model = withCases(
    [
      {
        pc: 0,
        nextPc: 1,
        operation: { kind: 'catch-setup', target: 3, exceptionRegister: 0 },
      },
      {
        pc: 1,
        nextPc: 2,
        operation: {
          kind: 'assign',
          destination: 1,
          value: { kind: 'literal', value: 'boom' },
        },
      },
      { pc: 2, nextPc: 3, operation: { kind: 'throw', source: 1 } },
      {
        pc: 3,
        nextPc: 4,
        operation: { kind: 'global-write', name: 'RESULT', source: 0 },
      },
      { pc: 4, nextPc: 5, operation: { kind: 'return', source: 0 } },
    ],
    2,
  )
  const { output } = emitVmSwitchProgram(model, { dispatch: true })
  const context = { RESULT: null }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe('boom')
  expect(output).toContain('catch (__recovered_error)')
  expect(output).toContain('switch (__recovered_handler.register)')
})
