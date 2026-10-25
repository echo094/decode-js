import { parse } from '@babel/parser'
import { locateBootPayload } from './locate-boot-payload.js'
import { locateHandlers } from './locate-handlers.js'
import { behaviourTable } from './identify-handlers.js'
import {
  ContainerDecline,
  EXPECTED_SENTINELS,
  PARSER_OPTIONS,
  decline,
  deepFreeze,
} from './container-role-helpers.js'

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
    const matched = meaningFromHandlers(ast)
    if (matched)
      return deepFreeze({ ok: true, result: matched, diagnostic: null })
    return deepFreeze({ ok: true, result: located, diagnostic: null })
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
      diagnostic: { code: 'extractor-error', message: error.message },
    })
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
    if (error instanceof ContainerDecline) return null
    throw error
  }
  const { opcodes, sentinel } = behaviourTable(view)
  return locateBootPayload(ast, {
    opcodes,
    sentinels: { CALL_SPREAD: sentinel ?? EXPECTED_SENTINELS.CALL_SPREAD },
  })
}

export function extractContainer(input) {
  return diagnoseContainer(input).result
}

export function extractContainerFromSource(source) {
  return extractContainer(source)
}

export default extractContainer
