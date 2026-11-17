import { parse } from '@babel/parser'
import { locateBootPayload } from './source/locate-boot-payload.js'
import { locateHandlers } from './handlers/locate-handlers.js'
import { behaviourTable } from './handlers/identify-handlers.js'
import {
  EXPECTED_SENTINELS,
  PARSER_OPTIONS,
  decline,
  accepted,
  refused,
} from './source/container-role-helpers.js'

function parseInput(input) {
  if (typeof input === 'string') return parse(input, PARSER_OPTIONS)
  if (input?.type === 'File' || input?.type === 'Program') return input
  decline(
    'invalid-input',
    'Container extractor expects source text or a Babel AST',
  )
}

// The container: the payload located by the boot skeleton (locate-boot-payload.js), with the
// opcode table the handlers' behaviour gives when the runtime is located; otherwise the canonical
// table.
export function diagnoseContainer(input) {
  try {
    const ast = parseInput(input)
    const located = locateBootPayload(ast)
    return accepted(meaningFromHandlers(ast) ?? located, {
      fallback: 'extractor-error',
      freeze: true,
    })
  } catch (error) {
    return refused(error, { fallback: 'extractor-error', freeze: true })
  }
}

// The opcode table by handler behaviour (identify-handlers.js), published whatever the words hold:
// added opcodes are left to the readers readWordcode's retries open. None when the runtime is not
// located.
function meaningFromHandlers(ast) {
  let view
  try {
    view = locateHandlers(ast)
  } catch (error) {
    // A refusal of the locator's own means the runtime is not located; anything else passes on.
    refused(error)
    return null
  }
  if (!view) return null
  const { opcodes, sentinel } = behaviourTable(view)
  return locateBootPayload(ast, {
    opcodes,
    sentinels: { CALL_SPREAD: sentinel ?? EXPECTED_SENTINELS.CALL_SPREAD },
  })
}

export function extractContainer(input) {
  return diagnoseContainer(input).result
}
