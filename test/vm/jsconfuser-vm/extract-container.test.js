import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import { expectConsistentState } from '../../helper.js'
import decodeVm from '../../../src/plugin/jsconfuser-vm.js'
import {
  diagnoseContainer,
  extractContainer,
  extractContainerFromSource,
} from '../../../src/vm/jsconfuser-vm/extract-container.js'
const repositoryRoot = new URL('../../../', import.meta.url)
const referencePath = new URL(
  'test/vm/jsconfuser-vm/fixtures/reference/encoded.js',
  repositoryRoot,
)
const debugReferencePath = new URL(
  'test/vm/jsconfuser-vm/fixtures/reference/encoded.debug.js',
  repositoryRoot,
)
const reference = fs.readFileSync(referencePath, 'utf8')
const debugReference = fs.readFileSync(debugReferencePath, 'utf8')

function deepFrozen(value) {
  if (!value || typeof value !== 'object') return true
  return (
    Object.isFrozen(value) &&
    Object.values(value).every((child) => deepFrozen(child))
  )
}

function renameBindings(source) {
  const bindingAliases = new Map([
    ['CONSTANTS', 'poolBindingAlias'],
    ['BYTECODE', 'wordcodeBindingAlias'],
    ['MAIN_START_PC', 'startPcBindingAlias'],
    ['MAIN_REG_COUNT', 'regCountBindingAlias'],
    ['ENCODE_BYTECODE', 'encodedFlagAlias'],
    ['TIMING_CHECKS', 'timingFlagAlias'],
    ['HEADER_SIZE', 'headerSizeAlias'],
    ['FRAME_START', 'frameStartAlias'],
    ['OP', 'opcodeMapAlias'],
    ['SENTINELS', 'sentinelMapAlias'],
    ['SLOTS', 'slotMapAlias'],
    ['Upvalue', 'upvalueConstructorAlias'],
    ['Closure', 'closureConstructorAlias'],
    ['VM', 'vmConstructorAlias'],
    ['decodeBytecode', 'decoderFunctionAlias'],
    ['globals', 'globalObjectAlias'],
    ['vm', 'vmInstanceAlias'],
  ])
  const methodAliases = new Map([
    ['_read', 'readMethodAlias'],
    ['_write', 'writeMethodAlias'],
    ['_close', 'closeMethodAlias'],
    ['_operand', 'operandMethodAlias'],
    ['_pushFrame', 'pushFrameMethodAlias'],
    ['captureUpvalue', 'captureMethodAlias'],
    ['_constant', 'constantMethodAlias'],
    ['_closeUpvaluesFor', 'closeUpvaluesMethodAlias'],
    ['run', 'runMethodAlias'],
  ])
  const ast = parse(source, {
    allowReturnOutsideFunction: true,
    sourceType: 'script',
  })
  traverse(ast, {
    Program(path) {
      for (const [from, to] of bindingAliases) {
        if (path.scope.getBinding(from)) path.scope.rename(from, to)
      }
    },
    MemberExpression(path) {
      if (path.node.computed || path.node.property.type !== 'Identifier') {
        return
      }
      const alias = methodAliases.get(path.node.property.name)
      if (alias) path.node.property.name = alias
    },
  })
  return generate(ast, { comments: true }).code
}

function topLevelDeclaration(source, name) {
  const ast = parse(source, {
    allowReturnOutsideFunction: true,
    sourceType: 'script',
  })
  return ast.program.body.find(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.declarations.some(
        (declaration) => declaration.id.name === name,
      ),
  )
}

function withoutTopLevelDeclaration(source, name) {
  const ast = parse(source, {
    allowReturnOutsideFunction: true,
    sourceType: 'script',
  })
  ast.program.body = ast.program.body.filter(
    (statement) =>
      !(
        statement.type === 'VariableDeclaration' &&
        statement.declarations.some(
          (declaration) => declaration.id.name === name,
        )
      ),
  )
  return generate(ast, { comments: true }).code
}

function replaceOnce(source, from, to) {
  const index = source.indexOf(from)
  expect(index, `fixture text not found: ${from}`).toBeGreaterThanOrEqual(0)
  return `${source.slice(0, index)}${to}${source.slice(index + from.length)}`
}

// Constant simplification can leave `argc === 65535` where the runtime reads the sentinel map; a
// stable value reads the same whichever way it is spelled.
function literalSentinels() {
  const source = reference.replace(
    /argc === SENTINELS\.CALL_SPREAD/g,
    'argc === 65535',
  )
  expect(source.match(/argc === 65535/g)).toHaveLength(3)
  return source
}

test('map reads and literal sentinels yield the same recovered program', () => {
  const source = literalSentinels()
  const ast = parse(source)
  traverse(ast, {})
  const before = JSON.stringify(ast)
  const diagnosis = diagnoseContainer(ast)
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  expect(diagnosis.result).toEqual(extractContainer(reference))
  expect(JSON.stringify(ast)).toBe(before)
  expectConsistentState(ast, source, { sourceType: 'script' })
  const recovered = decodeVm(source)
  expect(recovered.ok, JSON.stringify(recovered.diagnostic)).toBe(true)
  expect(recovered.output).not.toBe(source)
  expect(recovered.output).toBe(decodeVm(reference).output)
})

test('extracts the pinned reference payload and the known scalar values', () => {
  const result = extractContainerFromSource(reference)

  expect(result).not.toBeNull()
  expect(result.schemaVersion).toBe('jsconfuser-vm-container.v1')
  expect(result.encoding).toBe('numeric-u32')
  expect(result.roles.words.values).toHaveLength(32)
  expect(result.roles.op.values).toEqual({
    LOAD_CONST: 0,
    LOAD_INT: 1,
    LOAD_GLOBAL: 2,
    LOAD_UPVALUE: 3,
    LOAD_THIS: 4,
    MOVE: 5,
    STORE_GLOBAL: 6,
    STORE_UPVALUE: 7,
    GET_PROP: 8,
    SET_PROP: 9,
    DELETE_PROP: 10,
    ADD: 11,
    SUB: 12,
    MUL: 13,
    DIV: 14,
    MOD: 15,
    EXP: 60,
    BAND: 16,
    BOR: 17,
    BXOR: 18,
    SHL: 19,
    SHR: 20,
    USHR: 21,
    LT: 22,
    GT: 23,
    LTE: 24,
    GTE: 25,
    EQ: 26,
    NEQ: 27,
    LOOSE_EQ: 28,
    LOOSE_NEQ: 29,
    IN: 30,
    INSTANCEOF: 31,
    UNARY_NEG: 32,
    UNARY_POS: 33,
    UNARY_NOT: 34,
    UNARY_BITNOT: 35,
    TYPEOF: 36,
    VOID: 37,
    TYPEOF_SAFE: 38,
    JUMP: 39,
    JUMP_IF_FALSE: 40,
    JUMP_IF_TRUE: 41,
    CALL: 42,
    CALL_METHOD: 43,
    NEW: 44,
    RETURN: 45,
    THROW: 46,
    MAKE_CLOSURE: 47,
    BUILD_ARRAY: 48,
    BUILD_OBJECT: 49,
    DEFINE_GETTER: 50,
    DEFINE_SETTER: 51,
    FOR_IN_SETUP: 52,
    FOR_IN_NEXT: 53,
    TRY_SETUP: 54,
    TRY_END: 55,
    PATCH: 56,
    DEBUGGER: 57,
    JUMP_REG: 58,
    FINALLY_SETUP: 59,
  })
  expect(result.roles.sentinels.values).toEqual({ CALL_SPREAD: 65535 })
  expect(result.roles.slots.values).toEqual({
    PC: 0,
    CALLER: 1,
    RET_DST: 2,
    THIS: 3,
    CLOSURE: 4,
    HANDLERS: 5,
    FRAME_SIZE: 6,
    REG_BASE: 7,
  })
  expect(
    Object.fromEntries(
      Object.entries(result.roles.scalars).map(([role, { value }]) => [
        role,
        value,
      ]),
    ),
  ).toEqual({
    MAIN_START_PC: 0,
    MAIN_REG_COUNT: 7,
    ENCODE_BYTECODE: false,
    TIMING_CHECKS: false,
    HEADER_SIZE: 8,
    FRAME_START: 1,
  })
})

test('renamed bindings and prototype methods leave the located payload unchanged', () => {
  expect(extractContainer(renameBindings(reference))).toEqual(
    extractContainer(reference),
  )
})

test('is independent of debug and disassembly comments', () => {
  const result = extractContainerFromSource(debugReference)
  expect(result).not.toBeNull()
  expect(result.roles.scalars.MAIN_REG_COUNT.value).toBe(7)
})

test('accepts an AST without mutating it and returns deeply frozen data', () => {
  const ast = parse(reference, {
    allowReturnOutsideFunction: true,
    sourceType: 'script',
  })
  const before = JSON.stringify(ast)
  const result = extractContainer(ast)

  expect(JSON.stringify(ast)).toBe(before)
  expect(deepFrozen(result)).toBe(true)
  expect(() => result.roles.words.values.push(99)).toThrow()
  expect(() => {
    result.roles.scalars.MAIN_START_PC.value = 1
  }).toThrow()
})

test('also accepts a generated baseline with a program-specific register count', () => {
  const source = fs.readFileSync(
    new URL(
      'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-literals-order/encoded.js',
      repositoryRoot,
    ),
    'utf8',
  )
  const result = extractContainerFromSource(source)

  expect(result).not.toBeNull()
  expect(result.roles.scalars.MAIN_REG_COUNT.value).toBe(24)
})

const negatives = [
  ['ordinary JavaScript near-miss', 'var answer = 42;', 'missing-role'],
  [
    'missing mandatory root scalar',
    withoutTopLevelDeclaration(reference, 'MAIN_REG_COUNT'),
    'missing-role',
  ],
  [
    'malformed word array',
    replaceOnce(reference, 'var BYTECODE = [4,', 'var BYTECODE = [4294967296,'),
    'missing-role',
  ],
]

test.each(negatives)(
  'declines %s before producing a result',
  (_label, source, code) => {
    const report = diagnoseContainer(source)

    expect(report.ok).toBe(false)
    expect(report.result).toBeNull()
    expect(report.diagnostic.code).toBe(code)
    expect(extractContainer(source)).toBeNull()
  },
)

test('returns a stable diagnostic rather than throwing for malformed input', () => {
  const report = diagnoseContainer('var =')

  expect(report).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'extractor-error' },
  })
  expect(report.diagnostic.message).toContain('Unexpected token')
})

// Each entry succeeds on a parsed File and reports a frozen decline on the same parse's bare
// Program.
test.each([['reference/encoded.js', diagnoseContainer, 'extractor-error']])(
  '%s accepts File and refuses a raw Program',
  (name, entry, code) => {
    const source = fs.readFileSync(
      new URL(`test/vm/jsconfuser-vm/fixtures/${name}`, repositoryRoot),
      'utf8',
    )
    const fresh = () =>
      parse(source, { sourceType: 'script', allowReturnOutsideFunction: true })
    const file = fresh()
    const fileBefore = JSON.stringify(file)
    const accepted = entry(file)
    if (accepted && 'ok' in accepted) expect(accepted.ok).toBe(true)
    else expect(accepted?.type).toBe('File')
    expect(JSON.stringify(file)).toBe(fileBefore)

    const program = fresh().program
    const programBefore = JSON.stringify(program)
    if (code) {
      const refused = entry(program)
      expect(refused).toMatchObject({
        ok: false,
        result: null,
        diagnostic: { code },
      })
      expect(deepFrozen(refused)).toBe(true)
    } else {
      expect(() => entry(program)).toThrow(
        new TypeError(
          "Cannot read properties of undefined (reading 'getBlockParent')",
        ),
      )
    }
    expect(JSON.stringify(program)).toBe(programBefore)
  },
)

// Moved-declaration spelling: every top-level declaration becomes a bare name
// in one leading var plus a `name = value` statement where it stood, as an
// outer moved-declarations pass emits it.
function movedDeclarations(source) {
  const ast = parse(source)
  const names = []
  const body = []
  for (const statement of ast.program.body) {
    if (statement.type === 'VariableDeclaration' && statement.kind === 'var') {
      for (const declarator of statement.declarations) {
        names.push(declarator.id.name)
        if (declarator.init)
          body.push(
            `${declarator.id.name} = ${generate(declarator.init).code};`,
          )
      }
    } else if (statement.type === 'FunctionDeclaration') {
      names.push(statement.id.name)
      const fn = generate({ ...statement, type: 'FunctionExpression' }).code
      body.push(`${statement.id.name} = ${fn};`)
    } else body.push(generate(statement).code)
  }
  return `var ${names.join(', ')};\n${body.join('\n')}\n`
}

test('roles are read from the single defining write, not the declarator', () => {
  const moved = movedDeclarations(reference)
  expect(moved).not.toContain('var BYTECODE =')
  const ast = parse(moved)
  const before = JSON.stringify(ast)
  const diagnosis = diagnoseContainer(ast)
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  expect(diagnosis.result).toEqual(extractContainer(reference))
  expect(JSON.stringify(ast)).toBe(before)
  expect(decodeVm(moved).output).toBe(decodeVm(reference).output)
})

// Runtime-layer options re-spell the interpreter and leave the payload unchanged, so Packet A
// locates words, pool and root descriptor by the boot skeleton and the decode behaves as the
// source (fixture runtime-layers: classObfuscation and minify, with handlerTable and case shuffle,
// and with aliasedOpcodes or specializedOpcodes, whose decoy parameters minify reuses as locals;
// minify with aliasedOpcodes, whose readers find the handlers by behaviour, also with a handler
// table and with each other added-opcode option; minify with randomizeOpcodes, whose opcode values
// get their meaning from handler behaviour, with and without a handler table).
test.each([
  'class-minify',
  'class-minify-table-shuffle',
  'class-minify-aliased',
  'class-minify-specialized',
  'minify-aliased',
  'minify-randomized',
  'minify-table-randomized',
  'minify-table-aliased',
  'minify-table-macro',
  'minify-table-specialized',
  'minify-table-anti',
])('locates the payload of a %s runtime by its boot skeleton', (name) => {
  const directory = new URL(
    'test/vm/jsconfuser-vm/fixtures/runtime-layers/',
    repositoryRoot,
  )
  const encoded = fs.readFileSync(
    new URL(`${name}.encoded.js`, directory),
    'utf8',
  )
  const source = fs.readFileSync(new URL('source.js', directory), 'utf8')
  const run = (code) => {
    const window = {}
    vm.runInNewContext(code, { window, performance: { now: () => 0 } })
    return window.TEST_OUTPUT
  }
  const container = diagnoseContainer(encoded)
  expect(container.ok, JSON.stringify(container.diagnostic)).toBe(true)
  const decoded = decodeVm(encoded)
  expect(decoded.ok, JSON.stringify(decoded.diagnostic)).toBe(true)
  expect(run(decoded.output)).toEqual(run(source))
})
