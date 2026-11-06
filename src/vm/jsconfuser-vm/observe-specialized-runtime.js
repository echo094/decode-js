import { parse } from '@babel/parser'
import { partitionHandlers } from './locate-handlers.js'
import { requireIdentifiedHandlers } from './identify-handlers.js'
import {
  ContainerDecline,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
} from './container-role-helpers.js'

function recognize(
  ast,
  { allowAntiPrefix = false, allowMacroTail = false } = {},
) {
  const view = requireIdentifiedHandlers(ast, 'specialized-runtime-container')
  const { canonical, extra } = partitionHandlers(view)
  if (
    canonical.length !== Object.keys(view.opcodes).length ||
    extra.length === 0
  ) {
    decline(
      'specialized-runtime',
      'Canonical or specialized cases are incomplete',
    )
  }
  // The classifier (identify-handlers.js) sorts the added handlers by what they do; a specialized
  // handler is one canonical handler with every operand baked in, in canonical read order.
  const kindOf = (handler) => view.added.get(handler.label)?.kind ?? null
  const antiPrefixCount = allowAntiPrefix
    ? extra.filter((handler) => kindOf(handler) === 'anti').length
    : 0
  const specialized = []
  for (const handler of extra) {
    const found = view.added.get(handler.label)
    if (found?.kind !== 'specialized') continue
    if (!handler.ends)
      decline('specialized-runtime', 'Specialized case form changed')
    // Each baked operand becomes a word of the expanded instruction.
    if (
      !found.operands.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff,
      )
    )
      decline(
        'specialized-runtime',
        `Specialized case ${handler.label} operand is not a word`,
      )
    specialized.push({
      opcode: handler.label,
      originalName: found.name,
      originalOpcode: found.opcode,
      operands: found.operands,
    })
  }
  if (specialized.length === 0)
    decline('specialized-runtime', 'No specialized opcode cases remain')
  if (!allowMacroTail && specialized.length !== extra.length - antiPrefixCount)
    decline('specialized-runtime', 'Unproved extra opcode cases remain')
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-specialized-runtime-observation.v1',
    antiPrefixCount,
    specialized,
  })
}

export function diagnoseSpecializedRuntime(input, options) {
  try {
    const ast = typeof input === 'string' ? parse(input, PARSER_OPTIONS) : input
    if (ast?.type !== 'File' && ast?.type !== 'Program') {
      decline('invalid-input', 'Expected source text or a Babel AST')
    }
    return deepFreeze({
      ok: true,
      result: recognize(ast, options),
      diagnostic: null,
    })
  } catch (error) {
    if (error instanceof ContainerDecline) {
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    }
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'specialized-runtime-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
