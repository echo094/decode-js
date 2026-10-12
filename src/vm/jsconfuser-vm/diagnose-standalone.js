import { parse } from '@babel/parser'
import generate from '@babel/generator'
import {
  StandaloneDecline,
  decline,
  requireValue,
} from './standalone-contract.js'
import { extractContainerFromSource } from './extract-container.js'
import { materializeHandlerTable } from './materialize-handler-table.js'
import { ContainerDecline, PARSER_OPTIONS } from './container-role-helpers.js'
import { diagnoseWordcode, readWordcode } from './read-wordcode.js'
import { diagnoseNormalizeAntiWordcode } from './normalize-anti-wordcode.js'
import { diagnoseNormalizeAliasedWordcode } from './normalize-aliased-wordcode.js'
import { diagnoseNormalizeMacroWordcode } from './normalize-macro-wordcode.js'
import {
  diagnoseNormalizeAntiSpecializedWordcode,
  diagnoseNormalizeSpecializedWordcode,
} from './normalize-specialized-wordcode.js'
import { diagnoseNormalizeSelfModifyingWordcode } from './normalize-self-modifying-wordcode.js'
import { diagnoseNormalizeConcealedConstants } from './normalize-concealed-constants.js'
import { diagnoseNormalizeDispatcherWordcode } from './normalize-dispatcher-wordcode.js'
import { diagnoseNormalizeCffWordcode } from './normalize-cff-wordcode.js'
import { diagnoseNormalizeStringConcealing } from './normalize-string-concealing.js'
import { validateReferences } from './validate-references.js'
import {
  diagnoseFunctionPartition,
  partitionFunctions,
} from './partition-functions.js'
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
        return instruction
      }),
    ]),
  )
}

function callRecordMap(callCompletion) {
  return new Map(
    callCompletion.calls.map((call) => [`${call.functionId}:${call.pc}`, call]),
  )
}

function analysisSource(source) {
  try {
    return generate(materializeHandlerTable(parse(source, PARSER_OPTIONS))).code
  } catch (error) {
    if (error instanceof ContainerDecline) return source
    throw error
  }
}

function reconstruct(source) {
  if (typeof source !== 'string')
    decline('invalid-input', 'Standalone decoder input must be a string')
  let container = requireValue(
    extractContainerFromSource(source),
    'container-declined',
    'Packet A declined the input container',
  )
  source = analysisSource(source)
  let records = {}
  let wordcode = readWordcode(container)
  if (
    !wordcode &&
    diagnoseWordcode(container).diagnostic?.code === 'unknown-opcode'
  ) {
    let normalized = diagnoseNormalizeAliasedWordcode(source, container)
    if (!normalized.ok) {
      normalized = diagnoseNormalizeAliasedWordcode(source, container, {
        allowObservedPrefix: true,
      })
    }
    if (!normalized.ok) {
      normalized = diagnoseNormalizeMacroWordcode(source, container)
    }
    if (!normalized.ok) {
      normalized = diagnoseNormalizeSpecializedWordcode(source, container)
    }
    if (!normalized.ok) {
      normalized = diagnoseNormalizeAntiSpecializedWordcode(source, container)
    }
    if (!normalized.ok) {
      normalized = diagnoseNormalizeAntiWordcode(source, container)
    }
    if (normalized.ok) {
      records = normalized.result
      container = records.container
      wordcode = records.wordcode
    }
  }
  if (
    !wordcode &&
    diagnoseWordcode(container).diagnostic?.code ===
      'unsupported-hardening-opcode'
  ) {
    const normalized = diagnoseNormalizeSelfModifyingWordcode(container)
    if (normalized.ok) {
      records = normalized.result
      container = records.container
      wordcode = records.wordcode
    }
  }
  wordcode = requireValue(
    wordcode,
    'wordcode-declined',
    'Packet B declined the input wordcode',
  )
  if (
    wordcode.instructions.some((instruction) =>
      instruction.operands.some(
        (operand) =>
          operand.kind === 'constant-ref' && operand.concealKey !== 0,
      ),
    )
  ) {
    const diagnosis = diagnoseNormalizeConcealedConstants(
      source,
      container,
      wordcode,
    )
    const normalized = requireValue(
      diagnosis.ok ? diagnosis.result : null,
      'concealed-constants-declined',
      'Concealed constant normalization declined the input',
    )
    container = normalized.container
    wordcode = normalized.wordcode
    records = normalized
  }
  let references = requireValue(
    records.references ?? validateReferences(container, wordcode),
    'references-declined',
    'Packet C declined the input references',
  )
  if (
    wordcode.instructions[0]?.name === 'MAKE_CLOSURE' &&
    wordcode.instructions[1]?.name === 'LOAD_CONST' &&
    wordcode.instructions[2]?.name === 'CALL' &&
    wordcode.instructions[0].functionMeta?.paramCount === 1
  ) {
    let diagnosis = diagnoseNormalizeStringConcealing(
      container,
      wordcode,
      references,
    )
    for (const adapter of [
      diagnoseNormalizeDispatcherWordcode,
      diagnoseNormalizeCffWordcode,
    ]) {
      if (diagnosis.ok) break
      const counts = new Map()
      for (const descriptor of references.frame.descriptors) {
        if (descriptor.paramCount !== 4 || descriptor.captureCount !== 0)
          continue
        counts.set(
          descriptor.startPc,
          (counts.get(descriptor.startPc) ?? 0) + 1,
        )
      }
      const shared = [...counts]
        .filter(([, count]) => count > 1)
        .map(([pc]) => pc)
      if (shared.length > 1) break
      const options = {
        allowSharedParentStarts: new Set(shared),
        deferControlFlow: adapter === diagnoseNormalizeDispatcherWordcode,
      }
      const preliminary = diagnoseFunctionPartition(
        container,
        wordcode,
        references,
        options,
      )
      if (!preliminary.ok) break
      const prepared = adapter(container, wordcode, preliminary.result, options)
      if (!prepared.ok) continue
      records = prepared.result
      container = records.container
      wordcode = records.wordcode
      references = records.references
      diagnosis = diagnoseNormalizeStringConcealing(
        container,
        wordcode,
        references,
      )
    }
    const normalized = requireValue(
      diagnosis.ok ? diagnosis.result : null,
      'string-concealing-declined',
      'String concealment normalization declined the input',
    )
    container = normalized.container
    records = normalized
    wordcode = records.wordcode
    references = records.references
  }
  let functions = requireValue(
    records.functions ?? partitionFunctions(container, wordcode, references),
    'functions-declined',
    'Packet D declined the input function partition',
  )
  if (
    wordcode.instructions.some((instruction) => instruction.name === 'JUMP_REG')
  ) {
    const prepared = diagnoseNormalizeDispatcherWordcode(
      container,
      wordcode,
      functions,
      { allowSharedParentStarts: new Set(), deferControlFlow: true },
    )
    if (prepared.ok) {
      records = prepared.result
      container = records.container
      wordcode = records.wordcode
      references = records.references
      functions = records.functions
    }
  }
  const cff = diagnoseNormalizeCffWordcode(container, wordcode, functions)
  if (cff.ok) {
    records = cff.result
    container = records.container
    wordcode = records.wordcode
    references = records.references
    functions = records.functions
  }
  let cfg = records.cfg ?? buildControlFlow(wordcode, references, functions)
  if (
    !cfg &&
    wordcode.instructions.some((instruction) => instruction.name === 'JUMP_REG')
  ) {
    const normalized = diagnoseNormalizeDispatcherWordcode(
      container,
      wordcode,
      functions,
    )
    if (normalized.ok) {
      records = normalized.result
      wordcode = records.wordcode
      references = records.references
      functions = records.functions
      cfg = records.cfg
    }
  }
  cfg = requireValue(
    cfg,
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
