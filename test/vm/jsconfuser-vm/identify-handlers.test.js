import fs from 'node:fs'
import { parse } from '@babel/parser'
import { expect, test } from 'vitest'
import { PARSER_OPTIONS } from '../../../src/vm/jsconfuser-vm/container-role-helpers.js'
import {
  locateHandlers,
  normalizeStatements,
} from '../../../src/vm/jsconfuser-vm/locate-handlers.js'
import PluginJsconfuser from '../../../src/plugin/jsconfuser.js'
import normalizeVmInput from '../../../src/visitor/jsconfuser-vm/normalize-source.js'
import {
  behaviourTable,
  requireIdentifiedHandlers,
} from '../../../src/vm/jsconfuser-vm/identify-handlers.js'
import {
  handlerEffects,
  templateEffects,
  unifyEffects,
} from '../../../src/vm/jsconfuser-vm/handler-effects.js'

// The runtime-layers minify-table fixtures: Closure ADVANCED minify over a handler table, with one
// added-opcode option each (generation.json). Expected values are the encoder's own: re-encoding the
// same source, options and seed without minify names every added handler in a comment.
const fixture = (name) =>
  parse(
    fs.readFileSync(
      new URL(
        `fixtures/runtime-layers/minify-table-${name}.encoded.js`,
        import.meta.url,
      ),
      'utf8',
    ),
    PARSER_OPTIONS,
  )
const identified = (name) => requireIdentifiedHandlers(fixture(name), 'test')

// The outer-layers fixtures: one randomized VM layer under one outer js-confuser option each
// (generation.json). Every outer option keeps behaviour and re-spells handlers; the expected values
// are the VM layer's own OP and SENTINELS objects.
const outerFixture = (name) =>
  fs.readFileSync(
    new URL(`fixtures/outer-layers/${name}.encoded.js`, import.meta.url),
    'utf8',
  )
const encoderObject = (source, name) => {
  const declarator = parse(source, PARSER_OPTIONS)
    .program.body.flatMap((statement) =>
      statement.type === 'VariableDeclaration' ? statement.declarations : [],
    )
    .find((item) => item.id.name === name)
  return Object.fromEntries(
    declarator.init.properties.map((item) => [item.key.name, item.value.value]),
  )
}
const outerPrepared = (name) =>
  parse(normalizeVmInput(PluginJsconfuser(outerFixture(name))), PARSER_OPTIONS)

test.each([
  [
    'beside their specialized copies',
    () => fixture('specialized'),
    { LOAD_THIS: 4, ADD: 11 },
    undefined,
  ],
  ...[
    'compact',
    'object-extraction',
    'moved-declarations',
    'minify',
    'variable-masking',
  ].map((name) => [
    `under the outer ${name} layer`,
    () => outerPrepared(name),
    encoderObject(outerFixture('vm'), 'OP'),
    encoderObject(outerFixture('vm'), 'SENTINELS').CALL_SPREAD,
  ]),
])(
  'names all 61 canonical handlers by behaviour %s',
  (_, program, expected, sentinel) => {
    const view = locateHandlers(program())
    const { opcodes, named, sentinel: found } = behaviourTable(view)
    expect(
      Object.values(opcodes).filter((value) => value !== null),
    ).toHaveLength(61)
    expect(named.size).toBe(61)
    expect(opcodes).toMatchObject(expected)
    if (sentinel !== undefined) expect(found).toBe(sentinel)
  },
)

test('a specialized handler is one canonical handler with its operands baked in', () => {
  const { added } = identified('specialized')
  expect(added.get(75)).toEqual({
    kind: 'specialized',
    name: 'ADD',
    opcode: 11,
    operands: [5, 3, 4],
  })
  expect(added.get(63)).toMatchObject({
    name: 'LOAD_GLOBAL',
    operands: [3, 0, 0],
  })
  expect(added.get(74)).toMatchObject({
    name: 'JUMP_IF_FALSE',
    operands: [5, 44],
  })
  expect(
    [...added.values()].every((item) => item?.kind === 'specialized'),
  ).toBe(true)
})

test('an alias is one canonical handler reading its operands in another order', () => {
  const { added } = identified('aliased')
  expect(added.get(61)).toMatchObject({
    kind: 'alias',
    name: 'LOAD_CONST',
    canonicalToStored: [2, 1, 0],
  })
  // An identity-order alias does what its canonical handler does; it is still the alias.
  expect(added.get(64)).toMatchObject({
    kind: 'alias',
    name: 'LOAD_THIS',
    canonicalToStored: [0],
  })
  expect(added.size).toBe(10)
})

test('a macro is canonical handlers in sequence, operands read in order', () => {
  const { added } = identified('macro')
  const steps = (label) => added.get(label).steps.map((step) => step.name)
  expect(steps(61)).toEqual(['LOAD_CONST', 'RETURN'])
  expect(steps(63)).toEqual(['MOVE', 'LOAD_CONST'])
  expect(added.get(64)).toMatchObject({
    kind: 'macro',
    steps: [
      { name: 'ADD', reads: [0, 1, 2] },
      { name: 'MOVE', reads: [3, 4] },
    ],
  })
})

test('a synthetic anti case reads every operand up front, in its stored permutation', () => {
  const found = identified('anti').added.get(61)
  expect(found.kind).toBe('anti')
  expect(found.steps.map((step) => step.name)).toEqual([
    'JUMP_IF_FALSE',
    'EXP',
    'MOVE',
    'BUILD_OBJECT',
    'BUILD_ARRAY',
  ])
  // The encoder's prelude: `_operands = [_unsorted[9], _unsorted[4], _unsorted[8], ...]`.
  expect(found.steps.flatMap((step) => step.reads)).toEqual([
    9, 4, 8, 3, 13, 6, 5, 12, 11, 10, 0, 1, 2, 7,
  ])
})

test('effects compare across minify spellings: a folded literal fills an operand slot', () => {
  const view = locateHandlers(fixture('specialized'))
  const handler = (label) => view.handlers.find((item) => item.label === label)
  const identities = new Map()
  const add = handlerEffects(view, handler(11), identities)
  const baked = handlerEffects(view, handler(75), identities)
  // Minify kept ADD's operand locals and folded ADD_5_3_4's literals into one statement.
  expect(add.operands).toBe(3)
  expect(baked.operands).toBe(0)
  const slots = new Map()
  expect(unifyEffects(add.effects, baked.effects, slots)).toBe(true)
  expect([...slots]).toEqual([
    [0, { literal: 5 }],
    [1, { literal: 3 }],
    [2, { literal: 4 }],
  ])
  // A different canonical handler does not fit.
  expect(
    unifyEffects(
      handlerEffects(view, handler(12), identities).effects,
      baked.effects,
    ),
  ).toBe(false) // Closure writes a specialized BAND whose destination is its left operand as `a[b+85] &= a[b+84]`
  // (corpus VM-GLM-1): a compound bitwise write and the written-out chain are one term.
  const effects = (source) =>
    templateEffects(
      normalizeStatements(parse(source, PARSER_OPTIONS).program.body),
    ).effects
  expect(effects('$regs[$base + 85] &= $regs[$base + 84];')).toEqual(
    effects('$regs[$base + 85] = $regs[$base + 85] & $regs[$base + 84];'),
  )
  expect(effects('$x = $a ^ ($b ^ $c);')).toEqual(effects('$x = $a ^ $b ^ $c;'))
})
