import { parse } from '@babel/parser'
import { StandaloneDecline, deepFreeze } from './standalone-contract.js'
import { diagnoseStandaloneInput } from './diagnose-standalone.js'
import { numericToVmSwitch } from './numeric-to-vm-switch.js'
import { VmSwitchDecline } from '../switch/vm-switch-model.js'
import { emitVmSwitchProgram } from '../switch/vm-switch-to-source.js'

const STANDALONE_SCHEMA = 'jsconfuser-vm-standalone.v2'
const RESIDUE_IDENTIFIERS = new Set([
  'BYTECODE',
  'CONSTANTS',
  'ENCODE_BYTECODE',
  'VM',
  'Closure',
  'Upvalue',
  'decodeBytecode',
])

function validateNumericVmResidue(source) {
  const ast = parse(source, { errorRecovery: false, sourceType: 'script' })
  let residue = null
  const visit = (node) => {
    if (!node || residue) return
    if (node.type === 'Identifier' && RESIDUE_IDENTIFIERS.has(node.name)) {
      residue = node.name
      return
    }
    if (
      node.type === 'MemberExpression' &&
      node.object?.type === 'Identifier' &&
      node.object.name === 'vm' &&
      node.property?.type === 'Identifier' &&
      node.property.name === 'run' &&
      node.computed === false
    ) {
      residue = 'vm.run'
      return
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) visit(child)
      } else if (value?.type) visit(value)
    }
  }
  visit(ast)
  if (residue)
    throw new VmSwitchDecline(
      'emitted-residue',
      `Standalone output contains forbidden VM residue ${residue}`,
    )
}

export function diagnoseStandalone(source) {
  try {
    const preflight = diagnoseStandaloneInput(source)
    if (!preflight.ok)
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: preflight.diagnostic,
      })
    const model = preflight.model
    const switchModel = numericToVmSwitch(model)
    const emitted = emitVmSwitchProgram(switchModel)
    validateNumericVmResidue(emitted.output)
    const result = {
      schemaVersion: STANDALONE_SCHEMA,
      parseOnly: true,
      targetExecution: false,
      vmExecuted: false,
      emittedJavaScript: true,
      finalJavaScriptSemantics: false,
      wordCount: model.wordcode.wordCount,
      instructionCount: model.wordcode.instructionCount,
      functionCount: model.functions.functions.length,
      output: emitted.output,
      simplification: {
        ...emitted.simplification,
        schemaVersion: 'jsconfuser-vm-simplification.v1',
      },
      coverage: {
        instructions: model.wordcode.instructionCount,
        functions: model.functions.functions.length,
      },
      statements: emitted.statements,
      proof: {
        allPredecessorsReconstructed: true,
        noTargetExecution: true,
        noVmRuntimeEmission: true,
        freshJavaScriptEmission: true,
        freshSimplificationState: true,
        simplificationDispositionsDisjoint: true,
        finalParseValidated: true,
        finalResidueValidated: true,
      },
    }
    return deepFreeze({ ok: true, result, diagnostic: null })
  } catch (error) {
    if (error instanceof StandaloneDecline || error instanceof VmSwitchDecline)
      return deepFreeze({
        ok: false,
        result: null,
        diagnostic: { code: error.code, message: error.message },
      })
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code: 'standalone-emission-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function decodeStandalone(source) {
  return diagnoseStandalone(source).result?.output ?? null
}

export const emitStandalone = decodeStandalone
export default decodeStandalone
