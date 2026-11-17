import { deepFreeze } from '../../decline.js'
import { partitionHandlers } from '../handlers/locate-handlers.js'
import { requireIdentifiedHandlers } from '../handlers/identify-handlers.js'
import {
  accepted,
  decline,
  refused,
  runtimeAst,
} from '../source/container-role-helpers.js'

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
  const policy = { fallback: 'specialized-runtime-error', freeze: true }
  try {
    return accepted(recognize(runtimeAst(input), options), policy)
  } catch (error) {
    return refused(error, policy)
  }
}
