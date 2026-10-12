import fs from 'node:fs'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { expect, test } from 'vitest'
import { diagnoseMinifiedClassRuntime as observe } from '../../../src/vm/jsconfuser-vm/observe-minified-class-runtime.js'
import { diagnoseMinifiedClassBoot } from '../../../src/vm/jsconfuser-vm/observe-minified-class-boot.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseWordcode } from '../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { semanticShape } from '../../../src/vm/jsconfuser-vm/minified-class-semantic-clauses.js'
import {
  ownedFunctions,
  OWNED_CLAUSES,
} from '../../../src/vm/jsconfuser-vm/minified-class-owned-functions.js'
import {
  makeContext,
  ContainerDecline,
} from '../../../src/vm/jsconfuser-vm/container-role-helpers.js'
const seeds = [169, 170, 171]
const roles = [
  'operand',
  'constant',
  'VM',
  'Closure',
  'Upvalue',
  'bytes',
  'pushFrame',
  'capture',
  'closeFrame',
  'readUpvalue',
  'writeUpvalue',
  'run',
]
const fixture = (name) =>
  fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')
const encoded = (kind, seed) =>
  fixture(
    `${kind === 'arithmetic' ? 'minified-class-boot' : `minified-class-runtime/${kind}`}/encoded-${seed}.js`,
  )
function setup(seed = 169, kind = 'arithmetic') {
  const source = encoded(kind, seed),
    positive = observe(source)
  expect(positive.ok, JSON.stringify(positive.diagnostic)).toBe(true)
  const ast = parse(source, { sourceType: 'script' })
  let dispatch
  const functions = []
  traverse(ast, {
    SwitchStatement(path) {
      dispatch = path
    },
    Function(path) {
      functions.push(path)
    },
  })
  function owned(role) {
    const info = positive.result.functions.find((item) => item.role === role)
    return functions.find((path) =>
      info.kind === 'method'
        ? path.parentPath.isAssignmentExpression() &&
          path.parentPath.node.left.property.name === info.name
        : path.node.id?.name === info.name,
    )
  }
  return {
    ast,
    source,
    positive: positive.result,
    dispatch,
    owned,
    case: (opcode) =>
      dispatch
        .get('cases')
        .find((path) => (path.node.test?.value ?? null) === opcode),
  }
}
function frozen(value) {
  return (
    !value ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(frozen))
  )
}
function rejects(state, code, message) {
  expect(observe(generate(state.ast).code)).toEqual({
    ok: false,
    result: null,
    diagnostic: { code, message },
  })
}
const opaque = () => parse('opaqueEffect()').program.body[0]
function first(path, type, predicate = () => true) {
  let selected
  path.traverse({
    [type](candidate) {
      if (!selected && predicate(candidate.node, candidate))
        selected = candidate
    },
  })
  expect(selected, `${type} mutation reaches its detector`).toBeDefined()
  return selected
}
for (const kind of ['arithmetic', 'exceptions', 'nested-strings'])
  for (const seed of seeds) {
    test(`${kind}/${seed}: complete graph, metadata, immutability and complete-only admission`, () => {
      const state = setup(seed, kind),
        graph = state.positive
      expect(graph.schemaVersion).toBe(
        'jsconfuser-vm-minified-class-runtime.v1',
      )
      expect(graph.proof).toEqual({
        kind: 'source-AST',
        scope: 'complete-selected-runtime',
        publicAdmission: false,
        nativeEquivalence: false,
      })
      expect(
        graph.handlers
          .filter((item) => item.opcode !== null)
          .map((item) => item.opcode)
          .sort((a, b) => a - b),
      ).toEqual(Array.from({ length: 61 }, (_, index) => index))
      expect(graph.handlers.at(-1).name).toBe('DEFAULT')
      expect(graph.functions.map((item) => item.role)).toEqual(roles)
      expect(graph.connections.length).toBeGreaterThan(170)
      for (const role of roles)
        expect(
          graph.connections.some((edge) => edge.to === role),
          role,
        ).toBe(true)
      for (const name of [
        'LOAD_UPVALUE',
        'STORE_UPVALUE',
        'CALL',
        'CALL_METHOD',
        'NEW',
        'RETURN',
        'MAKE_CLOSURE',
      ]) {
        const opcode = graph.handlers.find((item) => item.name === name).opcode
        expect(
          graph.connections.some((edge) => edge.from === `handler:${opcode}`),
          name,
        ).toBe(true)
      }
      expect(graph.fields.regsField).toBe(graph.boot.frame.regs)
      expect(graph.fields.wordsField).toBe(graph.boot.fields.words)
      expect(graph.effects).toMatchObject({
        entry: 'complete',
        exception: 'complete',
        completion: 'complete',
      })
      expect(graph.effects.dummyWrites.length).toBeGreaterThan(0)
      expect(frozen(graph)).toBe(true)
      const before = JSON.stringify(state.ast)
      expect(observe(state.ast).ok).toBe(true)
      expect(JSON.stringify(state.ast)).toBe(before)
      expect(diagnoseMinifiedClassBoot(state.source).result.schemaVersion).toBe(
        'jsconfuser-vm-minified-class-boot.v1',
      )
      expect(diagnoseContainer(state.source)).toMatchObject({
        ok: true,
        diagnostic: null,
        result: {
          roles: {
            words: { values: graph.boot.words },
            pool: { values: graph.boot.pool },
          },
        },
      })
    })
    if (kind !== 'arithmetic')
      test(`${kind}/${seed}: decoded payload feature connections`, () => {
        const graph = setup(seed, kind).positive
        const stream = diagnoseWordcode({
          roles: { words: { values: graph.boot.words } },
        })
        expect(stream.ok, JSON.stringify(stream.diagnostic)).toBe(true)
        expect(stream.result.consumedWords).toBe(graph.boot.words.length)
        const instructions = stream.result.instructions,
          at = (pc) => instructions.find((item) => item.pc === pc)
        const closures = instructions.filter(
          (item) => item.name === 'MAKE_CLOSURE',
        )
        for (const closure of closures)
          expect(at(closure.functionMeta.startPc)).toBeDefined()
        if (kind === 'exceptions') {
          expect(closures).toHaveLength(1)
          const catchSetup = instructions.find(
              (item) => item.opcode.value === 54,
            ),
            finallySetup = instructions.find(
              (item) => item.name === 'FINALLY_SETUP',
            )
          expect(catchSetup).toBeDefined()
          expect(finallySetup).toBeDefined()
          expect(at(catchSetup.operands[0].pc)).toBeDefined()
          expect(at(finallySetup.operands[0].pc)).toBeDefined()
          expect(at(finallySetup.operands[3].pc).name).toBe('THROW')
          expect(instructions.some((item) => item.name === 'TRY_END')).toBe(
            true,
          )
          expect(instructions.some((item) => item.name === 'JUMP_REG')).toBe(
            true,
          )
          expect(graph.boot.pool).toEqual(
            expect.arrayContaining(['negative', 'message', 'finished']),
          )
        } else {
          expect(
            closures.map((item) =>
              item.captures.map((capture) => capture.kind),
            ),
          ).toEqual([[], ['local'], ['upvalue', 'local']])
          expect(
            instructions
              .filter((item) => item.name === 'LOAD_UPVALUE')
              .map((item) => item.operands[1].index),
          ).toEqual([0, 1])
          expect(graph.boot.pool).toEqual(expect.arrayContaining(['id', ':']))
        }
      })
  }
for (const seed of seeds)
  test(`${seed}: alpha/member renames and legitimate definition/case order pass`, () => {
    const state = setup(seed),
      bindings = new Set()
    traverse(state.ast, {
      Scopable(path) {
        for (const binding of Object.values(path.scope.bindings))
          bindings.add(binding)
      },
    })
    let counter = 0
    for (const binding of bindings)
      binding.scope.rename(binding.identifier.name, `renamed_${counter++}`)
    const fields = new Map(
      Object.values(state.positive.fields).map((name, index) => [
        name,
        `field_${index}`,
      ]),
    )
    for (const info of state.positive.functions.filter(
      (item) => item.kind === 'method',
    ))
      fields.set(info.name, `method_${counter++}`)
    for (const effect of state.positive.effects.dummyWrites)
      fields.set(effect.field, `dummy_${counter++}`)
    traverse(state.ast, {
      MemberExpression(path) {
        if (!path.node.computed && fields.has(path.node.property.name))
          path.node.property.name = fields.get(path.node.property.name)
      },
      ObjectProperty(path) {
        if (!path.node.computed && fields.has(path.node.key.name))
          path.node.key.name = fields.get(path.node.key.name)
      },
    })
    state.dispatch.node.cases.reverse()
    const declarations = state.ast.program.body
      .filter((node) => node.type === 'FunctionDeclaration')
      .reverse()
    let index = 0
    state.ast.program.body = state.ast.program.body.map((node) =>
      node.type === 'FunctionDeclaration' ? declarations[index++] : node,
    )
    expect(observe(generate(state.ast).code).ok).toBe(true)
  })
for (const opcode of [...Array.from({ length: 61 }, (_, index) => index), null])
  test(`handler ${opcode}: unproved tail declines atomically`, () => {
    const state = setup(),
      selected = state.case(opcode)
    const name = state.positive.handlers.find(
      (item) => item.opcode === opcode,
    ).name
    selected.node.consequent.push(opaque())
    rejects(
      state,
      opcode === 0 ? 'incomplete-role' : 'minified-class-handler',
      opcode === 0
        ? 'LOAD_CONST case shape is incomplete'
        : `${name}: complete handler body or connection changed`,
    )
  })
for (const role of [
  'VM',
  'Closure',
  'Upvalue',
  'pushFrame',
  'capture',
  'closeFrame',
  'readUpvalue',
  'writeUpvalue',
])
  test(`${role}: complete owned body accounts for every effect`, () => {
    const state = setup()
    state.owned(role).node.body.body.push(opaque())
    if (role === 'VM' || role === 'pushFrame')
      rejects(
        state,
        'incomplete-role',
        `LOAD_CONST ${role === 'VM' ? 'constructor' : 'frame helper'} effects are outside the closed entry shape`,
      )
    else
      rejects(
        state,
        'minified-class-functions',
        `${role}: complete owned body is missing or changed`,
      )
  })
for (const seed of seeds) {
  test(`${seed}: arithmetic effect and opposite mapping damage discriminate`, () => {
    let state = setup(seed)
    first(
      state.case(11),
      'BinaryExpression',
      (node) => node.operator === '+',
    ).node.operator = '-'
    rejects(
      state,
      'minified-class-handler',
      'ADD: complete handler body or connection changed',
    )
    state = setup(seed)
    const add = state.case(11),
      sub = state.case(12)
    add.node.test.value = 12
    sub.node.test.value = 11
    rejects(
      state,
      'minified-class-handler',
      'SUB: complete handler body or connection changed',
    )
  })
  test(`${seed}: connected receiver and live-role alias damage decline`, () => {
    let state = setup(seed)
    const operand = state.positive.functions.find(
      (item) => item.role === 'operand',
    )
    const call = first(state.case(11), 'CallExpression', (node) =>
      node.callee.type === 'Identifier'
        ? node.callee.name === operand.name
        : node.callee.property.name === operand.name,
    )
    if (operand.kind === 'method')
      call.node.callee.object = { type: 'NumericLiteral', value: 0 }
    else
      call.node.arguments[operand.parameterPositions[0]] = {
        type: 'NumericLiteral',
        value: 0,
      }
    rejects(
      state,
      'minified-class-handler',
      'ADD: complete handler body or connection changed',
    )
    state = setup(seed)
    const declarations = []
    state.case(11).traverse({
      VariableDeclarator(path) {
        declarations.push(path.node)
      },
    })
    const destination = first(
        state.case(11),
        'AssignmentExpression',
        (node) => node.left.type === 'Identifier',
      ).node.left.name,
      left = declarations[0].id.name
    state.case(11).traverse({
      Identifier(path) {
        if (path.node.name === left) path.node.name = destination
      },
    })
    rejects(
      state,
      'minified-class-handler',
      'ADD: complete handler body or connection changed',
    )
  })
  test(`${seed}: catch release and later completion close the entry envelope`, () => {
    let state = setup(seed)
    first(
      first(state.owned('run'), 'CatchClause'),
      'NumericLiteral',
      (node) => node.value === 5,
    ).node.value = 6
    rejects(
      state,
      'minified-class-entry',
      'Complete entry/dispatch/exception/completion effects changed',
    )
    state = setup(seed)
    const run = state.owned('run'),
      returns = []
    run.traverse({
      ReturnStatement(path) {
        if (path.getFunctionParent() === run) returns.push(path)
      },
    })
    const completion = returns.find(
      (path) =>
        path.node.argument?.type === 'MemberExpression' &&
        path.node.argument.property.value === 0,
    )
    expect(completion).toBeDefined()
    completion.node.argument.property.value = 1
    rejects(
      state,
      'minified-class-entry',
      'Complete entry/dispatch/exception/completion effects changed',
    )
  })
}
test('PATCH, DEBUGGER, closure shell and finally record have complete discriminating bodies', () => {
  for (const [opcode, mutate] of [
    [
      56,
      (path) => {
        first(
          path,
          'NumericLiteral',
          (node) => node.value === 2654435769,
        ).node.value += 1
      },
    ],
    [
      57,
      (path) => {
        path.node.consequent = path.node.consequent.filter(
          (node) => node.type !== 'DebuggerStatement',
        )
      },
    ],
    [
      47,
      (path) => {
        first(path, 'ThisExpression').replaceWith({ type: 'NullLiteral' })
      },
    ],
    [
      59,
      (path) => {
        first(path, 'ObjectProperty').node.key.name = 'changedRecordField'
      },
    ],
  ]) {
    const state = setup(),
      name = state.positive.handlers.find((item) => item.opcode === opcode).name
    mutate(state.case(opcode))
    if (opcode === 59)
      rejects(
        state,
        'minified-class-entry',
        'Complete entry/dispatch/exception/completion effects changed',
      )
    else
      rejects(
        state,
        'minified-class-handler',
        `${name}: complete handler body or connection changed`,
      )
  }
})
test('global, dummy and stable closure-map effects decline at separate owned checks', () => {
  let state = setup()
  state.ast.program.body.push(opaque())
  rejects(
    state,
    'minified-class-ownership',
    'Global setup or top-level effects changed',
  )
  state = setup()
  const dummy = state.positive.effects.dummyWrites.find(
    (item) => item.role === 'closeFrame',
  )
  first(
    state.owned('closeFrame'),
    'AssignmentExpression',
    (node) => node.left.property?.name === dummy.field,
  ).node.right = parse('opaqueEffect()').program.body[0].expression
  rejects(
    state,
    'minified-class-functions',
    'closeFrame: complete owned body is missing or changed',
  )
  state = setup()
  const map = state.ast.program.body
    .filter((node) => node.type === 'VariableDeclaration')
    .flatMap((node) => node.declarations)
    .find(
      (node) =>
        node.init?.type === 'NewExpression' &&
        node.init.callee.name === 'WeakMap',
    )
  map.init = { type: 'NumericLiteral', value: 1 }
  rejects(
    state,
    'minified-class-ownership',
    'Closure map is not stable owned WeakMap',
  )
})
test('owned prototype methods cannot overwrite each other', () => {
  const state = setup(),
    read = state.owned('readUpvalue').parentPath.node,
    write = state.owned('writeUpvalue').parentPath.node
  write.left.property.name = read.left.property.name
  state.case(7).traverse({
    MemberExpression(path) {
      if (
        path.node.property.name ===
        state.positive.functions.find((item) => item.role === 'writeUpvalue')
          .name
      )
        path.node.property.name = read.left.property.name
    },
  })
  rejects(
    state,
    'minified-class-ownership',
    'Owned method is overwritten or overlaps state',
  )
})

for (const seed of seeds)
  test(`${seed}: sequence/declaration normalization passes after a reaching positive`, () => {
    const state = setup(seed),
      selected = state.case(11)
    const declaration = selected.node.consequent.find(
      (node) => node.type === 'VariableDeclaration',
    )
    const index = selected.node.consequent.indexOf(declaration)
    const assignments = declaration.declarations.map((node) => ({
      type: 'AssignmentExpression',
      operator: '=',
      left: structuredClone(node.id),
      right: node.init,
    }))
    for (const node of declaration.declarations) node.init = null
    selected.node.consequent.splice(
      index + 1,
      0,
      ...assignments.map((expression) => ({
        type: 'ExpressionStatement',
        expression,
      })),
    )
    expect(observe(generate(state.ast).code).ok).toBe(true)
  })
test('directives and unknown syntax do not disappear during complete-body normalization', () => {
  let state = setup()
  state.ast.program.directives = parse('"use strict";').program.directives
  rejects(
    state,
    'minified-class-ownership',
    'Runtime directives are outside the closed source form',
  )
  state = setup()
  state
    .case(11)
    .node.consequent.push(parse('with (unknownReceiver) {}').program.body[0])
  rejects(
    state,
    'minified-class-handler',
    'ADD: complete handler body or connection changed',
  )
})
for (const seed of [170, 171])
  test(`${seed}: helper-route constructor/frame effects reach the complete function gate`, () => {
    for (const role of ['VM', 'pushFrame']) {
      const state = setup(seed)
      state.owned(role).node.body.body.push(opaque())
      rejects(
        state,
        'minified-class-functions',
        `${role}: complete owned body is missing or changed`,
      )
    }
  })

test('branch, call/new, return and enumeration mutations alter source-defined operations', () => {
  for (const [opcode, type, predicate, mutate] of [
    [
      40,
      'LogicalExpression',
      (node) => node.operator === '||',
      (node) => {
        node.operator = '&&'
      },
    ],
    [
      41,
      'LogicalExpression',
      (node) => node.operator === '&&',
      (node) => {
        node.operator = '||'
      },
    ],
    [
      42,
      'NumericLiteral',
      (node) => node.value === 65535,
      (node) => {
        node.value = 65534
      },
    ],
    [
      44,
      'MemberExpression',
      (node) => node.property.name === 'construct',
      (node) => {
        node.property.name = 'apply'
      },
    ],
    [
      45,
      'BinaryExpression',
      (node) => node.operator === '&' && node.right.value === 1,
      (node) => {
        node.right.value = 2
      },
    ],
    [
      52,
      'MemberExpression',
      (node) => node.property.name === 'getPrototypeOf',
      (node) => {
        node.property.name = 'getOwnPropertyNames'
      },
    ],
  ]) {
    const state = setup(),
      name = state.positive.handlers.find((item) => item.opcode === opcode).name
    mutate(first(state.case(opcode), type, predicate).node)
    rejects(
      state,
      'minified-class-handler',
      `${name}: complete handler body or connection changed`,
    )
  }
})
test('capture and upvalue operations and dummy receiver ownership are connected', () => {
  let state = setup()
  first(
    state.owned('capture'),
    'BinaryExpression',
    (node) => node.operator === '+',
  ).node.operator = '-'
  rejects(
    state,
    'minified-class-functions',
    'capture: complete owned body is missing or changed',
  )
  state = setup()
  first(state.owned('writeUpvalue'), 'AssignmentExpression').node.operator =
    '+='
  rejects(
    state,
    'minified-class-functions',
    'writeUpvalue: complete owned body is missing or changed',
  )
  state = setup()
  const dummy = state.positive.effects.dummyWrites.find(
    (item) => item.role === 'closeFrame',
  )
  first(
    state.owned('closeFrame'),
    'AssignmentExpression',
    (node) => node.left.property?.name === dummy.field,
  ).node.left.object = { type: 'Identifier', name: 'globalThis' }
  rejects(
    state,
    'minified-class-ownership',
    'Dummy write has an unknown receiver',
  )
})

test('reader helper dummy writes preserve receiver state across later parameter reuse', () => {
  let state = setup(170)
  const reader = state.owned('constant')
  const receiver = reader.node.params[0].name
  const dummy = state.positive.effects.dummyWrites.find(
    (item) => item.role === 'constant',
  )
  expect(dummy).toBeDefined()
  const dummyWrite = first(
    reader,
    'AssignmentExpression',
    (node) => node.left.property?.name === dummy.field,
  )
  const receiverReuse = first(
    reader,
    'AssignmentExpression',
    (node) => node.left.name === receiver,
  )
  const dummyStatement = dummyWrite.getStatementParent()
  const reuseStatement = receiverReuse.getStatementParent()
  const moved = structuredClone(dummyStatement.node)
  dummyStatement.remove()
  reuseStatement.insertAfter(moved)
  rejects(
    state,
    'incomplete-role',
    'LOAD_CONST constant reader has unsupported VM field effects',
  )
  state = setup(170)
  const unchangedReceiver = first(
    state.owned('constant'),
    'AssignmentExpression',
    (node) => node.left.property?.name === dummy.field,
  )
  unchangedReceiver.node.left.property.name = 'unusedReaderField'
  expect(observe(generate(state.ast).code).ok).toBe(true)
})

test('reader dummy effects cannot overlap later capture state', () => {
  const state = setup(170)
  const dummy = state.positive.effects.dummyWrites.find(
    (item) => item.role === 'constant',
  )
  const write = first(
    state.owned('constant'),
    'AssignmentExpression',
    (node) => node.left.property?.name === dummy.field,
  )
  write.node.left.property.name = state.positive.fields.openField
  expect(diagnoseMinifiedClassBoot(generate(state.ast).code).ok).toBe(true)
  rejects(
    state,
    'minified-class-ownership',
    'Reader dummy writes have unproved field interactions',
  )
})
test('later method constant calls cannot supply active optional decoder parameters', () => {
  let state = setup(169)
  const constant = state.positive.functions.find(
    (item) => item.role === 'constant',
  )
  const call = first(
    state.case(2),
    'CallExpression',
    (node) => node.callee.property?.name === constant.name,
  )
  call.node.arguments = [
    parse('void 0').program.body[0].expression,
    { type: 'NumericLiteral', value: 1 },
  ]
  expect(diagnoseMinifiedClassBoot(generate(state.ast).code).ok).toBe(true)
  rejects(
    state,
    'minified-class-handler',
    'LOAD_GLOBAL: complete handler body or connection changed',
  )
  state = setup(169)
  const unchanged = first(
    state.case(2),
    'CallExpression',
    (node) => node.callee.property?.name === constant.name,
  )
  unchanged.node.arguments = [
    parse('void 0').program.body[0].expression,
    parse('void 0').program.body[0].expression,
  ]
  expect(observe(generate(state.ast).code).ok).toBe(true)
})

for (const seed of seeds) {
  for (const [opcode, member] of [
    [9, 'set'],
    [60, 'pow'],
    [43, 'apply'],
    [44, 'construct'],
  ])
    test(`${seed}: value-context comma in ${member} preserves argument arity and declines`, () => {
      const state = setup(seed)
      const call = first(
        state.case(opcode),
        'CallExpression',
        (node) => node.callee.property?.name === member,
      )
      const arguments_ = call.node.arguments
      call.node.arguments = [
        { type: 'SequenceExpression', expressions: arguments_.slice(0, 2) },
        ...arguments_.slice(2),
      ]
      expect(diagnoseMinifiedClassBoot(generate(state.ast).code).ok).toBe(true)
      const name = state.positive.handlers.find(
        (item) => item.opcode === opcode,
      ).name
      rejects(
        state,
        'minified-class-handler',
        `${name}: complete handler body or connection changed`,
      )
    })
  test(`${seed}: byte-helper argument boundary reaches both named component and earlier reader checks`, () => {
    const state = setup(seed)
    function component(ast) {
      try {
        const record = ownedFunctions(
          makeContext(ast),
          state.positive.boot,
        ).identify('bytes', OWNED_CLAUSES.bytes, new Map(), ['value'])
        return {
          ok: true,
          name: record.entry.binding.identifier.name,
          diagnostic: null,
        }
      } catch (error) {
        if (!(error instanceof ContainerDecline)) throw error
        return {
          ok: false,
          result: null,
          diagnostic: { code: error.code, message: error.message },
        }
      }
    }
    expect(component(state.ast)).toEqual({
      ok: true,
      name: state.positive.functions.find((item) => item.role === 'bytes').name,
      diagnostic: null,
    })
    const call = first(
      state.owned('bytes'),
      'CallExpression',
      (node) =>
        node.callee.object?.name === 'Buffer' &&
        node.callee.property.name === 'from',
    )
    call.node.arguments = [
      { type: 'SequenceExpression', expressions: call.node.arguments },
    ]
    const changed = parse(generate(state.ast).code, { sourceType: 'script' })
    expect(component(changed)).toEqual({
      ok: false,
      result: null,
      diagnostic: {
        code: 'minified-class-functions',
        message: 'bytes: complete owned body is missing or changed',
      },
    })
    rejects(
      state,
      'incomplete-role',
      'LOAD_CONST byte reader does not implement base64 byte conversion',
    )
  })
  for (const role of ['descriptorField', 'upvaluesField'])
    test(`${seed}: ${role} cannot overlap Closure's fixed prototype, legal alpha passes`, () => {
      function rename(state, replacement) {
        let count = 0
        const old = state.positive.fields[role]
        traverse(state.ast, {
          MemberExpression(path) {
            if (!path.node.computed && path.node.property.name === old) {
              path.node.property.name = replacement
              count++
            }
          },
          ObjectProperty(path) {
            if (!path.node.computed && path.node.key.name === old) {
              path.node.key.name = replacement
              count++
            }
          },
        })
        expect(count).toBeGreaterThan(0)
      }
      let state = setup(seed)
      rename(state, `legal_${role}`)
      expect(observe(generate(state.ast).code).ok).toBe(true)
      state = setup(seed)
      rename(state, 'prototype')
      expect(diagnoseMinifiedClassBoot(generate(state.ast).code).ok).toBe(true)
      rejects(
        state,
        'minified-class-ownership',
        'Renamed field overlaps fixed semantic member',
      )
    })
}
test('normalization preserves every value/list slot and member assignment reference order', () => {
  const shaped = (source) => semanticShape(parse(source).program.body)
  for (const source of ['f((a,b));', 'new F((a,b));']) {
    const call = shaped(source)[0]
    expect(call.arguments).toHaveLength(1)
    expect(call.arguments[0].type).toBe('SequenceExpression')
    expect(call.arguments[0].expressions).toHaveLength(2)
  }
  const array = shaped('[(a,b)];')[0]
  expect(array.elements).toHaveLength(1)
  expect(array.elements[0].type).toBe('SequenceExpression')
  const template = shaped('`${(a,b)}`;')[0]
  expect(template.expressions).toHaveLength(1)
  expect(template.expressions[0].type).toBe('SequenceExpression')
  const returned = semanticShape(
    parse('function f(a,b){return(a,b)}').program.body[0].body,
  )[0]
  expect(returned.argument.type).toBe('SequenceExpression')
  const assignment = shaped('out=(a,b);')[0]
  expect(assignment.right.type).toBe('SequenceExpression')
  const lexical = shaped('a=b=read();')
  expect(lexical).toHaveLength(2)
  const fixedThis = shaped('this.field=b=read();')
  expect(fixedThis).toHaveLength(2)
  for (const source of [
    'registers[destination]=destination=read();',
    'object.field=object=read();',
  ]) {
    const member = shaped(source)
    expect(member).toHaveLength(1)
    expect(member[0].left.type).toBe('MemberExpression')
    expect(member[0].right.type).toBe('AssignmentExpression')
  }
  expect(shaped('a=read(),b=read();')).toHaveLength(2)
})
