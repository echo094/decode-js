import { deepFreeze } from '../../decline.js'
import { partitionHandlers } from '../handlers/locate-handlers.js'
import { requireIdentifiedHandlers } from '../handlers/identify-handlers.js'
import {
  accepted,
  decline,
  refused,
  runtimeAst,
} from '../source/container-role-helpers.js'

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

// A macro handler as its canonical steps, each reading its operands as used; the producer never
// puts an excluded opcode in a macro, and a nonterminal-excluded one only last.
function macroOf(handler, steps) {
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
    decline('macro-runtime', 'Macro case has no unique canonical decomposition')
  return {
    opcode: handler.label,
    steps: steps.map(({ name, opcode }) => ({ name, opcode })),
  }
}

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
  // or more canonical handlers in sequence (`macroOf`).
  const macros = extra.flatMap((handler) => {
    const found = view.added.get(handler.label)
    return found?.kind === 'macro' ? [macroOf(handler, found.steps)] : []
  })
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
  const policy = { fallback: 'macro-runtime-error', freeze: true }
  try {
    return accepted(recognize(runtimeAst(input), options), policy)
  } catch (error) {
    return refused(error, policy)
  }
}
