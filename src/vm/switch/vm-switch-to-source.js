import { parse } from '@babel/parser'
import { validateVmSwitchModel } from './vm-switch-model.js'
import {
  decline,
  emitHandlerRegisterAssignment,
  emitInstruction,
  functionName,
  functionNeedsArguments,
  localCaptureRegisterSet,
  registerName,
} from './vm-switch-copy-planning.js'
import { emitStructuredFunction } from './vm-switch-structured-emitter.js'
import { planStatements } from './vm-switch-statements.js'

function emitStateMachineFunction(
  functionId,
  instructions,
  functionRecord,
  functions,
) {
  const lines = []
  const indent = (line) => `  ${line}`
  const needsCaptures = functionRecord.captureCount > 0
  const needsArguments = functionNeedsArguments(instructions, functionRecord)
  const hasHandlerSetup = instructions.some(({ operation }) =>
    ['catch-setup', 'finally-setup'].includes(operation.kind),
  )
  const usesHandlers =
    hasHandlerSetup ||
    instructions.some(({ operation }) => operation.kind === 'handler-pop')
  const parameters = []
  if (needsCaptures) parameters.push('__recovered_captures')
  if (needsArguments) parameters.push('...__recovered_args')
  lines.push(`function ${functionName(functionId)}(${parameters.join(', ')}) {`)
  const localCaptureRegisters = localCaptureRegisterSet(instructions)
  if (localCaptureRegisters.size > 0)
    lines.push(indent(`const __recovered_cells_${functionId} = [];`))
  if (functionRecord.regCount > 0)
    lines.push(
      indent(
        `let ${Array.from({ length: functionRecord.regCount }, (_, register) => registerName(functionId, register)).join(', ')};`,
      ),
    )
  if (usesHandlers) lines.push(indent('const __recovered_handlers = [];'))
  if (functionId !== 0) {
    if (needsArguments && functionRecord.hasRest) {
      const restRegister = functionRecord.paramCount - 1
      for (let register = 0; register < restRegister; register++)
        lines.push(
          indent(
            `${registerName(functionId, register)} = __recovered_args[${register}];`,
          ),
        )
      lines.push(
        indent(
          `${registerName(functionId, restRegister)} = __recovered_args.slice(${restRegister});`,
        ),
      )
    } else if (needsArguments) {
      for (let register = 0; register < functionRecord.paramCount; register++)
        lines.push(
          indent(
            `${registerName(functionId, register)} = __recovered_args[${register}];`,
          ),
        )
    }
    if (needsArguments && functionRecord.paramCount < functionRecord.regCount)
      lines.push(
        indent(
          `${registerName(functionId, functionRecord.paramCount)} = __recovered_args;`,
        ),
      )
  }
  lines.push(indent(`let __recovered_pc = ${functionRecord.startPc};`))
  lines.push(indent('__recovered_dispatch: while (true) {'))
  if (hasHandlerSetup) lines.push(indent('  try {'))
  const switchIndent = hasHandlerSetup ? '    ' : '  '
  lines.push(indent(`${switchIndent}switch (__recovered_pc) {`))
  for (const instruction of instructions) {
    const body = emitInstruction(functionId, instruction, functions)
    lines.push(indent(`${switchIndent}  case ${instruction.pc}: {`))
    for (const line of body.split('\n'))
      lines.push(indent(`${switchIndent}    ${line}`))
    lines.push(indent(`${switchIndent}  }`))
  }
  lines.push(
    indent(
      `${switchIndent}  default: throw new Error('Invalid recovered control state');`,
    ),
  )
  lines.push(indent(`${switchIndent}}`))
  if (hasHandlerSetup) {
    lines.push(indent('  } catch (__recovered_error) {'))
    lines.push(
      indent('    const __recovered_handler = __recovered_handlers.pop();'),
    )
    lines.push(indent('    if (!__recovered_handler) throw __recovered_error;'))
    lines.push(indent("    if (__recovered_handler.kind === 'catch') {"))
    for (const line of emitHandlerRegisterAssignment(
      functionId,
      functionRecord.regCount,
      'register',
      '__recovered_error',
    ))
      lines.push(indent(`      ${line}`))
    lines.push(indent('      __recovered_pc = __recovered_handler.target;'))
    lines.push(indent('      continue __recovered_dispatch;'))
    lines.push(indent('    }'))
    for (const line of emitHandlerRegisterAssignment(
      functionId,
      functionRecord.regCount,
      'continuation',
      '__recovered_handler.throwPad',
    ))
      lines.push(indent(`    ${line}`))
    for (const line of emitHandlerRegisterAssignment(
      functionId,
      functionRecord.regCount,
      'payload',
      '__recovered_error',
    ))
      lines.push(indent(`    ${line}`))
    lines.push(indent('    __recovered_pc = __recovered_handler.target;'))
    lines.push(indent('    continue __recovered_dispatch;'))
    lines.push(indent('  }'))
  }
  lines.push(indent('}'))
  lines.push('}')
  return lines
}

function emitFunction(
  functionId,
  instructions,
  functionRecord,
  controlFunction,
  controlEdges,
  functions,
) {
  if (controlFunction.mode === 'structured')
    return emitStructuredFunction(
      functionId,
      instructions,
      functionRecord,
      controlFunction,
      controlEdges,
      functions,
    )
  return {
    lines: emitStateMachineFunction(
      functionId,
      instructions,
      functionRecord,
      functions,
    ),
    copyProofs: [],
  }
}

export function emitVmSwitchProgram(model) {
  validateVmSwitchModel(model)
  const lines = ['(function () {', "  'use strict';"]
  const functionSimplifications = []
  const statements = []
  const hasForIn = [...model.instructionsByFunction.values()].some(
    (instructions) =>
      instructions.some(({ operation }) => operation.kind === 'for-in-setup'),
  )
  if (hasForIn)
    lines.push(
      '  function __recovered_enumerable_keys(__value) {',
      '    const __keys = [];',
      '    if (__value === null || __value === void 0) return __keys;',
      '    const __seen = Object.create(null);',
      '    let __current = Object(__value);',
      '    while (__current !== null) {',
      '      for (const __key of Object.getOwnPropertyNames(__current)) {',
      '        if (__key in __seen) continue;',
      '        __seen[__key] = true;',
      '        const __descriptor = Object.getOwnPropertyDescriptor(__current, __key);',
      '        if (__descriptor && __descriptor.enumerable) __keys.push(__key);',
      '      }',
      '      __current = Object.getPrototypeOf(__current);',
      '    }',
      '    return __keys;',
      '  }',
    )
  for (const functionRecord of model.functions.functions) {
    let control = model.controlByFunction.get(functionRecord.id)
    if (control.mode === 'structured') {
      const regions = planStatements(
        functionRecord,
        control,
        model.structuredControl.edges.filter(
          ({ functionId }) => functionId === functionRecord.id,
        ),
      )
      statements.push({ functionId: functionRecord.id, regions })
      control = { ...control, control: { ...control.control, regions } }
    }
    const emitted = emitFunction(
      functionRecord.id,
      model.instructionsByFunction.get(functionRecord.id),
      functionRecord,
      control,
      model.structuredControl.edges,
      model.functions,
    )
    lines.push(...emitted.lines.map((line) => `  ${line}`))
    functionSimplifications.push({
      functionId: functionRecord.id,
      copies: emitted.copyProofs,
    })
  }
  const root = model.functions.functions[0]
  const rootCaptures = root.captureCount > 0 ? '[]' : ''
  lines.push(`  ${functionName(0)}(${rootCaptures});`)
  lines.push('})();')
  const copies = functionSimplifications.flatMap(({ copies: proofs }) => proofs)
  const output = lines.join('\n')
  validateEmittedJavaScript(output)
  return {
    output,
    statements,
    simplification: {
      schemaVersion: 'vm-switch-simplification.v1',
      functions: functionSimplifications,
      summary: {
        emitted: model.instructionCount - copies.length,
        safelyEliminated: copies.length,
        provenUnreachable: 0,
      },
    },
  }
}

function validateEmittedJavaScript(source) {
  try {
    parse(source, {
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      sourceType: 'script',
    })
  } catch (error) {
    decline(
      'emitted-parse-failed',
      `Fresh parse of VM switch output failed: ${error.message}`,
    )
  }
}
