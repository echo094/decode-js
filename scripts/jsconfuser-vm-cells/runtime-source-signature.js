import crypto from 'node:crypto'

export const BASE64_SHA256 =
  '2cbdb5905ce7889c55b6672a05631b9f7f0470ff72577a07ec4b44b65bd61e07'

const OMIT = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

function canonical(value, context, bindings) {
  if (Array.isArray(value))
    return value.map((child) => canonical(child, context, bindings))
  if (value === null || typeof value !== 'object') return value
  const result = Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => !OMIT.has(key))
      .map((key) => [key, canonical(value[key], context, bindings)]),
  )
  const path = context.paths.get(value)
  const binding =
    value.type === 'Identifier' &&
    path &&
    (path.isBindingIdentifier() || path.isReferencedIdentifier())
      ? context.bindingFor(value)
      : null
  if (binding) {
    if (!bindings.has(binding)) bindings.set(binding, bindings.size)
    result.name = `binding:${bindings.get(binding)}`
  }
  return result
}

export function runtimeSignature(node, context) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(node, context, new Map())))
    .digest('hex')
}
