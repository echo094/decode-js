import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { accepted, refused, unwrap } from './standalone-contract.js'
import { diagnoseStandaloneInput } from './diagnose-standalone.js'
import { numericToVmSwitch } from './numeric-to-vm-switch.js'
import { decline as declineVmSwitch } from '../switch/model/model.js'
import { emitVmSwitchProgram } from '../switch/to-source.js'

const STANDALONE_SCHEMA = 'jsconfuser-vm-standalone.v3'
const RESIDUE_IDENTIFIERS = new Set([
  'BYTECODE',
  'CONSTANTS',
  'ENCODE_BYTECODE',
  'VM',
  'Closure',
  'Upvalue',
  'decodeBytecode',
])

// The residue a node is: a VM identifier, or `vm.run`; null otherwise.
function residueOf(node) {
  if (node.type === 'Identifier' && RESIDUE_IDENTIFIERS.has(node.name))
    return node.name
  if (
    node.type === 'MemberExpression' &&
    node.object?.type === 'Identifier' &&
    node.object.name === 'vm' &&
    node.property?.type === 'Identifier' &&
    node.property.name === 'run' &&
    node.computed === false
  )
    return 'vm.run'
  return null
}

function validateNumericVmResidue(source) {
  const ast = parse(source, { errorRecovery: false, sourceType: 'script' })
  let residue = null
  t.traverseFast(ast, (node) => {
    residue = residueOf(node)
    return residue ? t.traverseFast.stop : undefined
  })
  if (residue)
    declineVmSwitch(
      'emitted-residue',
      `Standalone output contains forbidden VM residue ${residue}`,
    )
}

export function diagnoseStandalone(source) {
  try {
    const model = unwrap(diagnoseStandaloneInput(source))
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
    }
    return accepted(result, {
      fallback: 'standalone-emission-error',
      owners: ['standalone', 'vm-switch'],
      freeze: true,
    })
  } catch (error) {
    return refused(error, {
      fallback: 'standalone-emission-error',
      owners: ['standalone', 'vm-switch'],
      freeze: true,
    })
  }
}
