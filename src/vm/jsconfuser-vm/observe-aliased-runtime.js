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
  {
    antiObservation = null,
    specializedObservation = null,
    macroObservation = null,
  } = {},
) {
  const view = requireIdentifiedHandlers(ast, 'alias-runtime-container')
  const { canonical, extra } = partitionHandlers(view)
  if (
    canonical.length !== Object.keys(view.opcodes).length ||
    extra.length === 0
  ) {
    decline('alias-runtime', 'Canonical or alias cases are incomplete')
  }
  const antiPrefixCount = antiObservation?.syntheticCases.length ?? 0
  const specializedPrefixCount = specializedObservation?.specialized.length ?? 0
  const macroPrefixCount = macroObservation?.macros.length ?? 0
  // The classifier (identify-handlers.js) sorts the added handlers by what they do; an alias is one
  // canonical handler reading its operands in another order (`canonicalToStored[j]` is the read
  // canonical operand j takes). Every other added handler belongs to an earlier observation.
  const aliases = []
  for (const handler of extra) {
    const found = view.added.get(handler.label)
    if (found?.kind !== 'alias') continue
    if (!handler.ends) decline('alias-runtime', 'Alias case form changed')
    aliases.push({
      opcode: handler.label,
      originalOpcode: found.opcode,
      originalName: found.name,
      arity: found.canonicalToStored.length,
      canonicalToStored: found.canonicalToStored,
    })
  }
  if (aliases.length === 0)
    decline('alias-runtime', 'No alias opcode cases remain')
  if (
    extra.length - aliases.length !==
    antiPrefixCount + specializedPrefixCount + macroPrefixCount
  )
    decline('alias-runtime', 'Unproved extra opcode cases remain')
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-aliased-runtime-observation.v1',
    antiPrefixCount,
    specializedPrefixCount,
    macroPrefixCount,
    aliases,
  })
}

export function diagnoseAliasedRuntime(input, options) {
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
        code: 'alias-runtime-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
