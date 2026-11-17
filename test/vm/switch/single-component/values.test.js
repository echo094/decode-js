import { test, expect } from 'vitest'
import { emitVmSwitchProgram } from '../../../../src/vm/switch/to-source.js'
import {
  runSource,
  casesOf,
  emitCopies,
  chain,
  chainRows,
  row,
  emitRun,
  literalOf,
  loggingHost,
  read,
  globalO,
  r,
} from './models.js'

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
    expect(emitted.output).toContain('__recovered_r_0_2 = W;')
    expect(emitted.declared).toEqual(emitted.used)
    expect(emitted.declared).not.toContain('__recovered_r_0_1')
  },
)

// `var x = W; RESULT = x;`, and with a closure capturing a register, `function f() { return x }`
// called before the write. A captured destination still coalesces: x is written once, at the
// producer, and nothing runs between. A captured source stays: the closure reads the temporary.
test.each([
  ['', null, true],
  [', its destination captured by a closure', 1, true],
  [' unless a closure captures its source', 0, false],
])('a single copy coalesces into its producer%s', (_, captured, coalesces) => {
  const operations = [
    { kind: 'global-read', destination: 0, name: 'W' },
    { kind: 'assign', destination: 1, value: { kind: 'register', index: 0 } },
    { kind: 'global-write', name: 'RESULT', source: 1 },
    { kind: 'return', source: 1 },
  ]
  if (captured !== null)
    operations.splice(
      2,
      2,
      {
        kind: 'closure',
        destination: 2,
        entry: 7,
        captures: [{ kind: 'local', index: captured }],
      },
      {
        kind: 'call',
        mode: 'apply',
        destination: 3,
        receiver: { kind: 'none' },
        callee: 2,
        arguments: { kind: 'fixed', registers: [] },
      },
      { kind: 'global-write', name: 'RESULT', source: 1 },
      { kind: 'global-write', name: 'SEEN', source: 3 },
      { kind: 'return', source: 1 },
    )
  const model = casesOf(operations, captured === null ? 2 : 4)
  if (captured !== null) {
    // The closure's body: return its captured register.
    model.storage.functions.push({ id: 1, registerCount: 1, captureCount: 1 })
    model.functions.functions.push({
      id: 1,
      startPc: 7,
      regCount: 1,
      paramCount: 0,
      captureCount: 1,
      hasRest: false,
    })
    model.instructionsByFunction.set(1, [
      {
        pc: 7,
        nextPc: 8,
        operation: { kind: 'upvalue-read', destination: 0, index: 0 },
      },
      { pc: 8, nextPc: 9, operation: { kind: 'return', source: 0 } },
    ])
    model.instructionCount += 2
  }
  const emitted = emitCopies(model)
  expect(emitted.result).toBe(140)
  expect(emitted.seen).toBe(captured === null ? undefined : 140)
  expect(emitted.copies.map(row)).toEqual(
    coalesces
      ? [
          {
            producerPc: 0,
            movePc: 1,
            sourceRegister: 0,
            destinationRegister: 1,
            reachingDefinitions: ['0'],
          },
        ]
      : [],
  )
  if (coalesces) expect(emitted.output).toContain('__recovered_r_0_1 = W;')
  else {
    expect(emitted.output).toContain('__recovered_r_0_0 = W;')
    expect(emitted.output).toContain('__recovered_r_0_1 = __recovered_r_0_0;')
  }
  expect(emitted.declared).toEqual(emitted.used)
})

test("a call's result coalesces into the move after it, across the call's continuation", () => {
  // `var x = F(); RESULT = x; return x;`: the call reaches the move by its continuation edge.
  const operations = [
    { kind: 'global-read', destination: 0, name: 'F' },
    {
      kind: 'call',
      mode: 'apply',
      destination: 1,
      receiver: { kind: 'none' },
      callee: 0,
      arguments: { kind: 'fixed', registers: [] },
    },
    { kind: 'assign', destination: 2, value: { kind: 'register', index: 1 } },
    { kind: 'global-write', name: 'RESULT', source: 2 },
    { kind: 'return', source: 2 },
  ]
  const model = casesOf(operations, 3)
  const { output, simplification } = emitVmSwitchProgram(model)
  const context = { RESULT: null, F: () => 140 }
  context.globalThis = context
  runSource(output, context)
  expect(context.RESULT).toBe(140)
  expect(simplification.functions[0].copies.map(row)).toEqual([
    {
      producerPc: 1,
      movePc: 2,
      sourceRegister: 1,
      destinationRegister: 2,
      reachingDefinitions: ['1'],
    },
  ])
  expect(output).toContain('__recovered_r_0_2 = F();')
  expect(output).not.toContain('__recovered_r_0_1')
})

test('a producer retargeted into its variable is not folded, even when read once', () => {
  // `var x = F(); x = F(x); RESULT = x;`: each value of x is read once, yet x is the source's
  // variable, written as a statement, not a temporary.
  const call = (destination, args) => ({
    kind: 'call',
    mode: 'apply',
    destination,
    receiver: { kind: 'none' },
    callee: 0,
    arguments: { kind: 'fixed', registers: args },
  })
  const move = (destination, source) => ({
    kind: 'assign',
    destination,
    value: { kind: 'register', index: source },
  })
  const { output, result } = emitRun(
    casesOf(
      [
        { kind: 'global-read', destination: 0, name: 'F' },
        call(1, []),
        move(2, 1),
        move(3, 2),
        call(1, [3]),
        move(2, 1),
        { kind: 'global-write', name: 'RESULT', source: 2 },
        literalOf(undefined, 4),
        { kind: 'return', source: 4 },
      ],
      5,
    ),
    { F: (value = 1) => value * 10 },
  )
  expect(result).toBe(100)
  // The copy chain carries the first call through x into the argument's register.
  expect(output).toContain(`${r(3)} = ${r(0)}();`)
  expect(output).toContain(`${r(2)} = ${r(0)}(${r(3)});`)
  expect(output).toContain(`globalThis["RESULT"] = ${r(2)};`)
})

test('a read every reaching definition gives one literal reads the literal, and its definition goes', () => {
  // `RESULT = 7; return 7;`: the compiler loads 7 into a register and reads it twice.
  const { output, result } = emitRun(
    casesOf(
      [
        literalOf(7),
        { kind: 'global-write', name: 'RESULT', source: 0 },
        { kind: 'return', source: 0 },
      ],
      1,
    ),
  )
  expect(result).toBe(7)
  expect(output).toContain('globalThis["RESULT"] = 7;')
  expect(output).toContain('return 7;')
  expect(output).not.toContain('__recovered_r_0_0')
})

test('a literal reaches through copies', () => {
  // `var w = 140; var d = w;`: every read of the chain's last register reads 140.
  const { output, result } = emitRun(
    casesOf([literalOf(140), ...chain.slice(1)], 3),
  )
  expect(result).toBe(140)
  expect(output).toContain('return 140;')
  expect(output).not.toMatch(/__recovered_r_0_\d/)
})

test('a read two different literals reach keeps its register', () => {
  // `x = A ? 1 : 2; RESULT = x;`
  const operations = [
    { kind: 'global-read', destination: 1, name: 'A' },
    { kind: 'branch', condition: 1, when: 'false', target: 4 },
    literalOf(1),
    { kind: 'jump', target: 5 },
    literalOf(2),
    { kind: 'global-write', name: 'RESULT', source: 0 },
    { kind: 'return', source: 0 },
  ]
  for (const [a, expected] of [
    [true, 1],
    [false, 2],
  ]) {
    const { output, result } = emitRun(casesOf(operations, 2), { A: a })
    expect(result).toBe(expected)
    expect(output).toContain('globalThis["RESULT"] = __recovered_r_0_0;')
  }
})

test('an upvalue read folds into the callee of a call without receiver', () => {
  // `var h = F; RESULT = (function () { return h(4); })();`: the inner function reads h through
  // its capture, written as the identifier, so `h(4)` passes the same `this` as `r = h; r(4)`.
  const model = casesOf(
    [
      { kind: 'global-read', destination: 0, name: 'F' },
      {
        kind: 'closure',
        destination: 1,
        entry: 6,
        captures: [{ kind: 'local', index: 0 }],
      },
      {
        kind: 'call',
        mode: 'apply',
        destination: 2,
        receiver: { kind: 'none' },
        callee: 1,
        arguments: { kind: 'fixed', registers: [] },
      },
      { kind: 'global-write', name: 'RESULT', source: 2 },
      { kind: 'return', source: 2 },
    ],
    3,
  )
  model.storage.functions.push({ id: 1, registerCount: 3, captureCount: 1 })
  model.functions.functions.push({
    id: 1,
    startPc: 6,
    regCount: 3,
    paramCount: 0,
    captureCount: 1,
    hasRest: false,
  })
  model.instructionsByFunction.set(1, [
    {
      pc: 6,
      nextPc: 7,
      operation: { kind: 'upvalue-read', destination: 0, index: 0 },
    },
    { pc: 7, nextPc: 8, operation: literalOf(4, 1) },
    {
      pc: 8,
      nextPc: 9,
      operation: {
        kind: 'call',
        mode: 'apply',
        destination: 2,
        receiver: { kind: 'none' },
        callee: 0,
        arguments: { kind: 'fixed', registers: [1] },
      },
    },
    { pc: 9, nextPc: 10, operation: { kind: 'return', source: 2 } },
  ])
  model.instructionCount = 10
  const { output, result } = emitRun(model, { F: (value) => value * 10 })
  expect(result).toBe(40)
  expect(output).toContain('return __recovered_r_0_0(4);')
})

test('an operand folds past an earlier slot that reads a captured variable', () => {
  // `var a = A; (function () { return a; }); RESULT = a.indexOf(O.v);`: the source reads a before
  // O.v, where the VM reads the receiver register only when the call runs; the native call is the
  // source's order.
  const model = casesOf(
    [
      { kind: 'global-read', destination: 0, name: 'A' },
      {
        kind: 'closure',
        destination: 1,
        entry: 11,
        captures: [{ kind: 'local', index: 0 }],
      },
      literalOf('indexOf', 2),
      { kind: 'property-read', destination: 3, object: 0, key: 2 },
      { kind: 'global-read', destination: 4, name: 'O' },
      literalOf('v', 5),
      { kind: 'property-read', destination: 6, object: 4, key: 5 },
      {
        kind: 'call',
        mode: 'apply',
        destination: 7,
        receiver: { kind: 'register', index: 0 },
        callee: 3,
        arguments: { kind: 'fixed', registers: [6] },
      },
      { kind: 'global-write', name: 'RESULT', source: 7 },
      { kind: 'return', source: 7 },
    ],
    8,
  )
  model.storage.functions.push({ id: 1, registerCount: 1, captureCount: 1 })
  model.functions.functions.push({
    id: 1,
    startPc: 11,
    regCount: 1,
    paramCount: 0,
    captureCount: 1,
    hasRest: false,
  })
  model.instructionsByFunction.set(1, [
    {
      pc: 11,
      nextPc: 12,
      operation: { kind: 'upvalue-read', destination: 0, index: 0 },
    },
    { pc: 12, nextPc: 13, operation: { kind: 'return', source: 0 } },
  ])
  model.instructionCount = 13
  const { output, result } = emitRun(model, { A: ['a', 'b'], O: { v: 'b' } })
  expect(result).toBe(1)
  expect(output).toContain('__recovered_r_0_0["indexOf"](O["v"])')
})

test('a literal into a register a closure captures stays in the register', () => {
  // `var x = 5; (function () { x = 9; })(); RESULT = x;`: the call writes x through its cell,
  // which no reaching definition records.
  const model = casesOf(
    [
      literalOf(5),
      {
        kind: 'closure',
        destination: 1,
        entry: 6,
        captures: [{ kind: 'local', index: 0 }],
      },
      {
        kind: 'call',
        mode: 'apply',
        destination: 2,
        receiver: { kind: 'none' },
        callee: 1,
        arguments: { kind: 'fixed', registers: [] },
      },
      { kind: 'global-write', name: 'RESULT', source: 0 },
      { kind: 'return', source: 0 },
      { kind: 'return', source: 0 },
    ],
    3,
  )
  model.storage.functions.push({ id: 1, registerCount: 1, captureCount: 1 })
  model.functions.functions.push({
    id: 1,
    startPc: 6,
    regCount: 1,
    paramCount: 0,
    captureCount: 1,
    hasRest: false,
  })
  model.instructionsByFunction.set(1, [
    { pc: 6, nextPc: 7, operation: literalOf(9) },
    {
      pc: 7,
      nextPc: 8,
      operation: { kind: 'upvalue-write', index: 0, source: 0 },
    },
    { pc: 8, nextPc: 9, operation: { kind: 'return', source: 0 } },
  ])
  model.instructionCount = 9
  const { output, result } = emitRun(model)
  expect(result).toBe(9)
  expect(output).toContain('globalThis["RESULT"] = __recovered_r_0_0;')
})

test('a definition nothing reads is dropped when it cannot throw, and written without its register when it can', () => {
  // `this` and `!x` are unused and pure; `x + x` can call valueOf, so its evaluation stays as an
  // expression statement and the register it wrote goes.
  const { output, result, simplification } = emitRun(
    casesOf(
      [
        { kind: 'assign', destination: 1, value: { kind: 'this' } },
        { kind: 'global-read', destination: 0, name: 'X' },
        {
          kind: 'assign',
          destination: 2,
          value: { kind: 'unary', operator: '!', source: 0 },
        },
        {
          kind: 'assign',
          destination: 3,
          value: { kind: 'binary', operator: '+', left: 0, right: 0 },
        },
        { kind: 'global-write', name: 'RESULT', source: 0 },
        { kind: 'return', source: 0 },
      ],
      4,
    ),
    { X: 3 },
  )
  expect(result).toBe(3)
  expect(output).not.toContain('= this;')
  expect(output).not.toContain('!__recovered_r_0_0')
  expect(output).toMatch(/^\s*__recovered_r_0_0 \+ __recovered_r_0_0;$/m)
  expect(output).not.toContain('__recovered_r_0_3')
  const { summary } = simplification
  expect(summary.safelyEliminated).toBe(2)
  expect(summary.emitted + summary.safelyEliminated).toBe(6)
})

test('a global read is its bare name, except where a bare name would not reach the global', () => {
  // `RESULT = [X, eval, __recovered_g]`: `eval` called bare would be a direct eval, and a
  // `__recovered_` name is the decode's own, so both keep the checked read.
  const { output, result } = emitRun(
    casesOf(
      [
        { kind: 'global-read', destination: 0, name: 'X' },
        { kind: 'global-read', destination: 1, name: 'eval' },
        { kind: 'global-read', destination: 2, name: '__recovered_g' },
        { kind: 'array', destination: 3, elements: [0, 1, 2] },
        { kind: 'global-write', name: 'RESULT', source: 3 },
        { kind: 'return', source: 3 },
      ],
      4,
    ),
    { X: 1, eval: 2, __recovered_g: 3 },
  )
  expect([...result]).toEqual([1, 2, 3])
  expect(output).toContain('__recovered_r_0_0 = X;')
  for (const name of ['eval', '__recovered_g'])
    expect(output).toContain(
      `if (!("${name}" in globalThis)) throw new ReferenceError("${name}" + " is not defined");`,
    )
})

test('a typeof of a global is native, except where a bare name would not reach the global', () => {
  // `RESULT = [typeof X, typeof toString, typeof eval, typeof missing, typeof arguments,
  // typeof __recovered_g]`: an inherited global (`toString`) is seen as the source sees it;
  // `arguments` in a function is its own binding and a `__recovered_` name the decode's own.
  const names = [
    'X',
    'toString',
    'eval',
    'missing',
    'arguments',
    '__recovered_g',
  ]
  const { output, result } = emitRun(
    casesOf(
      [
        ...names.map((name, destination) => ({
          kind: 'safe-typeof',
          destination,
          name,
        })),
        { kind: 'array', destination: 6, elements: [0, 1, 2, 3, 4, 5] },
        { kind: 'global-write', name: 'RESULT', source: 6 },
        { kind: 'return', source: 6 },
      ],
      7,
    ),
    { X: 1, eval: 2, arguments: 'a', __recovered_g: 3 },
  )
  expect([...result]).toEqual([
    'number',
    'function',
    'number',
    'undefined',
    'string',
    'number',
  ])
  for (const name of ['X', 'toString', 'eval', 'missing'])
    expect(output).toContain(`typeof ${name}`)
  for (const name of ['arguments', '__recovered_g'])
    expect(output).toContain(`typeof globalThis["${name}"]`)
  expect(output).not.toContain('hasOwnProperty')
})

test('call, construction, array and object operands read their literals too', () => {
  // `c = C; RESULT = [F(4), { k: 4 }.k, new c(4), new c(...[4])]`: every operand register holds a
  // dropped literal, and a construction is written `new`, as the source wrote it.
  const construct = (destination, args) => ({
    kind: 'call',
    mode: 'construct',
    destination,
    receiver: { kind: 'none' },
    callee: 7,
    arguments: args,
  })
  const { output, result } = emitRun(
    casesOf(
      [
        { kind: 'global-read', destination: 0, name: 'F' },
        literalOf(4, 1),
        {
          kind: 'call',
          mode: 'apply',
          destination: 2,
          receiver: { kind: 'none' },
          callee: 0,
          arguments: { kind: 'fixed', registers: [1] },
        },
        literalOf('k', 3),
        { kind: 'object', destination: 4, pairs: [{ key: 3, value: 1 }] },
        { kind: 'property-read', destination: 5, object: 4, key: 3 },
        { kind: 'global-read', destination: 7, name: 'C' },
        construct(8, { kind: 'fixed', registers: [1] }),
        { kind: 'array', destination: 9, elements: [1] },
        construct(10, { kind: 'array-register', registers: [9] }),
        { kind: 'array', destination: 6, elements: [2, 5, 8, 10] },
        { kind: 'global-write', name: 'RESULT', source: 6 },
        { kind: 'return', source: 6 },
      ],
      11,
    ),
    {
      F: (value) => value * 10,
      C: function (value) {
        this.value = value
      },
    },
  )
  expect([...result].map((item) => item.value ?? item)).toEqual([40, 4, 4, 4])
  expect(output).toContain('F(4)')
  expect(output).toContain('new __recovered_r_0_7(4)')
  expect(output).toContain('new __recovered_r_0_7(...[4])')
  expect(output).not.toContain('Reflect.construct')
  expect(output).not.toMatch(/__recovered_r_0_[013]\b/)
})

test('a for-in key nothing else writes or reads is still declared', () => {
  // `for (k in O); RESULT = 1;`: only the for-in step writes k.
  const { output, result } = emitRun(
    casesOf(
      [
        { kind: 'global-read', destination: 0, name: 'O' },
        { kind: 'for-in-setup', destination: 1, source: 0 },
        { kind: 'for-in-next', destination: 2, iterator: 1, exit: 4 },
        { kind: 'jump', target: 2 },
        literalOf(1, 3),
        { kind: 'global-write', name: 'RESULT', source: 3 },
        { kind: 'return', source: 3 },
      ],
      4,
    ),
    { O: { a: 1 } },
  )
  expect(result).toBe(1)
  expect(output).toMatch(/let [^;]*__recovered_r_0_2\b/)
})

test('a literal operand keeps its own evaluation: negative numbers and undefined', () => {
  // `RESULT = -(-1)`, then `undefined["x"]`, which must still throw.
  const operations = [
    literalOf(-1),
    {
      kind: 'assign',
      destination: 1,
      value: { kind: 'unary', operator: '-', source: 0 },
    },
    { kind: 'global-write', name: 'RESULT', source: 1 },
    literalOf(undefined, 2),
    literalOf('x', 3),
    { kind: 'property-read', destination: 0, object: 2, key: 3 },
    { kind: 'return', source: 0 },
  ]
  const model = casesOf(operations, 4)
  const { output } = emitVmSwitchProgram(model)
  const context = { RESULT: null }
  context.globalThis = context
  // The context's own TypeError, from another realm.
  expect(() => runSource(output, context)).toThrow(
    /Cannot read properties of undefined/,
  )
  expect(context.RESULT).toBe(1)
})

test('a single-use producer moves into its use, its operands in evaluation order', () => {
  // `RESULT = O.a + O.b;`
  const globals = loggingHost({ a: 1, b: 2 })
  const { output, result } = emitRun(
    casesOf(
      [
        globalO,
        literalOf('a', 1),
        read(2, 0, 1),
        literalOf('b', 3),
        read(4, 0, 3),
        {
          kind: 'assign',
          destination: 5,
          value: { kind: 'binary', operator: '+', left: 2, right: 4 },
        },
        { kind: 'global-write', name: 'RESULT', source: 5 },
        { kind: 'return', source: 5 },
      ],
      6,
    ),
    globals,
  )
  expect(result).toBe(3)
  expect(globals.LOG).toEqual(['a', 'b'])
  expect(output).toContain(`${r(5)} = ${r(0)}["a"] + ${r(0)}["b"];`)
  expect(output).not.toMatch(/__recovered_r_0_[1-4]\b/)
})

test('folds nest: a method read into its call, the call into an array, the array into a write', () => {
  // `RESULT = [T.push(2)];`, the compiler's method call: the callee read, then the call with
  // the object as receiver. The object's register is read by both, the call's read being the
  // object of its folded callee, so the global read folds and the call evaluates it once. In
  // `T.push(T)` the object is an argument too, read again, and keeps its register.
  const methodCall = (argument) =>
    casesOf(
      [
        { kind: 'global-read', destination: 0, name: 'T' },
        literalOf('push', 1),
        read(2, 0, 1),
        literalOf(2, 3),
        {
          kind: 'call',
          mode: 'apply',
          destination: 4,
          receiver: { kind: 'register', index: 0 },
          callee: 2,
          arguments: { kind: 'fixed', registers: [argument] },
        },
        { kind: 'array', destination: 5, elements: [4] },
        { kind: 'global-write', name: 'RESULT', source: 5 },
        literalOf(undefined, 6),
        { kind: 'return', source: 6 },
      ],
      7,
    )
  const folded = emitRun(methodCall(3), { T: [] })
  expect([...folded.result]).toEqual([1])
  expect(folded.output).toContain('globalThis["RESULT"] = [T["push"](2)];')
  expect(folded.output).not.toContain(r(0))
  const kept = emitRun(methodCall(0), { T: [] })
  expect([...kept.result]).toEqual([1])
  expect(kept.output).toContain(
    `globalThis["RESULT"] = [${r(0)}["push"](${r(0)})];`,
  )
})

test('a test folds into its branch, and a test with two empty arms still evaluates', () => {
  // `if (O.a < 2) RESULT = 1;`
  const operations = [
    globalO,
    literalOf('a', 1),
    read(2, 0, 1),
    literalOf(2, 3),
    {
      kind: 'assign',
      destination: 4,
      value: { kind: 'binary', operator: '<', left: 2, right: 3 },
    },
    { kind: 'branch', condition: 4, when: 'false', target: 8 },
    literalOf(1, 5),
    { kind: 'global-write', name: 'RESULT', source: 5 },
    literalOf(undefined, 6),
    { kind: 'return', source: 6 },
  ]
  for (const [a, expected] of [
    [1, 1],
    [3, null],
  ]) {
    const { output, result } = emitRun(
      casesOf(operations, 7),
      loggingHost({ a }),
    )
    expect(result).toBe(expected)
    expect(output).toContain('if (O["a"] < 2) {')
  }
  // `if (O.a);`: the read is the statement's only effect.
  const globals = loggingHost({ a: 1 })
  const { output } = emitRun(
    casesOf(
      [
        globalO,
        literalOf('a', 1),
        read(2, 0, 1),
        { kind: 'branch', condition: 2, when: 'false', target: 4 },
        { kind: 'return', source: 1 },
      ],
      3,
    ),
    globals,
  )
  expect(globals.LOG).toEqual(['a'])
  expect(output).not.toContain(`${r(2)} =`)
})

test('a conditional value folds into its use', () => {
  // `RESULT = F(C ? "a" : "b")`: each arm writes the argument register, which the call reads once.
  const operations = [
    { kind: 'global-read', destination: 0, name: 'F' },
    { kind: 'global-read', destination: 1, name: 'C' },
    { kind: 'branch', condition: 1, when: 'false', target: 5 },
    literalOf('a', 2),
    { kind: 'jump', target: 6 },
    literalOf('b', 2),
    {
      kind: 'call',
      mode: 'apply',
      destination: 3,
      receiver: { kind: 'none' },
      callee: 0,
      arguments: { kind: 'fixed', registers: [2] },
    },
    { kind: 'global-write', name: 'RESULT', source: 3 },
    literalOf(undefined, 4),
    { kind: 'return', source: 4 },
  ]
  // `RESULT = C ? O.a : O.b;`: the global write reads the value.
  const write = [
    globalO,
    { kind: 'global-read', destination: 3, name: 'C' },
    literalOf('a', 1),
    { kind: 'branch', condition: 3, when: 'false', target: 6 },
    read(2, 0, 1),
    { kind: 'jump', target: 8 },
    literalOf('b', 4),
    read(2, 0, 4),
    { kind: 'global-write', name: 'RESULT', source: 2 },
    literalOf(undefined, 5),
    { kind: 'return', source: 5 },
  ]
  // `var x = C ? "a" : "b"; RESULT = x + x;`: a move copies the value into the variable.
  const move = [
    { kind: 'global-read', destination: 1, name: 'C' },
    { kind: 'branch', condition: 1, when: 'false', target: 4 },
    literalOf('a', 2),
    { kind: 'jump', target: 5 },
    literalOf('b', 2),
    { kind: 'assign', destination: 0, value: { kind: 'register', index: 2 } },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'binary', operator: '+', left: 0, right: 0 },
    },
    { kind: 'global-write', name: 'RESULT', source: 3 },
    literalOf(undefined, 4),
    { kind: 'return', source: 4 },
  ]
  // `var x = C ? "a" : D ? "b" : "c"; RESULT = x + x;`: the inner value moves into the outer arm's
  // register, its use inside the outer value; it is written once, there.
  const nested = [
    { kind: 'global-read', destination: 1, name: 'C' },
    { kind: 'branch', condition: 1, when: 'false', target: 4 },
    literalOf('a', 2),
    { kind: 'jump', target: 10 },
    { kind: 'global-read', destination: 5, name: 'D' },
    { kind: 'branch', condition: 5, when: 'false', target: 8 },
    literalOf('b', 6),
    { kind: 'jump', target: 9 },
    literalOf('c', 6),
    { kind: 'assign', destination: 2, value: { kind: 'register', index: 6 } },
    { kind: 'assign', destination: 0, value: { kind: 'register', index: 2 } },
    {
      kind: 'assign',
      destination: 3,
      value: { kind: 'binary', operator: '+', left: 0, right: 0 },
    },
    { kind: 'global-write', name: 'RESULT', source: 3 },
    literalOf(undefined, 4),
    { kind: 'return', source: 4 },
  ]
  for (const [C, D, expected] of [
    [true, true, 'aa'],
    [false, true, 'bb'],
    [false, false, 'cc'],
  ]) {
    const { output, result } = emitRun(casesOf(nested, 7), { C, D })
    expect(result).toBe(expected)
    expect(output).toContain(`${r(0)} = C ? "a" : D ? "b" : "c";`)
  }
  for (const [C, expected] of [
    [true, 'A'],
    [false, 'B'],
  ]) {
    const variable = emitRun(casesOf(move, 5), { C })
    expect(variable.result).toBe(expected.toLowerCase().repeat(2))
    expect(variable.output).toContain(`${r(0)} = C ? "a" : "b";`)
    const call = emitRun(casesOf(operations, 5), {
      F: (value) => value.toUpperCase(),
      C,
    })
    expect(call.result).toBe(expected)
    expect(call.output).toContain('globalThis["RESULT"] = F(C ? "a" : "b");')
    const { output, result } = emitRun(casesOf(write, 6), {
      O: { a: 'A', b: 'B' },
      C,
    })
    expect(result).toBe(expected)
    expect(output).toContain(
      `globalThis["RESULT"] = C ? ${r(0)}["a"] : ${r(0)}["b"];`,
    )
  }
})

test('a conditional value keeps an arm written over several lines', () => {
  // `RESULT = F(C ? G(function () { return 7; }) : 1)`: the arm's call writes its function argument
  // over several lines, one expression.
  const model = casesOf(
    [
      { kind: 'global-read', destination: 0, name: 'F' },
      { kind: 'global-read', destination: 1, name: 'C' },
      { kind: 'branch', condition: 1, when: 'false', target: 7 },
      { kind: 'global-read', destination: 2, name: 'G' },
      { kind: 'closure', destination: 3, entry: 12, captures: [] },
      {
        kind: 'call',
        mode: 'apply',
        destination: 4,
        receiver: { kind: 'none' },
        callee: 2,
        arguments: { kind: 'fixed', registers: [3] },
      },
      { kind: 'jump', target: 8 },
      literalOf(1, 4),
      {
        kind: 'call',
        mode: 'apply',
        destination: 5,
        receiver: { kind: 'none' },
        callee: 0,
        arguments: { kind: 'fixed', registers: [4] },
      },
      { kind: 'global-write', name: 'RESULT', source: 5 },
      literalOf(undefined, 6),
      { kind: 'return', source: 6 },
    ],
    7,
  )
  model.storage.functions.push({ id: 1, registerCount: 1, captureCount: 0 })
  model.functions.functions.push({
    id: 1,
    startPc: 12,
    regCount: 1,
    paramCount: 0,
    captureCount: 0,
    hasRest: false,
  })
  model.instructionsByFunction.set(1, [
    { pc: 12, nextPc: 13, operation: literalOf(7) },
    { pc: 13, nextPc: 14, operation: { kind: 'return', source: 0 } },
  ])
  model.instructionCount = 14
  for (const [C, expected] of [
    [true, 7],
    [false, 1],
  ]) {
    const { output, result } = emitRun(model, {
      F: (value) => value,
      G: (callback) => callback(),
      C,
    })
    expect(result).toBe(expected)
    expect(output).toMatch(
      /globalThis\["RESULT"\] = F\(C \? G\(function \(\) \{\s*return 7;\s*\}\) : 1\);/,
    )
  }
})

// Each refusal keeps the producer's statement; folding it would change what the source does.
test.each([
  [
    // `x = O.b; if (C) x = O.a; RESULT = x;`: the read of r2 is reached by the read before the
    // branch and the one in its arm, no conditional value (one arm writes nothing).
    'two definitions reach the use',
    [
      globalO,
      { kind: 'global-read', destination: 3, name: 'C' },
      literalOf('b', 4),
      read(2, 0, 4),
      literalOf('a', 1),
      { kind: 'branch', condition: 3, when: 'false', target: 7 },
      read(2, 0, 1),
      { kind: 'global-write', name: 'RESULT', source: 2 },
      literalOf(undefined, 5),
      { kind: 'return', source: 5 },
    ],
    6,
    () => loggingHost({ a: 1, b: 2 }, { C: true }),
    (output, run) => {
      expect(run.result).toBe(1)
      expect(output).toContain(`${r(2)} = ${r(0)}["a"];`)
    },
  ],
  [
    // `var x = O.a; (function () { x = 9; })(); RESULT = x;`: the call writes x through its
    // cell, which no reaching definition records.
    'its register is captured by a closure',
    [
      globalO,
      literalOf('a', 1),
      read(2, 0, 1),
      {
        kind: 'closure',
        destination: 3,
        entry: 7,
        captures: [{ kind: 'local', index: 2 }],
      },
      {
        kind: 'call',
        mode: 'apply',
        destination: 4,
        receiver: { kind: 'none' },
        callee: 3,
        arguments: { kind: 'fixed', registers: [] },
      },
      { kind: 'global-write', name: 'RESULT', source: 2 },
      { kind: 'return', source: 1 },
    ],
    5,
    () => loggingHost({ a: 1 }),
    (output, run) => {
      expect(run.result).toBe(9)
      expect(output).toContain(`${r(2)} = O["a"];`)
    },
    true,
  ],
  [
    // `var t = typeof x; (function () { x = "s"; })(); RESULT = t;` with x = O.a captured: the
    // call writes the register the producer reads, through its cell.
    'it reads a register a call between writes through its cell',
    [
      globalO,
      literalOf('a', 1),
      read(2, 0, 1),
      {
        kind: 'closure',
        destination: 3,
        entry: 8,
        captures: [{ kind: 'local', index: 2 }],
      },
      { kind: 'assign', destination: 5, value: { kind: 'typeof', source: 2 } },
      {
        kind: 'call',
        mode: 'apply',
        destination: 4,
        receiver: { kind: 'none' },
        callee: 3,
        arguments: { kind: 'fixed', registers: [] },
      },
      { kind: 'global-write', name: 'RESULT', source: 5 },
      { kind: 'return', source: 1 },
    ],
    6,
    () => loggingHost({ a: 1 }),
    (output, run) => {
      expect(run.result).toBe('number')
      expect(output).toContain(`${r(5)} = typeof ${r(2)};`)
    },
    true,
  ],
  [
    // `var x = O.a; O.a = 2; RESULT = x;`: the write between changes what the read returns.
    'an effect lies between the producer and its use',
    [
      globalO,
      literalOf('a', 1),
      read(2, 0, 1),
      literalOf(2, 3),
      { kind: 'property-write', object: 0, key: 1, value: 3 },
      { kind: 'global-write', name: 'RESULT', source: 2 },
      { kind: 'return', source: 1 },
    ],
    4,
    () => loggingHost({ a: 1 }),
    (output, run) => {
      expect(run.result).toBe(1)
      expect(run.globals.LOG).toEqual(['a', 'set a'])
      expect(output).toContain(`${r(2)} = ${r(0)}["a"];`)
    },
  ],
  [
    // `var s = "before"; try { var x = O.a; s = "after"; RESULT = x; } catch (e) { CAUGHT = s; }`:
    // the read throws before the write, so the handler must see the earlier value.
    'a throwing producer under a try has a write the handler reads after it',
    [
      literalOf('before', 3),
      globalO,
      { kind: 'catch-setup', target: 9, exceptionRegister: 4 },
      literalOf('a', 1),
      read(2, 0, 1),
      literalOf('after', 3),
      { kind: 'global-write', name: 'RESULT', source: 2 },
      { kind: 'handler-pop' },
      { kind: 'jump', target: 10 },
      { kind: 'global-write', name: 'CAUGHT', source: 3 },
      { kind: 'return', source: 3 },
    ],
    5,
    () => loggingHost({ a: new Error('a') }, { CAUGHT: null }),
    (output, run) => {
      expect(run.globals.CAUGHT).toBe('before')
      expect(output).toContain(`${r(2)} = ${r(0)}["a"];`)
    },
  ],
  [
    // `var x = O.a; try { RESULT = x; } catch (e) { CAUGHT = 1; }`: the read throws outside the
    // try; moved into it, the handler would catch it.
    'a handler is installed between the producer and its use',
    [
      globalO,
      literalOf('a', 1),
      read(2, 0, 1),
      { kind: 'catch-setup', target: 7, exceptionRegister: 3 },
      { kind: 'global-write', name: 'RESULT', source: 2 },
      { kind: 'handler-pop' },
      { kind: 'jump', target: 9 },
      literalOf(1, 4),
      { kind: 'global-write', name: 'CAUGHT', source: 4 },
      { kind: 'return', source: 1 },
    ],
    5,
    () => loggingHost({ a: new Error('a') }, { CAUGHT: null }),
    (output, run) => {
      expect(run.error?.message).toBe('a')
      expect(run.globals.CAUGHT).toBe(null)
      expect(output).toContain(`${r(2)} = O["a"];`)
    },
  ],
  [
    // `var x = O.a; RESULT = O.b - x;`: x is the right operand but is read first, so only the
    // read of b, the left operand, moves into the subtraction.
    'its operand is consumed out of order',
    [
      globalO,
      literalOf('a', 1),
      read(2, 0, 1),
      literalOf('b', 3),
      read(4, 0, 3),
      {
        kind: 'assign',
        destination: 5,
        value: { kind: 'binary', operator: '-', left: 4, right: 2 },
      },
      { kind: 'global-write', name: 'RESULT', source: 5 },
      { kind: 'return', source: 5 },
    ],
    6,
    () => loggingHost({ a: 1, b: 5 }),
    (output, run) => {
      expect(run.result).toBe(4)
      expect(run.globals.LOG).toEqual(['a', 'b'])
      expect(output).toContain(`${r(2)} = ${r(0)}["a"];`)
      expect(output).toContain(`${r(5)} = ${r(0)}["b"] - ${r(2)};`)
    },
  ],
  [
    // `var f = O.f; RESULT = f();` calls f with `this` undefined; `O.f()` would pass O.
    'a member read would become the callee of a call without receiver',
    [
      globalO,
      literalOf('f', 1),
      read(2, 0, 1),
      {
        kind: 'call',
        mode: 'apply',
        destination: 3,
        receiver: { kind: 'none' },
        callee: 2,
        arguments: { kind: 'fixed', registers: [] },
      },
      { kind: 'global-write', name: 'RESULT', source: 3 },
      { kind: 'return', source: 1 },
    ],
    4,
    () => {
      const O = {
        f() {
          'use strict'
          return this === O
        },
      }
      return { O }
    },
    (output, run) => {
      expect(run.result).toBe(false)
      expect(output).toContain(`${r(2)} = O["f"];`)
    },
  ],
])(
  'a producer stays a statement when %s',
  (_, operations, registerCount, host, check, closureWritesCapture = false) => {
    const model = casesOf(operations, registerCount)
    if (closureWritesCapture) {
      // The closure's body: write 9 (or "s" for the typeof case) into its captured cell.
      const entry = operations.find(({ kind }) => kind === 'closure').entry
      const value = operations.some(({ value }) => value?.kind === 'typeof')
        ? 's'
        : 9
      model.storage.functions.push({ id: 1, registerCount: 1, captureCount: 1 })
      model.functions.functions.push({
        id: 1,
        startPc: entry,
        regCount: 1,
        paramCount: 0,
        captureCount: 1,
        hasRest: false,
      })
      model.instructionsByFunction.set(1, [
        { pc: entry, nextPc: entry + 1, operation: literalOf(value) },
        {
          pc: entry + 1,
          nextPc: entry + 2,
          operation: { kind: 'upvalue-write', index: 0, source: 0 },
        },
        {
          pc: entry + 2,
          nextPc: entry + 3,
          operation: { kind: 'return', source: 0 },
        },
      ])
      model.instructionCount += 3
    }
    const { output } = emitVmSwitchProgram(model)
    const globals = host()
    const context = { RESULT: null, ...globals }
    context.globalThis = context
    let error = null
    try {
      runSource(output, context)
    } catch (caught) {
      error = caught
    }
    check(output, { result: context.RESULT, globals: context, error })
  },
)
