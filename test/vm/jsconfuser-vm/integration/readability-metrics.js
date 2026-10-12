import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import * as t from '@babel/types'
import { diagnoseStandalone } from '../../../../src/vm/jsconfuser-vm/decode-standalone.js'

const traverse = traverseModule.default || traverseModule
const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/readability',
)
const parserOptions = {
  allowReturnOutsideFunction: true,
  errorRecovery: false,
  sourceType: 'script',
}

const functionTypes = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
])

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parseSource(source) {
  return parse(source, parserOptions)
}

function walk(node, visit, seen = new Set()) {
  if (!node || typeof node.type !== 'string' || seen.has(node)) return
  seen.add(node)
  visit(node)
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, seen)
    } else {
      walk(value, visit, seen)
    }
  }
}

function generatedFamily(name) {
  if (!name.startsWith('__recovered_')) return null
  if (name.startsWith('__recovered_function_')) return 'function'
  if (name.startsWith('__recovered_r_')) return 'register'
  if (name.startsWith('__recovered_cells_')) return 'cell'
  if (
    name.startsWith('__recovered_captures') ||
    name.startsWith('__recovered_closure_captures_')
  )
    return 'capture'
  if (
    name.startsWith('__recovered_handler') ||
    name.startsWith('__recovered_error')
  )
    return 'handler'
  if (
    name.startsWith('__recovered_pc') ||
    name.startsWith('__recovered_dispatch') ||
    name.startsWith('__recovered_loop_')
  )
    return 'control'
  if (
    name.startsWith('__recovered_descriptor_') ||
    name.startsWith('__recovered_existing_')
  )
    return 'descriptor'
  if (
    name.startsWith('__recovered_args') ||
    name.startsWith('__recovered_this')
  )
    return 'call-wrapper'
  if (name === '__recovered_enumerable_keys') return 'helper'
  return 'other'
}

function identifierMetrics(ast) {
  const namesByFamily = new Map()
  let total = 0
  walk(ast, (node) => {
    if (node.type !== 'Identifier') return
    const family = generatedFamily(node.name)
    if (!family) return
    total += 1
    if (!namesByFamily.has(family)) namesByFamily.set(family, new Set())
    namesByFamily.get(family).add(node.name)
  })
  const families = {}
  for (const family of [...namesByFamily.keys()].sort()) {
    const names = namesByFamily.get(family)
    families[family] = { distinct: names.size, total: 0 }
  }
  walk(ast, (node) => {
    if (node.type !== 'Identifier') return
    const family = generatedFamily(node.name)
    if (family) families[family].total += 1
  })
  return {
    distinct: [...namesByFamily.values()].reduce((n, set) => n + set.size, 0),
    total,
    families,
  }
}

function hasGeneratedIdentifier(node) {
  let found = false
  walk(node, (child) => {
    if (child.type === 'Identifier' && generatedFamily(child.name)) found = true
  })
  return found
}

function isStatement(node) {
  return node.type.endsWith('Statement') || node.type.endsWith('Declaration')
}

function astMetrics(ast) {
  let statements = 0
  let generatedStatements = 0
  let functions = 0
  let declarations = 0
  let emptyCellDeclarations = 0
  walk(ast, (node) => {
    if (isStatement(node)) {
      statements += 1
      if (hasGeneratedIdentifier(node)) generatedStatements += 1
    }
    if (functionTypes.has(node.type)) functions += 1
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.id.name.startsWith('__recovered_cells_') &&
      node.init?.type === 'ArrayExpression' &&
      node.init.elements.length === 0
    )
      emptyCellDeclarations += 1
  })
  const bindings = new Set()
  const generatedBindings = []
  traverse(ast, {
    Scopable(scopePath) {
      for (const binding of Object.values(scopePath.scope.bindings)) {
        if (bindings.has(binding)) continue
        bindings.add(binding)
        declarations += 1
        if (generatedFamily(binding.identifier.name)) {
          generatedBindings.push({
            name: binding.identifier.name,
            references: binding.referencePaths.length,
          })
        }
      }
    },
  })
  const generatedDeclarationsByFamily = {}
  for (const binding of generatedBindings) {
    const family = generatedFamily(binding.name)
    if (!generatedDeclarationsByFamily[family])
      generatedDeclarationsByFamily[family] = { total: 0, zeroReferences: 0 }
    generatedDeclarationsByFamily[family].total += 1
    if (binding.references === 0)
      generatedDeclarationsByFamily[family].zeroReferences += 1
  }
  return {
    statements,
    generatedStatements,
    functions,
    declaredIdentifiers: declarations,
    generatedDeclarations: {
      total: generatedBindings.length,
      zeroReferences: generatedBindings.filter(
        ({ references }) => references === 0,
      ).length,
    },
    generatedDeclarationsByFamily,
    emptyCellDeclarations,
  }
}

function assignmentParts(statement) {
  const expression = statement?.expression
  if (
    statement?.type !== 'ExpressionStatement' ||
    expression?.type !== 'AssignmentExpression' ||
    expression.operator !== '=' ||
    expression.left?.type !== 'Identifier'
  )
    return null
  return {
    destination: expression.left.name,
    source:
      expression.right?.type === 'Identifier' ? expression.right.name : null,
  }
}

function adjacentIdentifierCopies(ast) {
  let copies = 0
  walk(ast, (node) => {
    if (!['Program', 'BlockStatement'].includes(node.type)) return
    for (let index = 0; index + 1 < node.body.length; index += 1) {
      const producer = assignmentParts(node.body[index])
      const move = assignmentParts(node.body[index + 1])
      if (producer?.destination && producer.destination === move?.source)
        copies += 1
    }
  })
  return copies
}

const destinationInstructions = new Set([
  'ADD',
  'BAND',
  'BOR',
  'BXOR',
  'BUILD_ARRAY',
  'BUILD_OBJECT',
  'CALL',
  'CALL_METHOD',
  'DELETE_PROP',
  'DIV',
  'EQ',
  'EXP',
  'FOR_IN_SETUP',
  'GET_PROP',
  'GT',
  'GTE',
  'LOAD_CONST',
  'LOAD_GLOBAL',
  'LOAD_INT',
  'LOAD_THIS',
  'LOAD_UPVALUE',
  'LOOSE_EQ',
  'LOOSE_NEQ',
  'LT',
  'LTE',
  'MAKE_CLOSURE',
  'MOD',
  'MOVE',
  'MUL',
  'NEQ',
  'NEW',
  'SHL',
  'SHR',
  'SUB',
  'TYPEOF',
  'TYPEOF_SAFE',
  'UNARY_BITNOT',
  'UNARY_NEG',
  'UNARY_NOT',
  'UNARY_POS',
  'USHR',
  'VOID',
])

function readOperands(instruction) {
  const { name, operands } = instruction
  if (['STORE_GLOBAL', 'STORE_UPVALUE'].includes(name)) return [operands[1]]
  if (name === 'SET_PROP' || ['DEFINE_GETTER', 'DEFINE_SETTER'].includes(name))
    return operands
  if (
    ['JUMP_IF_FALSE', 'JUMP_IF_TRUE', 'JUMP_REG', 'RETURN', 'THROW'].includes(
      name,
    )
  )
    return [operands[0]]
  if (name === 'FOR_IN_NEXT') return [operands[1]]
  if (['TRY_SETUP', 'TRY_END', 'FINALLY_SETUP'].includes(name)) return []
  return destinationInstructions.has(name) ? operands.slice(1) : operands
}

function eligibleAdjacentCopies(diagnosis) {
  let copies = 0
  for (const functionRecord of diagnosis.result.control.functions) {
    const instructions = functionRecord.blocks.flatMap(({ leaves }) => leaves)
    const reads = new Map()
    for (const instruction of instructions) {
      for (const operand of readOperands(instruction)) {
        if (operand.kind !== 'register') continue
        reads.set(operand.index, (reads.get(operand.index) || 0) + 1)
      }
    }
    const localCaptures = new Set()
    for (const instruction of instructions) {
      if (instruction.name !== 'MAKE_CLOSURE') continue
      for (const operand of instruction.operands.slice(6)) {
        if (operand.kind === 'local') localCaptures.add(operand.index)
      }
    }
    for (const block of functionRecord.blocks) {
      for (let index = 0; index + 1 < block.leaves.length; index += 1) {
        const producer = block.leaves[index]
        const move = block.leaves[index + 1]
        const producerDestination = producer.operands[0]
        const moveDestination = move.operands[0]
        const moveSource = move.operands[1]
        if (
          move.name === 'MOVE' &&
          destinationInstructions.has(producer.name) &&
          producerDestination?.kind === 'register' &&
          moveDestination?.kind === 'register' &&
          moveSource?.kind === 'register' &&
          producerDestination.index === moveSource.index &&
          producerDestination.index !== moveDestination.index &&
          reads.get(producerDestination.index) === 1 &&
          !localCaptures.has(producerDestination.index) &&
          !localCaptures.has(moveDestination.index)
        )
          copies += 1
      }
    }
  }
  return copies
}

function memberParts(node) {
  if (
    node?.type !== 'MemberExpression' ||
    node.computed ||
    node.object?.type !== 'Identifier' ||
    node.property?.type !== 'Identifier'
  )
    return null
  return { object: node.object.name, property: node.property.name }
}

function operationMetrics(ast) {
  const reflectCalls = {}
  let computedGlobalThis = 0
  let descriptorCalls = 0
  let closureWrappers = 0
  let handlerOperations = 0
  let enumerableHelperDeclarations = 0
  let enumerableHelperCalls = 0
  let structuredFunctions = 0
  let stateMachineFunctions = 0

  walk(ast, (node) => {
    const parts = memberParts(node)
    if (parts?.object === 'globalThis') computedGlobalThis += 1
    if (
      parts?.object === '__recovered_handlers' ||
      parts?.object === '__recovered_handler'
    )
      handlerOperations += 1
    if (parts?.object === 'Reflect') {
      reflectCalls[parts.property] = (reflectCalls[parts.property] || 0) + 1
    }
    if (
      parts?.object === 'Object' &&
      ['defineProperty', 'getOwnPropertyDescriptor'].includes(parts.property)
    )
      descriptorCalls += 1
    if (
      node.type === 'FunctionDeclaration' &&
      node.id?.name === '__recovered_enumerable_keys'
    )
      enumerableHelperDeclarations += 1
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      node.callee.name === '__recovered_enumerable_keys'
    )
      enumerableHelperCalls += 1
    if (node.type === 'FunctionExpression' && hasGeneratedIdentifier(node)) {
      if (hasName(node, '__recovered_closure_args')) closureWrappers += 1
    }
    if (
      node.type !== 'FunctionDeclaration' ||
      !node.id?.name.startsWith('__recovered_function_')
    )
      return
    if (hasName(node, '__recovered_dispatch')) stateMachineFunctions += 1
    else structuredFunctions += 1
  })

  return {
    reflectCalls,
    computedGlobalThis,
    descriptorCalls: Math.max(
      0,
      descriptorCalls - enumerableHelperDeclarations,
    ),
    closureWrappers,
    handlerOperations,
    structuredFunctions,
    stateMachineFunctions,
    enumerableHelper: {
      declarations: enumerableHelperDeclarations,
      calls: enumerableHelperCalls,
      unused: enumerableHelperDeclarations > 0 && enumerableHelperCalls === 0,
    },
  }
}

function hasName(node, name) {
  let found = false
  walk(node, (child) => {
    if (child.type === 'Identifier' && child.name === name) found = true
  })
  return found
}

function roundRatio(numerator, denominator) {
  if (denominator === 0) return null
  return Number((numerator / denominator).toFixed(6))
}

function fileMetrics(source) {
  return { bytes: Buffer.byteLength(source), sha256: digest(source) }
}

function caseMetrics(caseId) {
  const directory = path.join(fixtureRoot, caseId)
  const source = readText(path.join(directory, 'source.js'))
  const encoded = readText(path.join(directory, 'encoded.js'))
  const decoded = readText(path.join(directory, 'decoded.js'))
  const diagnosis = diagnoseStandalone(encoded)
  if (!diagnosis.ok)
    throw new Error(
      `${caseId} no longer decodes: ${diagnosis.diagnostic.code}: ${diagnosis.diagnostic.message}`,
    )
  if (diagnosis.result.output !== decoded)
    throw new Error(`${caseId} decoded baseline does not match current output`)

  const sourceAst = parseSource(source)
  const encodedAst = parseSource(encoded)
  const decodedAst = parseSource(decoded)
  const sourceFile = fileMetrics(source)
  const encodedFile = fileMetrics(encoded)
  const decodedFile = fileMetrics(decoded)
  const decodedAstMetrics = astMetrics(decodedAst)
  return {
    caseId,
    status: 'success',
    files: { source: sourceFile, encoded: encodedFile, decoded: decodedFile },
    ratios: {
      decodedToSource: roundRatio(decodedFile.bytes, sourceFile.bytes),
      decodedToEncoded: roundRatio(decodedFile.bytes, encodedFile.bytes),
    },
    ast: {
      source: astMetrics(sourceAst),
      encoded: astMetrics(encodedAst),
      decoded: decodedAstMetrics,
    },
    generatedIdentifiers: identifierMetrics(decodedAst),
    operations: operationMetrics(decodedAst),
    adjacentIdentifierCopies: adjacentIdentifierCopies(decodedAst),
    eligibleAdjacentCopies: eligibleAdjacentCopies(diagnosis),
  }
}

export function collectMetrics() {
  const manifest = readJson(path.join(fixtureRoot, 'manifest.json'))
  const cases = [...manifest.cases].sort()
  return {
    schemaVersion: 'jsconfuser-vm-readability-metrics.v1',
    fixtureSchemaVersion: manifest.schemaVersion,
    cases: cases.map(caseMetrics),
  }
}

export function loadBaseline() {
  return readJson(path.join(fixtureRoot, 'baseline.json'))
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain)
  process.stdout.write(`${JSON.stringify(collectMetrics(), null, 2)}\n`)
