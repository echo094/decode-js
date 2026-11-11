import { parse } from '@babel/parser'
import { partitionHandlers } from './locate-handlers.js'
import { requireIdentifiedHandlers } from './identify-handlers.js'
import {
  ContainerDecline,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
} from './container-role-helpers.js'

function recognize(ast, { allowSpecializedTail = false } = {}) {
  const view = requireIdentifiedHandlers(ast, 'anti-runtime-container')
  const { canonical, extra } = partitionHandlers(view)
  if (canonical.length !== Object.keys(view.opcodes).length) {
    decline('anti-runtime', 'Canonical opcode cases are incomplete')
  }
  if (extra.length === 0) {
    decline('anti-runtime', 'No synthetic opcode cases were emitted')
  }
  // The classifier (identify-handlers.js) sorts the added handlers by what they do; a synthetic
  // case is three or more canonical steps reading all of its operands up front into one array.
  // Its reads are therefore stored positions: step by step, they are the stored position each
  // canonical operand takes.
  const cases = []
  for (const handler of extra) {
    const found = view.added.get(handler.label)
    if (found?.kind !== 'anti') continue
    if (!handler.ends)
      decline('anti-runtime', `Synthetic case ${handler.label} form changed`)
    const canonicalToStored = found.steps.flatMap((step) => step.reads)
    let operandStart = 0
    const steps = found.steps.map((step) => {
      const item = {
        name: step.name,
        operandStart,
        operandCount: step.reads.length,
      }
      operandStart += step.reads.length
      return item
    })
    if (steps.length < 3)
      decline(
        'anti-runtime-steps',
        `Synthetic case ${handler.label} step width changed`,
      )
    cases.push({
      opcode: handler.label,
      arity: canonicalToStored.length,
      canonicalToStored,
      steps,
    })
  }
  if (cases.length === 0) {
    decline('anti-runtime', 'No synthetic opcode prefix was emitted')
  }
  if (!allowSpecializedTail && cases.length !== extra.length) {
    decline('anti-runtime', 'Unproved extra opcode cases remain')
  }
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-anti-runtime-observation.v1',
    syntheticCases: cases,
  })
}

export function diagnoseAntiRuntime(input, options) {
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
        code: 'anti-runtime-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
