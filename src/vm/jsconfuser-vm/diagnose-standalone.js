import {
  StandaloneDecline,
  decline,
  requireValue,
} from './standalone-contract.js'
import { extractContainerFromSource } from './extract-container.js'
import { readWordcode } from './read-wordcode.js'
import { validateReferences } from './validate-references.js'
import { partitionFunctions } from './partition-functions.js'
import { buildControlFlow } from './build-cfg.js'
import { buildCallFrames } from './build-call-frames.js'
import { analyzeClosureLifetimes } from './analyze-closure-lifetimes.js'
import { analyzeExceptionFinally } from './analyze-exception-finally.js'
import { analyzeScalarValues } from './analyze-scalar-values.js'
import { analyzePropertyCollections } from './analyze-property-collections.js'
import { emitStructuredControl } from './emit-structured-control.js'
import { emitCallCompletion } from './emit-call-completion.js'
import { emitClosureException } from './emit-closure-exception.js'

const SUPPORTED_INSTRUCTIONS = new Set([
  'ADD',
  'BAND',
  'BOR',
  'BXOR',
  'CALL',
  'CALL_METHOD',
  'BUILD_ARRAY',
  'BUILD_OBJECT',
  'DEBUGGER',
  'DELETE_PROP',
  'DEFINE_GETTER',
  'DEFINE_SETTER',
  'DIV',
  'EQ',
  'EXP',
  'FINALLY_SETUP',
  'FOR_IN_NEXT',
  'FOR_IN_SETUP',
  'GET_PROP',
  'GTE',
  'GT',
  'IN',
  'INSTANCEOF',
  'JUMP',
  'JUMP_IF_FALSE',
  'JUMP_IF_TRUE',
  'JUMP_REG',
  'LOAD_CONST',
  'LOAD_GLOBAL',
  'LOAD_INT',
  'LOAD_THIS',
  'LOAD_UPVALUE',
  'LOOSE_EQ',
  'LOOSE_NEQ',
  'LT',
  'LTE',
  'MAKE_CLOSURE',
  'MOD',
  'MOVE',
  'MUL',
  'NEW',
  'NEQ',
  'RETURN',
  'SET_PROP',
  'SHL',
  'SHR',
  'STORE_GLOBAL',
  'STORE_UPVALUE',
  'SUB',
  'THROW',
  'TRY_END',
  'TRY_SETUP',
  'TYPEOF',
  'TYPEOF_SAFE',
  'UNARY_BITNOT',
  'UNARY_NEG',
  'UNARY_NOT',
  'UNARY_POS',
  'USHR',
  'VOID',
])

function instructionMap(wordcode) {
  return new Map(
    wordcode.instructions.map((instruction) => [instruction.pc, instruction]),
  )
}

function functionInstructionMap(wordcode, functions) {
  const byPc = instructionMap(wordcode)
  return new Map(
    functions.functions.map((functionRecord) => [
      functionRecord.id,
      functionRecord.instructionPcs.map((pc) => {
        const instruction = byPc.get(pc)
        return requireValue(
          instruction,
          'missing-instruction',
          `Function ${functionRecord.id} owns missing instruction ${pc}`,
        )
      }),
    ]),
  )
}

function callRecordMap(callCompletion) {
  return new Map(
    callCompletion.calls.map((call) => [`${call.functionId}:${call.pc}`, call]),
  )
}

function reconstruct(source) {
  if (typeof source !== 'string')
    decline('invalid-input', 'Standalone decoder input must be a string')
  const container = requireValue(
    extractContainerFromSource(source),
    'container-declined',
    'Packet A declined the input container',
  )
  const wordcode = requireValue(
    readWordcode(container),
    'wordcode-declined',
    'Packet B declined the input wordcode',
  )
  const references = requireValue(
    validateReferences(container, wordcode),
    'references-declined',
    'Packet C declined the input references',
  )
  const functions = requireValue(
    partitionFunctions(container, wordcode, references),
    'functions-declined',
    'Packet D declined the input function partition',
  )
  const cfg = requireValue(
    buildControlFlow(wordcode, references, functions),
    'cfg-declined',
    'Packet E declined the input control flow',
  )
  const callFrames = requireValue(
    buildCallFrames(wordcode, references, functions, cfg),
    'call-frames-declined',
    'Packet F declined the input call/frame model',
  )
  const closureLifetimes = requireValue(
    analyzeClosureLifetimes(wordcode, references, functions, cfg, callFrames),
    'closure-lifetimes-declined',
    'Packet G declined the input closure model',
  )
  const exceptionFinally = requireValue(
    analyzeExceptionFinally(wordcode, references, functions, cfg, callFrames),
    'exception-finally-declined',
    'Packet H declined the input exception model',
  )
  const scalarValues = requireValue(
    analyzeScalarValues(wordcode, references, functions, cfg),
    'scalar-values-declined',
    'Packet I declined the input scalar/value model',
  )
  const propertyCollections = requireValue(
    analyzePropertyCollections(
      wordcode,
      references,
      functions,
      cfg,
      callFrames,
    ),
    'property-collections-declined',
    'Packet J declined the input property/collection model',
  )
  const structuredControl = requireValue(
    emitStructuredControl(wordcode, cfg, exceptionFinally),
    'structured-control-declined',
    'Packet K declined the input structured-control model',
  )
  const callCompletion = requireValue(
    emitCallCompletion(
      wordcode,
      references,
      functions,
      cfg,
      callFrames,
      closureLifetimes,
    ),
    'call-completion-declined',
    'Packet L declined the input call/completion model',
  )
  const closureException = requireValue(
    emitClosureException(
      wordcode,
      references,
      functions,
      cfg,
      callFrames,
      closureLifetimes,
      exceptionFinally,
    ),
    'closure-exception-declined',
    'Packet M declined the input closure/exception model',
  )
  for (const instruction of wordcode.instructions) {
    if (!SUPPORTED_INSTRUCTIONS.has(instruction.name))
      decline(
        'unsupported-opcode',
        `Standalone emission does not support ${instruction.name}`,
      )
  }
  if (
    !structuredControl.coverage.instructions.complete ||
    !structuredControl.coverage.edges.complete ||
    !callCompletion.coverage.instructions.complete ||
    !callCompletion.coverage.completions.complete ||
    !callCompletion.coverage.completionRoutes.complete ||
    !closureException.coverage.instructions.complete ||
    !closureException.coverage.completions.complete ||
    !closureException.coverage.routes.complete
  ) {
    decline(
      'incomplete-predecessor-coverage',
      'An accepted predecessor reports incomplete coverage',
    )
  }
  return {
    constants: references.constants.values,
    functions,
    instructionsByFunction: functionInstructionMap(wordcode, functions),
    controlByFunction: new Map(
      structuredControl.functions.map((control) => [control.id, control]),
    ),
    structuredControl,
    calls: callRecordMap(callCompletion),
    scalarValues,
    propertyCollections,
    wordcode,
    closureException,
  }
}

export function diagnoseStandaloneInput(source) {
  try {
    return { ok: true, model: reconstruct(source), diagnostic: null }
  } catch (error) {
    if (error instanceof StandaloneDecline)
      return {
        ok: false,
        model: null,
        diagnostic: { code: error.code, message: error.message },
      }
    throw error
  }
}
