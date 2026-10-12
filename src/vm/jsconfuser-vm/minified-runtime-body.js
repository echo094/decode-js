import crypto from 'node:crypto'
import { makeContext } from './container-role-helpers.js'

// Generated from the pinned numeric browser runtime after Closure Compiler
// ADVANCED optimization. The signature ignores lexical spelling and short
// internal property spelling, while retaining every operation and literal.
const PINNED_RUNTIME_BODY_SHA256 =
  'b88f3983ece97cf82b147cdfa84b2e85882c45669652bf6adb45cc6a46eb2fff'
const PINNED_HANDLER_TABLE_BODY_SHA256 =
  '01aa1b6785faa4f44671774072bd0b12c3a8bf26191079bee66cf08d976dae33'

const IGNORED_AST_KEYS = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
])

function isStaticProperty(path) {
  const parent = path.parentPath?.node
  const node = path.node
  return (
    (parent?.type === 'MemberExpression' &&
      !parent.computed &&
      parent.property === node) ||
    ((parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod') &&
      !parent.computed &&
      parent.key === node)
  )
}

export function minifiedRuntimeBodySignature(ast, boot) {
  const context = makeContext(ast)
  const bindings = new Map()
  const shortProperties = new Map()
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value === null || typeof value !== 'object') return value
    if (value.type === 'Identifier') {
      const path = context.paths.get(value)
      if (isStaticProperty(path)) {
        const name = value.name
        if (name.length > 2) return ['Identifier', name]
        if (!shortProperties.has(name)) {
          shortProperties.set(name, shortProperties.size)
        }
        return ['Identifier', `P${shortProperties.get(name)}`]
      }
      const binding = context.bindingFor(value)
      if (
        binding &&
        (path.isBindingIdentifier() || path.isReferencedIdentifier())
      ) {
        if (!bindings.has(binding)) bindings.set(binding, bindings.size)
        return ['Identifier', `B${bindings.get(binding)}`]
      }
      return ['Identifier', value.name]
    }
    const result = {}
    for (const key of Object.keys(value).sort()) {
      if (!IGNORED_AST_KEYS.has(key)) result[key] = canonical(value[key])
    }
    return result
  }
  const body = context.program.body.filter(
    (statement) => statement.expression !== boot,
  )
  const serialized = JSON.stringify(canonical(body))
  return crypto.createHash('sha256').update(serialized).digest('hex')
}

export function hasPinnedMinifiedRuntimeBody(ast, boot) {
  return minifiedRuntimeBodySignature(ast, boot) === PINNED_RUNTIME_BODY_SHA256
}

export function hasPinnedMinifiedHandlerTableBody(ast, boot) {
  return (
    minifiedRuntimeBodySignature(ast, boot) === PINNED_HANDLER_TABLE_BODY_SHA256
  )
}
