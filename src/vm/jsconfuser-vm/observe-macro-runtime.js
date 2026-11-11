import { parse } from '@babel/parser'
import { partitionHandlers } from './locate-handlers.js'
import { requireIdentifiedHandlers } from './identify-handlers.js'
import {
  ContainerDecline,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
} from './container-role-helpers.js'

const ALWAYS_EXCLUDED = new Set([
  'PATCH',
  'TRY_SETUP',
  'TRY_END',
  'DEBUGGER',
  'MAKE_CLOSURE',
])
const NONTERMINAL_EXCLUDED = new Set([
  'RETURN',
  'CALL',
  'CALL_METHOD',
  'NEW',
  'THROW',
  'JUMP',
  'JUMP_IF_FALSE',
  'JUMP_IF_TRUE',
  'FOR_IN_NEXT',
  'FINALLY_SETUP',
])

function recognize(
  ast,
  {
    antiObservation = null,
    specializedObservation = null,
    allowAliasTail = false,
  } = {},
) {
  const view = requireIdentifiedHandlers(ast, 'macro-runtime-container')
  const { canonical, extra } = partitionHandlers(view)
  if (
    canonical.length !== Object.keys(view.opcodes).length ||
    extra.length === 0
  ) {
    decline('macro-runtime', 'Canonical or macro cases are incomplete')
  }
  const antiPrefixCount = antiObservation?.syntheticCases.length ?? 0
  const specializedPrefixCount = specializedObservation?.specialized.length ?? 0
  // The classifier (identify-handlers.js) sorts the added handlers by what they do; a macro is two
  // or more canonical handlers in sequence, reading their operands as they are used. The producer
  // never puts an excluded opcode in a macro, and a nonterminal-excluded one only last.
  const macros = []
  for (const handler of extra) {
    const found = view.added.get(handler.label)
    if (found?.kind !== 'macro') continue
    const { steps } = found
    const reads = steps.flatMap((step) => step.reads)
    if (
      !handler.ends ||
      steps.length < 2 ||
      steps.length > 5 ||
      reads.some((read, index) => read !== index) ||
      steps.some(
        (step, index) =>
          ALWAYS_EXCLUDED.has(step.name) ||
          (NONTERMINAL_EXCLUDED.has(step.name) && index !== steps.length - 1),
      )
    )
      decline(
        'macro-runtime',
        'Macro case has no unique canonical decomposition',
      )
    macros.push({
      opcode: handler.label,
      steps: steps.map(({ name, opcode }) => ({ name, opcode })),
    })
  }
  if (macros.length === 0)
    decline('macro-runtime', 'No macro opcode cases remain')
  if (
    !allowAliasTail &&
    extra.length - macros.length !== antiPrefixCount + specializedPrefixCount
  )
    decline('macro-runtime', 'Unproved extra opcode cases remain')
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-macro-runtime-observation.v1',
    antiPrefixCount,
    specializedPrefixCount,
    macros,
  })
}

export function diagnoseMacroRuntime(input, options) {
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
        code: 'macro-runtime-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
