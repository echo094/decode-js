import { parse } from '@babel/parser'
import { diagnoseContainer } from './extract-container.js'
import {
  PARSER_OPTIONS,
  makeContext,
  topLevelDeclarations,
  prototypeMethods,
} from './container-role-helpers.js'
import { diagnoseAntiRuntime } from './analyze-anti-runtime.js'
import { diagnoseSpecializedRuntime } from './observe-specialized-runtime.js'
import { diagnoseMacroRuntime } from './observe-macro-runtime.js'
import { diagnoseAliasedRuntime } from './observe-aliased-runtime.js'

// Allocation order is anti, specialized, macro, alias. Prefix observations can
// stop at a later family; the last observer must prove the entire suffix.
export function diagnosePatchFamilies(source) {
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
      const ast = parse(source, PARSER_OPTIONS)
      const admitted = diagnoseContainer(ast)
      if (!admitted.ok) return admitted
      const context = makeContext(ast)
      const roles = admitted.result.roles
      // The complete minified A routes intentionally erase declaration names.
      // Their source observers already admit only the canonical dispatch, so
      // consume that owned proof instead of searching for a null-name method.
      if (
        roles.constructors.VM.name === null &&
        roles.methods.vm.run.name === null &&
        roles.op.name === null
      )
        return {
          ok: true,
          result: { anti, specialized, macro, alias },
          diagnostic: null,
        }
      const vm = topLevelDeclarations(context).find(
        (item) => item.name === roles.constructors.VM.name,
      )
      const run =
        vm &&
        prototypeMethods(context, vm).find(
          (item) => item.name === roles.methods.vm.run.name,
        )
      const switches = run
        ? context
            .nodes(run.fn)
            .filter((item) => item.node.type === 'SwitchStatement')
        : []
      if (
        switches.length !== 1 ||
        switches[0].node.cases.filter((item) => item.test).length !==
          Object.keys(roles.op.values).length
      )
        return {
          ok: false,
          result: null,
          diagnostic: {
            code: 'patch-family-runtime',
            message: 'The enclosing dispatch has unproved added opcode cases',
          },
        }
    } catch (error) {
      return {
        ok: false,
        result: null,
        diagnostic: { code: 'patch-family-runtime', message: error.message },
      }
    }
  }
  return {
    ok: true,
    result: { anti, specialized, macro, alias },
    diagnostic: null,
  }
}
