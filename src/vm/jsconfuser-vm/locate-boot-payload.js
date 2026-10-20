import traverse from '@babel/traverse'
import {
  EXPECTED_SENTINELS,
  EXPECTED_SLOTS,
  decline,
  isWordArray,
} from './container-role-helpers.js'
import { decodeCanonicalBytecodeWords } from './materialize-encoded-bytecode.js'
import { createOpcodeTable } from './opcode-table.js'
import { minifiedRuntimeContainer } from './minified-runtime-container.js'

// The boot is located by the skeleton the program cannot run without, never by names: the start
// call receives `new Closure(descriptor)` together with the VM instance, and the VM construction's
// arguments carry the payload. Every step reads values through stable top-level bindings, so
// renaming, devirtualization, inlining and argument decoys leave it intact (extract-container.md).

const REACH_DEPTH = 8
const HEADER_SIZE = 8
const FRAME_START = 1

function programScope(ast) {
  let scope = null
  traverse(ast, {
    Program(path) {
      scope = path.scope
      path.stop()
    },
  })
  return scope
}

// The value a top-level binding always holds: its initializer, or for a bare declaration its only
// write when that write is a top-level `name = value` statement.
function stableValue(scope, node) {
  if (node?.type !== 'Identifier') return null
  const binding = scope.getOwnBinding(node.name)
  if (!binding) return null
  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.node.init
    if (init && binding.constantViolations.length === 0) return init
    if (!init && binding.constantViolations.length === 1) {
      const write = binding.constantViolations[0]
      if (
        write.isAssignmentExpression({ operator: '=' }) &&
        write.parentPath.isExpressionStatement() &&
        write.parentPath.parentPath.isProgram()
      )
        return write.node.right
    }
  }
  return null
}

function resolve(scope, node) {
  const seen = new Set()
  while (node?.type === 'Identifier' && !seen.has(node.name)) {
    seen.add(node.name)
    const value = stableValue(scope, node)
    if (!value) return node
    node = value
  }
  return node
}

// A constant literal's value: plain literals, `void <literal>`, `!<number>`, `-<number>`, and the
// unbound `undefined`. Anything else is not a literal value.
const NOT_LITERAL = Symbol('not a literal')
function literalValue(scope, node) {
  switch (node?.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value
    case 'NullLiteral':
      return null
    case 'Identifier':
      return node.name === 'undefined' && !scope.getBinding('undefined')
        ? undefined
        : NOT_LITERAL
    case 'UnaryExpression': {
      const argument = literalValue(scope, node.argument)
      if (argument === NOT_LITERAL || typeof argument === 'symbol')
        return NOT_LITERAL
      if (node.operator === 'void') return undefined
      if (node.operator === '!' && node.argument.type === 'NumericLiteral')
        return !argument
      if (node.operator === '-' && node.argument.type === 'NumericLiteral')
        return -argument
      return NOT_LITERAL
    }
    default:
      return NOT_LITERAL
  }
}

function poolValues(scope, node) {
  if (node?.type !== 'ArrayExpression' || node.elements.length === 0)
    return null
  const values = node.elements.map((element) => literalValue(scope, element))
  if (values.some((value) => value === NOT_LITERAL)) return null
  return values.some((value) => typeof value === 'string') ? values : null
}

// The payload literals an expression's value is built from: follow stable bindings and the
// arguments of calls and constructions, never a callee.
function reach(scope, node, found, depth = 0, seen = new Set()) {
  if (!node || depth > REACH_DEPTH) return found
  switch (node.type) {
    case 'Identifier': {
      if (seen.has(node.name)) return found
      seen.add(node.name)
      return reach(scope, stableValue(scope, node), found, depth + 1, seen)
    }
    case 'ArrayExpression':
      if (isWordArray(node))
        found.words.push(node.elements.map((element) => element.value))
      else {
        const pool = poolValues(scope, node)
        if (pool) found.pools.push(pool)
      }
      return found
    case 'StringLiteral':
      try {
        found.words.push(decodeCanonicalBytecodeWords(node.value))
      } catch {
        // a string that is not a canonical u32 stream is not a payload
      }
      return found
    case 'CallExpression':
    case 'NewExpression':
      for (const argument of node.arguments)
        reach(scope, argument, found, depth + 1, seen)
      return found
    case 'MemberExpression':
      return reach(scope, node.object, found, depth + 1, seen)
    case 'BinaryExpression':
    case 'LogicalExpression':
      reach(scope, node.left, found, depth + 1, seen)
      return reach(scope, node.right, found, depth + 1, seen)
    case 'ConditionalExpression':
      reach(scope, node.consequent, found, depth + 1, seen)
      return reach(scope, node.alternate, found, depth + 1, seen)
    case 'SequenceExpression':
      return reach(scope, node.expressions.at(-1), found, depth + 1, seen)
    default:
      return found
  }
}

// The root descriptor: three properties whose values are {0, 0, N}; startPc and paramCount are 0.
function descriptorCount(scope, node) {
  if (node?.type !== 'ObjectExpression' || node.properties.length !== 3)
    return null
  const values = []
  for (const property of node.properties) {
    if (property.type !== 'ObjectProperty' || property.computed) return null
    const value = literalValue(scope, resolve(scope, property.value))
    if (typeof value !== 'number') return null
    values.push(value)
  }
  values.sort((left, right) => left - right)
  return values[0] === 0 &&
    values[1] === 0 &&
    Number.isSafeInteger(values[2]) &&
    values[2] > 0
    ? values[2]
    : null
}

function sameValues(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]))
  )
}

function locateBoots(ast, scope) {
  const boots = []
  traverse(ast, {
    NewExpression(path) {
      const regCount = path.node.arguments
        .map((argument) => descriptorCount(scope, resolve(scope, argument)))
        .find((count) => count !== null)
      if (regCount === undefined) return
      const call = path.parentPath
      if (!call.isCallExpression() || !call.node.arguments.includes(path.node))
        return
      const holders = [
        call.node.callee.type === 'MemberExpression'
          ? call.node.callee.object
          : null,
        ...call.node.arguments,
      ]
        .filter(Boolean)
        .map((node) => resolve(scope, node))
        .filter((node) => node.type === 'NewExpression' && node !== path.node)
      for (const vm of holders) {
        const found = reach(scope, vm, { words: [], pools: [] })
        if (found.words.length === 1 && found.pools.length === 1)
          boots.push({
            words: found.words[0],
            pool: found.pools[0],
            regCount,
            call: call.node,
            holder: vm,
          })
      }
    },
  })
  return boots
}

// The boot call and the VM construction it receives, with the construction's argument positions
// that carry the word stream and the pool: where the runtime readers enter the interpreter.
export function locateBootSkeleton(ast) {
  const scope = programScope(ast)
  if (!scope) decline('missing-role', 'Input has no program')
  const boots = locateBoots(ast, scope)
  if (boots.length !== 1)
    decline('missing-role', 'Boot call is missing or not unique')
  const [{ call, holder }] = boots
  const carriers = (key) =>
    holder.arguments.flatMap((argument, index) =>
      reach(scope, argument, { words: [], pools: [] })[key].length === 1
        ? [index]
        : [],
    )
  const words = carriers('words')
  const pools = carriers('pools')
  if (words.length !== 1 || pools.length !== 1)
    decline('missing-role', 'VM construction payload arguments are not unique')
  return { call, holder, wordsIndex: words[0], poolIndex: pools[0] }
}

// The words keep their values; with a runtime meaning (handler-meaning.js) the decode's opcode table
// and sentinel are the matched ones, otherwise the canonical ones.
export function locateBootPayload(ast, meaning = null) {
  const scope = programScope(ast)
  if (!scope) decline('missing-role', 'Input has no program')
  const boots = locateBoots(ast, scope)
  if (boots.length === 0)
    decline(
      'missing-role',
      'No boot call carries a payload and root descriptor',
    )
  const [boot] = boots
  if (
    boots.some(
      (other) =>
        !sameValues(other.words, boot.words) ||
        !sameValues(other.pool, boot.pool) ||
        other.regCount !== boot.regCount,
    )
  )
    decline('ambiguous-role', 'Boot payload is not unique')
  return minifiedRuntimeContainer({
    words: boot.words,
    pool: boot.pool,
    opcodes: meaning
      ? { ...createOpcodeTable(), ...meaning.opcodes }
      : createOpcodeTable(),
    sentinels: meaning ? meaning.sentinels : EXPECTED_SENTINELS,
    slots: EXPECTED_SLOTS,
    root: { startPc: 0, regCount: boot.regCount },
    frame: { headerSize: HEADER_SIZE, frameStart: FRAME_START },
  })
}
