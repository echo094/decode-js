import fs from 'node:fs'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { diagnoseClassRuntime } from '../../../src/vm/jsconfuser-vm/analyze-class-runtime.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'

const fixture = fs.readFileSync(
  new URL('fixtures/class-runtime-boot/encoded.js', import.meta.url),
  'utf8',
)

function parsed() {
  return parse(fixture, {
    allowReturnOutsideFunction: true,
    sourceType: 'script',
  })
}

test('observes the connected payload, decoder, VM boot, and numeric dispatch', () => {
  const observation = diagnoseClassRuntime(fixture)
  expect(observation.ok).toBe(true)
  expect(observation.result).toMatchObject({
    schemaVersion: 'jsconfuser-vm-class-runtime-observation.v1',
    pool: { length: 7 },
    words: { length: 48 },
    vm: {
      fields: { words: 'r', pool: 'J', globals: 'I' },
      argumentPositions: { words: 4, pool: 0, globals: 2 },
    },
    decoder: { numericMode: true },
    root: { opcodeCases: 61 },
    frame: {
      closureField: 'o',
      pushMethod: 'y',
      start: { field: 'X', value: 0 },
      regCount: { field: 'M', value: 7 },
      headerSize: 8,
    },
    methods: {
      vm: {
        run: 'k',
        pushFrame: 'y',
        operand: 'Q',
        constant: 'x',
        captureUpvalue: 'i',
        closeUpvalues: 'm',
      },
      upvalue: {
        constructor: 'Upvalue',
        fields: { closed: 'Y', value: 'v', regs: 'U', absSlot: 'N' },
        read: 'ac',
        write: 'e',
        close: 'w',
      },
    },
    spreadSentinel: 65535,
    slots: {
      values: {
        PC: 0,
        CALLER: 1,
        RET_DST: 2,
        THIS: 3,
        CLOSURE: 4,
        HANDLERS: 5,
        FRAME_SIZE: 6,
        REG_BASE: 7,
      },
      fields: { regs: 'U', frame: 'G', nextFrame: 'ag' },
      frameStart: 1,
    },
    opcodeCases: {
      orderedCases: 61,
      arithmeticCases: 22,
      loadStoreCases: 11,
      unaryCases: 7,
      jumpCases: 4,
      callReturnCases: 5,
      closureCases: 1,
      collectionCases: 6,
      protectionCases: 5,
    },
    timingChecks: false,
  })
  expect(observation.result.pool.values).toEqual([
    'window',
    'TEST_OUTPUT',
    6,
    7,
    3,
    5,
    undefined,
  ])
  expect(observation.result.words.values).toHaveLength(48)
  expect(observation.result.words.values.at(-1)).toBe(2)
  expect(Object.isFrozen(observation.result.root)).toBe(true)
  expect(diagnoseContainer(fixture)).toMatchObject({
    ok: true,
    diagnostic: null,
    result: {
      schemaVersion: 'jsconfuser-vm-container.v1',
      encoding: 'numeric-u32',
      roles: {
        pool: { values: observation.result.pool.values },
        words: { values: observation.result.words.values },
        op: { name: null },
        slots: { values: observation.result.slots.values },
        methods: { vm: { run: { name: 'k' } } },
      },
    },
  })
})

test('finds roles after top-level binding renames', () => {
  const ast = parsed()
  traverse(ast, {
    Program(path) {
      for (const [before, after] of [
        ['BYTECODE', 'payloadWords'],
        ['CONSTANTS', 'payloadPool'],
        ['VM', 'Machine'],
        ['decodeBytecode', 'readPayload'],
        ['Closure', 'Shell'],
        ['Upvalue', 'CapturedCell'],
        ['vm', 'machineInstance'],
      ]) {
        path.scope.rename(before, after)
      }
    },
  })
  expect(diagnoseClassRuntime(ast)).toMatchObject({
    ok: true,
    result: {
      pool: { name: 'payloadPool' },
      words: { name: 'payloadWords' },
      vm: { constructor: 'Machine', instance: 'machineInstance' },
      root: { closureConstructor: 'Shell' },
      methods: { upvalue: { constructor: 'CapturedCell' } },
    },
  })
})

test('declines disconnected constant and upvalue methods', () => {
  const alteredConstant = parsed()
  traverse(alteredConstant, {
    AssignmentExpression(path) {
      const left = path.node.left
      if (
        left?.type !== 'MemberExpression' ||
        left.object?.type !== 'MemberExpression' ||
        left.object.object?.name !== 'VM' ||
        left.property?.name !== 'x'
      ) {
        return
      }
      const method = path.node.right
      const call = method.body.body
        .flatMap((statement) =>
          statement.type === 'VariableDeclaration'
            ? statement.declarations.map(({ init }) => init)
            : [],
        )
        .find(
          (init) =>
            init?.type === 'LogicalExpression' ||
            init?.type === 'CallExpression',
        )
      // The first constant operand is under a nullish-coalescing expression.
      const operandCall = call.type === 'LogicalExpression' ? call.right : call
      operandCall.callee.property.name = 'missingOperand'
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(alteredConstant)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-methods' },
  })

  const alteredUpvalue = parsed()
  traverse(alteredUpvalue, {
    ReturnStatement(path) {
      const expression = path.node.argument
      if (
        expression?.type === 'ConditionalExpression' &&
        expression.test?.property?.name === 'Y' &&
        expression.consequent?.property?.name === 'v'
      ) {
        expression.consequent.property.name = 'otherValue'
        path.stop()
      }
    },
  })
  expect(diagnoseClassRuntime(alteredUpvalue)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-methods' },
  })
})

test('declines a changed spread sentinel in one call path', () => {
  const ast = parsed()
  traverse(ast, {
    SwitchCase(path) {
      if (path.node.test?.value !== 43) return
      const body = path.node.consequent[0]
      const spread = body.body.find(
        (statement) =>
          statement.type === 'IfStatement' &&
          statement.test?.right?.value === 65535,
      )
      spread.test.right.value = 65534
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(ast)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-sentinel' },
  })
})

test('declines altered header, handler, and frame-start slots', () => {
  const alteredHeader = parsed()
  traverse(alteredHeader, {
    AssignmentExpression(path) {
      const left = path.node.left
      if (
        left?.object?.name === 'regs' &&
        left.property?.left?.name === 'fp' &&
        left.property?.right?.value === 7 &&
        path.node.right?.name === 'base'
      ) {
        left.property.right.value = 5
        path.stop()
      }
    },
  })
  expect(diagnoseClassRuntime(alteredHeader)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-slots' },
  })

  const alteredHandler = parsed()
  traverse(alteredHandler, {
    SwitchCase(path) {
      if (path.node.test?.value !== 55) return
      path.traverse({
        MemberExpression(inner) {
          const index = inner.node.property
          if (index?.left?.name === 'fp' && index.right?.value === 5) {
            index.right.value = 8
          }
        },
      })
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(alteredHandler)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-slots' },
  })

  const alteredStart = parsed()
  traverse(alteredStart, {
    FunctionDeclaration(path) {
      if (path.node.id.name !== 'VM') return
      const assignment = path.node.body.body.find(
        (statement) =>
          statement.type === 'ExpressionStatement' &&
          statement.expression.left?.property?.name === 'ag',
      ).expression
      assignment.right.value = 2
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(alteredStart)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-slots' },
  })
})

test('declines an altered upvalue capture slot', () => {
  const ast = parsed()
  traverse(ast, {
    AssignmentExpression(path) {
      const left = path.node.left
      if (
        left?.object?.type !== 'MemberExpression' ||
        left.object.object?.name !== 'VM' ||
        left.property?.name !== 'i'
      ) {
        return
      }
      const absSlot = path.node.right.body.body.find(
        (statement) =>
          statement.type === 'VariableDeclaration' &&
          statement.declarations.some(
            (declaration) => declaration.id.name === 'absSlot',
          ),
      ).declarations[0]
      absSlot.init.left.property.right.value = 8
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(ast)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-slots' },
  })
})

test('declines a changed arithmetic opcode meaning and admits case reordering', () => {
  const changedOperator = parsed()
  traverse(changedOperator, {
    SwitchCase(path) {
      if (path.node.test?.value !== 11) return
      path.traverse({
        AssignmentExpression(inner) {
          if (
            inner.node.left?.object?.name === 'regs' &&
            inner.node.right?.operator === '+'
          ) {
            inner.node.right.operator = '-'
          }
        },
      })
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(changedOperator)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-opcodes' },
  })

  const changedOrder = parsed()
  traverse(changedOrder, {
    SwitchStatement(path) {
      if (path.node.cases.length !== 62) return
      const left = path.node.cases.findIndex(
        (entry) => entry.test?.value === 11,
      )
      const right = path.node.cases.findIndex(
        (entry) => entry.test?.value === 12,
      )
      ;[path.node.cases[left], path.node.cases[right]] = [
        path.node.cases[right],
        path.node.cases[left],
      ]
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(changedOrder).ok).toBe(true)
})

test('declines changed load, store, unary, and jump handlers', () => {
  const mutations = [
    {
      opcode: 0,
      change(body) {
        const write = body.body.find(
          (statement) => statement.type === 'ExpressionStatement',
        ).expression
        write.right.callee.property.name = 'Q'
      },
    },
    {
      opcode: 8,
      change(body) {
        const write = body.body.find(
          (statement) => statement.type === 'ExpressionStatement',
        ).expression
        write.right.object = { type: 'Identifier', name: 'globalThis' }
      },
    },
    {
      opcode: 9,
      change(body) {
        const call = body.body.find(
          (statement) => statement.type === 'ExpressionStatement',
        ).expression
        call.callee.property.name = 'get'
      },
    },
    {
      opcode: 32,
      change(body) {
        const write = body.body.find(
          (statement) => statement.type === 'ExpressionStatement',
        ).expression
        write.right.operator = '!'
      },
    },
    {
      opcode: 40,
      change(body) {
        const branch = body.body.find(
          (statement) => statement.type === 'IfStatement',
        )
        branch.test = branch.test.argument
      },
    },
    {
      opcode: 58,
      change(body) {
        const write = body.body.find(
          (statement) => statement.type === 'ExpressionStatement',
        ).expression
        write.right = { type: 'NumericLiteral', value: 0 }
      },
    },
  ]
  for (const { opcode, change } of mutations) {
    const ast = parsed()
    traverse(ast, {
      SwitchCase(path) {
        if (path.node.test?.value !== opcode) return
        change(path.node.consequent[0])
        path.stop()
      },
    })
    expect(diagnoseClassRuntime(ast), `opcode ${opcode}`).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'class-runtime-opcodes' },
    })
    expect(diagnoseContainer(ast), `Packet A opcode ${opcode}`).toMatchObject({
      ok: false,
      result: null,
    })
  }
})

test('declines unexpected payload references', () => {
  const ast = parsed()
  ast.program.body.push({
    type: 'ExpressionStatement',
    expression: { type: 'Identifier', name: 'BYTECODE' },
  })
  expect(diagnoseClassRuntime(ast)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-boot' },
  })
  expect(diagnoseContainer(ast)).toMatchObject({ ok: false, result: null })
})

test('declines changed call, return, and throw handlers', () => {
  const mutations = [
    {
      opcode: 42,
      name: 'apply',
      replacement: 'call',
    },
    {
      opcode: 43,
      name: 'y',
      replacement: 'Q',
    },
    {
      opcode: 44,
      name: 'construct',
      replacement: 'apply',
    },
    {
      opcode: 45,
      name: 'm',
      replacement: 'Q',
    },
  ]
  for (const { opcode, name, replacement } of mutations) {
    const ast = parsed()
    traverse(ast, {
      SwitchCase(path) {
        if (path.node.test?.value !== opcode) return
        path.traverse({
          CallExpression(inner) {
            if (inner.node.callee?.property?.name !== name) return
            inner.node.callee.property.name = replacement
            inner.stop()
          },
        })
        path.stop()
      },
    })
    expect(diagnoseClassRuntime(ast), `opcode ${opcode}`).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'class-runtime-opcodes' },
    })
    expect(diagnoseContainer(ast), `Packet A opcode ${opcode}`).toMatchObject({
      ok: false,
      result: null,
    })
  }

  const alteredThrow = parsed()
  traverse(alteredThrow, {
    SwitchCase(path) {
      if (path.node.test?.value !== 46) return
      path.node.consequent[0].argument = { type: 'NumericLiteral', value: 1 }
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(alteredThrow)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-opcodes' },
  })
})

test('declines a disconnected closure shell or sub-VM', () => {
  const alteredSubVm = parsed()
  traverse(alteredSubVm, {
    SwitchCase(path) {
      if (path.node.test?.value !== 47) return
      path.traverse({
        NewExpression(inner) {
          if (inner.node.callee.name !== 'VM') return
          inner.node.callee.name = 'OtherMachine'
          inner.stop()
        },
      })
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(alteredSubVm)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-opcodes' },
  })

  const alteredShell = parsed()
  traverse(alteredShell, {
    SwitchCase(path) {
      if (path.node.test?.value !== 47) return
      path.traverse({
        CallExpression(inner) {
          if (
            inner.node.callee?.object?.name !== 'CLOSURE_MAP' ||
            inner.node.callee?.property?.name !== 'set'
          ) {
            return
          }
          inner.node.arguments[0].name = 'otherShell'
          inner.stop()
        },
      })
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(alteredShell)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-opcodes' },
  })
})

test('declines altered collection and iterator handlers', () => {
  const changes = [
    {
      opcode: 48,
      visitor: {
        NewExpression(path) {
          if (path.node.callee.name !== 'Array') return
          path.node.callee.name = 'Object'
          path.stop()
        },
      },
    },
    {
      opcode: 50,
      visitor: {
        ObjectProperty(path) {
          if (path.node.key.name !== 'get') return
          path.node.key.name = 'set'
          path.stop()
        },
      },
    },
    {
      opcode: 52,
      visitor: {
        CallExpression(path) {
          if (path.node.callee?.property?.name !== 'getPrototypeOf') return
          path.node.callee.property.name = 'getOwnPropertyNames'
          path.stop()
        },
      },
    },
    {
      opcode: 53,
      visitor: {
        UpdateExpression(path) {
          if (path.node.operator !== '++') return
          path.node.operator = '--'
          path.stop()
        },
      },
    },
  ]
  for (const { opcode, visitor } of changes) {
    const ast = parsed()
    traverse(ast, {
      SwitchCase(path) {
        if (path.node.test?.value !== opcode) return
        path.traverse(visitor)
        path.stop()
      },
    })
    expect(diagnoseClassRuntime(ast), `opcode ${opcode}`).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'class-runtime-opcodes' },
    })
    expect(diagnoseContainer(ast), `Packet A opcode ${opcode}`).toMatchObject({
      ok: false,
      result: null,
    })
  }
})

test('declines altered handler, rewrite, and debugger cases', () => {
  const changes = [
    {
      opcode: 54,
      visitor: {
        ObjectExpression(path) {
          if (path.node.properties.length !== 2) return
          path.node.properties[0].value = { type: 'NumericLiteral', value: 1 }
          path.stop()
        },
      },
    },
    {
      opcode: 55,
      visitor: {
        CallExpression(path) {
          if (path.node.callee?.property?.name !== 'pop') return
          path.node.callee.property.name = 'shift'
          path.stop()
        },
      },
    },
    {
      opcode: 59,
      visitor: {
        ObjectExpression(path) {
          if (path.node.properties.length !== 4) return
          path.node.properties.pop()
          path.stop()
        },
      },
    },
    {
      opcode: 56,
      visitor: {
        AssignmentExpression(path) {
          if (path.node.left?.object?.property?.name !== 'r') return
          path.node.right.operator = '>>'
          path.stop()
        },
      },
    },
    {
      opcode: 57,
      visitor: {
        DebuggerStatement(path) {
          path.replaceWith({ type: 'EmptyStatement' })
          path.stop()
        },
      },
    },
  ]
  for (const { opcode, visitor } of changes) {
    const ast = parsed()
    traverse(ast, {
      SwitchCase(path) {
        if (path.node.test?.value !== opcode) return
        path.traverse(visitor)
        path.stop()
      },
    })
    expect(diagnoseClassRuntime(ast), `opcode ${opcode}`).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'class-runtime-opcodes' },
    })
    expect(diagnoseContainer(ast), `Packet A opcode ${opcode}`).toMatchObject({
      ok: false,
      result: null,
    })
  }
})

test('declines an enabled timing branch', () => {
  const ast = parsed()
  traverse(ast, {
    IfStatement(path) {
      if (path.node.test?.type !== 'BooleanLiteral' || path.node.test.value) {
        return
      }
      path.node.test.value = true
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(ast)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-timing' },
  })
})

test('declines a disconnected payload bridge without a partial observation', () => {
  const ast = parsed()
  traverse(ast, {
    NewExpression(path) {
      if (
        path.node.callee.type === 'Identifier' &&
        path.node.callee.name === 'VM' &&
        path.parentPath.isVariableDeclarator()
      ) {
        const pool = path.node.arguments.find(
          (argument) =>
            argument.type === 'Identifier' && argument.name === 'CONSTANTS',
        )
        pool.name = 'undefined'
        path.stop()
      }
    },
  })
  expect(diagnoseClassRuntime(ast)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-boot' },
  })
})

test('declines an altered opcode case set and a mismatched root method', () => {
  const alteredCase = parsed()
  traverse(alteredCase, {
    SwitchStatement(path) {
      if (path.node.cases.length === 62) {
        path.node.cases.find((entry) => entry.test?.value === 58).test.value =
          61
        path.stop()
      }
    },
  })
  expect(diagnoseClassRuntime(alteredCase)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-boot' },
  })

  const alteredCall = parsed()
  const last = alteredCall.program.body.at(-1).expression
  last.callee.property.name = 'missingMethod'
  expect(diagnoseClassRuntime(alteredCall)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-boot' },
  })
})

test('declines a disconnected constructor field or opcode fetch', () => {
  const alteredConstructor = parsed()
  traverse(alteredConstructor, {
    FunctionDeclaration(path) {
      if (path.node.id.name !== 'VM') return
      const assignment = path.node.body.body.find(
        (statement) =>
          statement.type === 'ExpressionStatement' &&
          statement.expression.left?.property?.name === 'r',
      ).expression
      assignment.right.name = 'undefined'
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(alteredConstructor)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-fields' },
  })

  const alteredFetch = parsed()
  traverse(alteredFetch, {
    VariableDeclarator(path) {
      if (path.node.id.name !== 'op') return
      path.node.init.object.property.name = 'J'
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(alteredFetch)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-fields' },
  })
})

test('declines a disconnected closure descriptor or frame-size expression', () => {
  const alteredClosure = parsed()
  traverse(alteredClosure, {
    FunctionDeclaration(path) {
      if (path.node.id.name !== 'Closure') return
      const assignment = path.node.body.body.find(
        (statement) =>
          statement.type === 'ExpressionStatement' &&
          statement.expression.left?.property?.name === 'o',
      ).expression
      assignment.right.name = 'undefined'
      path.stop()
    },
  })
  expect(diagnoseClassRuntime(alteredClosure)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-frame' },
  })

  const alteredFrame = parsed()
  traverse(alteredFrame, {
    BinaryExpression(path) {
      if (
        path.node.operator === '+' &&
        path.node.left?.value === 8 &&
        path.node.right?.property?.name === 'M'
      ) {
        path.node.left.value = 9
        path.stop()
      }
    },
  })
  expect(diagnoseClassRuntime(alteredFrame)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'class-runtime-frame' },
  })
})
