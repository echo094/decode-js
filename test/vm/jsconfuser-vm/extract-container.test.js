import fs from 'node:fs'
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
import { diagnoseClassRuntime } from '../../../src/vm/jsconfuser-vm/analyze-class-runtime.js'
import {
  diagnoseMinifiedHandlerTable,
  diagnoseMinifiedRuntime,
} from '../../../src/vm/jsconfuser-vm/observe-minified-runtime.js'
import { diagnoseMinifiedClassBoot } from '../../../src/vm/jsconfuser-vm/observe-minified-class-boot.js'
import { materializeEncodedBytecode } from '../../../src/vm/jsconfuser-vm/materialize-encoded-bytecode.js'
import { materializeMinifiedEncodedBytecode } from '../../../src/vm/jsconfuser-vm/materialize-minified-encoded-bytecode.js'
import { materializeRandomizedRuntime } from '../../../src/vm/jsconfuser-vm/materialize-randomized-runtime.js'
import { materializeHandlerTable } from '../../../src/vm/jsconfuser-vm/materialize-handler-table.js'

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

function withoutPrototypeMethod(source, owner, method) {
  const ast = parse(source, {
    allowReturnOutsideFunction: true,
    sourceType: 'script',
  })
  ast.program.body = ast.program.body.filter((statement) => {
    const expression =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    const left =
      expression?.type === 'AssignmentExpression' ? expression.left : null
    return !(
      left?.type === 'MemberExpression' &&
      left.object?.type === 'MemberExpression' &&
      left.object.object?.type === 'Identifier' &&
      left.object.object.name === owner &&
      left.object.property?.name === 'prototype' &&
      left.property?.name === method
    )
  })
  return generate(ast, { comments: true }).code
}

function duplicateOpcodeMap(source) {
  const declaration = topLevelDeclaration(source, 'OP')
  const duplicate = generate(declaration, { comments: false }).code.replace(
    /\bOP\b/g,
    'OP_DUPLICATE',
  )
  return `${source}\n${duplicate}\n`
}

function replaceOnce(source, from, to) {
  const index = source.indexOf(from)
  expect(index, `fixture text not found: ${from}`).toBeGreaterThanOrEqual(0)
  return `${source.slice(0, index)}${to}${source.slice(index + from.length)}`
}

function simplifiedSentinels(mask) {
  let index = 0
  const source = reference.replace(
    /argc === SENTINELS\.CALL_SPREAD/g,
    (test) => (mask & (1 << index++) ? 'argc === 65535' : test),
  )
  expect(index).toBe(3)
  return source
}

test.each([0, 1, 2, 3, 4, 5, 6, 7])(
  'sentinel mask %s: map reads and literals yield the same recovered program',
  (mask) => {
    const source = simplifiedSentinels(mask)
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
  },
)

test('literal sentinel recognition survives binding and method renaming', () => {
  const source = renameBindings(simplifiedSentinels(7))
  expect(diagnoseContainer(source).ok).toBe(true)
  expect(decodeVm(source).ok).toBe(true)
})

test.each([
  ['wrong literal value', 'argc === 65535', 'argc === 65534'],
  ['wrong captured map', 'argc === 65535', 'argc === SLOTS.PC'],
  ['wrong comparison operator', 'argc === 65535', 'argc !== 65535'],
])(
  '%s: simplified sentinels retain named refusal and exact rollback',
  (_label, from, to) => {
    const source = replaceOnce(simplifiedSentinels(7), from, to)
    expect(diagnoseContainer(source)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: {
        code: 'incomplete-role',
        message: 'CALL_SPREAD is not connected to all call paths',
      },
    })
    expect(decodeVm(source)).toMatchObject({
      ok: false,
      output: source,
      result: null,
    })
  },
)

test('extracts the complete pinned reference graph and preserves the known scalar values', () => {
  const result = extractContainerFromSource(reference)

  expect(result).not.toBeNull()
  expect(result.schemaVersion).toBe('jsconfuser-vm-container.v1')
  expect(result.encoding).toBe('numeric-u32')
  expect(result.roles.pool.name).toBe('CONSTANTS')
  expect(result.roles.words.name).toBe('BYTECODE')
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
  expect(result.roles.scalars).toMatchObject({
    MAIN_START_PC: { name: 'MAIN_START_PC', value: 0 },
    MAIN_REG_COUNT: { name: 'MAIN_REG_COUNT', value: 7 },
    ENCODE_BYTECODE: { name: 'ENCODE_BYTECODE', value: false },
    TIMING_CHECKS: { name: 'TIMING_CHECKS', value: false },
    HEADER_SIZE: { name: 'HEADER_SIZE', value: 8 },
    FRAME_START: { name: 'FRAME_START', value: 1 },
  })
  expect(result.roles.constructors).toEqual({
    Upvalue: { name: 'Upvalue' },
    Closure: { name: 'Closure' },
    VM: { name: 'VM' },
  })
  expect(result.roles.methods.vm).toEqual({
    operand: { name: '_operand' },
    pushFrame: { name: '_pushFrame' },
    captureUpvalue: { name: 'captureUpvalue' },
    constant: { name: '_constant' },
    closeUpvalues: { name: '_closeUpvaluesFor' },
    run: { name: 'run' },
  })
  expect(result.roles.roots).toEqual({
    globals: { name: 'globals' },
    vm: { name: 'vm' },
    decoder: { name: 'decodeBytecode' },
    bootMethod: { name: 'run' },
  })
})

test('accepts renamed bindings and renamed prototype methods by their relationships', () => {
  const renamed = renameBindings(reference)
  const result = extractContainer(renamed)

  expect(result).not.toBeNull()
  expect(result.roles.pool.name).toBe('poolBindingAlias')
  expect(result.roles.words.name).toBe('wordcodeBindingAlias')
  expect(result.roles.constructors).toEqual({
    Upvalue: { name: 'upvalueConstructorAlias' },
    Closure: { name: 'closureConstructorAlias' },
    VM: { name: 'vmConstructorAlias' },
  })
  expect(result.roles.methods.vm.run.name).toBe('runMethodAlias')
  expect(result.roles.methods.upvalue.read.name).toBe('readMethodAlias')
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
  ['duplicate opcode map', duplicateOpcodeMap(reference), 'ambiguous-role'],
  [
    'ambiguous constant pool',
    `${reference}\nvar OTHER_POOL = ["window"];\n`,
    'ambiguous-role',
  ],
  [
    'malformed word array',
    replaceOnce(reference, 'var BYTECODE = [4,', 'var BYTECODE = [4294967296,'),
    'missing-role',
  ],
  [
    'unknown opcode map entry',
    replaceOnce(reference, 'var OP = {', 'var OP = {\n  UNKNOWN_OPCODE: 61,'),
    'missing-role',
  ],
  [
    'altered opcode map value',
    replaceOnce(reference, 'LOAD_CONST: 0', 'LOAD_CONST: 999'),
    'missing-role',
  ],
  [
    'altered frame slot',
    replaceOnce(reference, 'PC: 0', 'PC: 99'),
    'missing-role',
  ],
  [
    'altered root boot method',
    replaceOnce(reference, 'vm.run(new Closure(', 'vm._operand(new Closure('),
    'altered-boot',
  ],
  [
    'incomplete Upvalue method graph',
    withoutPrototypeMethod(reference, 'Upvalue', '_close'),
    'incomplete-role',
  ],
  [
    'unsupported encoded bytecode mode',
    replaceOnce(
      reference,
      'var ENCODE_BYTECODE = false;',
      'var ENCODE_BYTECODE = true;',
    ),
    'unsupported-encoded-bytecode',
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

test('an inserted statement in decodeBytecode disconnects scalar roles', () => {
  const opening = 'function decodeBytecode(s) {'
  expect(reference.split(opening)).toHaveLength(2)
  expect(diagnoseContainer(reference).ok).toBe(true)
  expect(
    diagnoseContainer(reference.replace(opening, `${opening}if (false) {}`)),
  ).toEqual({
    ok: false,
    result: null,
    diagnostic: {
      code: 'incomplete-role',
      message: 'Scalar roles are not connected to runtime metadata',
    },
  })
})

// Each entry succeeds on a parsed File and fails on the same parse's bare
// Program: the observers report a frozen decline or let traversal throw.
test.each([
  ['reference/encoded.js', diagnoseContainer, 'extractor-error'],
  [
    'class-runtime-boot/encoded.js',
    diagnoseClassRuntime,
    'class-runtime-error',
  ],
  ['minified-runtime-boot/encoded.js', diagnoseMinifiedRuntime, null],
  [
    'minified-handler-table-exceptions/encoded.js',
    diagnoseMinifiedHandlerTable,
    null,
  ],
  ['minified-class-boot/encoded-169.js', diagnoseMinifiedClassBoot, null],
  ['encoded-bytecode-arithmetic/encoded.js', materializeEncodedBytecode, null],
  [
    'minified-encoded-bytecode-exceptions/encoded.js',
    materializeMinifiedEncodedBytecode,
    null,
  ],
  [
    'randomized-runtime-exceptions/encoded.js',
    materializeRandomizedRuntime,
    null,
  ],
  ['handler-table-boot/encoded.js', materializeHandlerTable, null],
])('%s accepts File and refuses a raw Program', (name, entry, code) => {
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
})
