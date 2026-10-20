import { parse } from '@babel/parser'
import { PARSER_OPTIONS } from './container-role-helpers.js'
import { locateHandlers, partitionHandlers } from './locate-handlers.js'
import { behaviourTable } from './identify-handlers.js'
import { diagnoseAntiRuntime } from './analyze-anti-runtime.js'
import { diagnoseSpecializedRuntime } from './observe-specialized-runtime.js'
import { diagnoseMacroRuntime } from './observe-macro-runtime.js'
import { diagnoseAliasedRuntime } from './observe-aliased-runtime.js'

// Allocation order is anti, specialized, macro, alias. Prefix observations can
// stop at a later option's added opcodes; the last observer must prove the entire suffix.
export function diagnosePatchAddedOpcodes(source) {
  const antiDiagnosis = diagnoseAntiRuntime(source, {
    allowSpecializedTail: true,
  })
  const anti = antiDiagnosis.ok ? antiDiagnosis.result : null
  const specializedOptions = {
    allowAntiPrefix: Boolean(anti),
    allowMacroTail: true,
  }
  const specializedDiagnosis = diagnoseSpecializedRuntime(
    source,
    specializedOptions,
  )
  const specialized = specializedDiagnosis.ok
    ? specializedDiagnosis.result
    : null
  const macroOptions = {
    antiObservation: anti,
    specializedObservation: specialized,
    allowAliasTail: true,
  }
  const macroDiagnosis = diagnoseMacroRuntime(source, macroOptions)
  const macro = macroDiagnosis.ok ? macroDiagnosis.result : null
  const aliasDiagnosis = diagnoseAliasedRuntime(source, {
    antiObservation: anti,
    specializedObservation: specialized,
    macroObservation: macro,
  })
  const alias = aliasDiagnosis.ok ? aliasDiagnosis.result : null
  const complete = aliasDiagnosis.ok
    ? aliasDiagnosis
    : macro
      ? diagnoseMacroRuntime(source, { ...macroOptions, allowAliasTail: false })
      : specialized
        ? diagnoseSpecializedRuntime(source, {
            ...specializedOptions,
            allowMacroTail: false,
          })
        : anti
          ? diagnoseAntiRuntime(source)
          : null
  if (complete && !complete.ok) return complete
  if (!complete) {
    // An unused damaged added case still belongs to the enclosing runtime.
    // Do not admit its canonical payload by silently forgetting the suffix.
    try {
      const view = locateHandlers(parse(source, PARSER_OPTIONS))
      const { extra } = partitionHandlers({
        ...view,
        opcodes: behaviourTable(view).opcodes,
      })
      if (extra.length > 0)
        return {
          ok: false,
          result: null,
          diagnostic: {
            code: 'patch-added-opcode-runtime',
            message: 'The enclosing dispatch has unproved added opcode cases',
          },
        }
    } catch (error) {
      return {
        ok: false,
        result: null,
        diagnostic: {
          code: error.code ?? 'patch-added-opcode-runtime',
          message: error.message,
        },
      }
    }
  }
  return {
    ok: true,
    result: { anti, specialized, macro, alias },
    diagnostic: null,
  }
}
