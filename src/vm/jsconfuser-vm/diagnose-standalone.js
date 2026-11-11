import {
  StandaloneDecline,
  decline,
  requireValue,
} from './standalone-contract.js'
import { extractContainerFromSource } from './extract-container.js'
import { diagnoseWordcode, readWordcode } from './read-wordcode.js'
import { diagnoseNormalizeAntiWordcode } from './normalize-anti-wordcode.js'
import { diagnoseNormalizeAliasedWordcode } from './normalize-aliased-wordcode.js'
import { diagnoseNormalizeMacroWordcode } from './normalize-macro-wordcode.js'
import { composePcMaps } from './expand-observed-word-stream.js'
import {
  diagnoseNormalizeAntiSpecializedWordcode,
  diagnoseNormalizeSpecializedWordcode,
} from './normalize-specialized-wordcode.js'
import {
  diagnoseNormalizeSelfModifyingWordcode,
  diagnoseSettleSelfModifyingSuspects,
} from './normalize-self-modifying-wordcode.js'
import { diagnoseNormalizeConcealedConstants } from './normalize-concealed-constants.js'
import { diagnoseNormalizeDispatcherWordcode } from './normalize-dispatcher-wordcode.js'
import { diagnoseNormalizeCffWordcode } from './normalize-cff-wordcode.js'
import { diagnoseNormalizeStringConcealing } from './normalize-string-concealing.js'
import { validateReferences } from './validate-references.js'
import { diagnoseFunctionPartition } from './partition-functions.js'

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

// One decline per record builder, keyed by its component: the generic code and the message the
// public diagnostic carries when that builder returns no record.
const DECLINES = Object.freeze({
  'extract-container': [
    'container-declined',
    'extractContainerFromSource declined the input container',
  ],
  'read-wordcode': [
    'wordcode-declined',
    'readWordcode declined the input wordcode',
  ],
  'validate-references': [
    'references-declined',
    'validateReferences declined the input references',
  ],
  'partition-functions': [
    'functions-declined',
    'partitionFunctions declined the input function partition',
  ],
})

function reconstruct(source) {
  if (typeof source !== 'string')
    decline('invalid-input', 'Standalone decoder input must be a string')
  let container = requireValue(
    extractContainerFromSource(source),
    ...DECLINES['extract-container'],
  )
  let records = {}
  let wordcode = readWordcode(container)
  // Every address the encoder wrote is an origin PC: labels resolve once, after selfModifying, and
  // the runtime patches in place. originPcMap (origin PC -> current PC; null while they coincide)
  // is recomposed after every stage that moves code, from that stage's own pcMap, and resolves
  // those addresses wherever a later stage reads one.
  let originPcMap = null
  const advance = (result) => {
    if (result.pcMap) originPcMap = composePcMaps(originPcMap, result.pcMap)
  }
  const targetOptions = () =>
    originPcMap ? { decodedTargetMap: originPcMap, suspects } : {}
  let originContinuationLoads = null
  // PATCH suspects (origin PCs): fillers selfModifying could not decide while a dispatcher hid
  // labels. Each decoder reads past them; once a stage has recovered the labels, settle reruns the
  // filler rule and the derived records are rebuilt from the settled stream.
  let suspects = []
  let suspectRuns = []
  const recoveredLabels = []
  const settle = () => {
    recoveredLabels.push(...(records.skipLabels ?? []))
    if (suspects.length === 0) return false
    const settled = diagnoseSettleSelfModifyingSuspects(container, wordcode, {
      suspects,
      suspectRuns,
      originPcMap,
      recoveredLabels,
    })
    if (!settled.ok)
      decline(settled.diagnostic.code, settled.diagnostic.message)
    if (!settled.result) return false
    container = settled.result.container
    wordcode = settled.result.wordcode
    advance(settled.result)
    suspects = settled.result.suspects
    suspectRuns = settled.result.suspectRuns
    return true
  }
  if (
    !wordcode &&
    ['unknown-opcode', 'unsupported-hardening-opcode'].includes(
      diagnoseWordcode(container).diagnostic?.code,
    )
  ) {
    const patched = diagnoseNormalizeSelfModifyingWordcode(container, {
      source,
    })
    if (patched.ok) {
      container = patched.result.container
      wordcode = patched.result.wordcode
      originPcMap = patched.result.originPcMap
      originContinuationLoads = patched.result.originContinuationLoads
      suspects = patched.result.suspects
      suspectRuns = patched.result.suspectRuns
    }
  }
  const routeOptions = originPcMap
    ? { originPcMap, originContinuationLoads, suspects }
    : {}
  if (
    !wordcode &&
    diagnoseWordcode(container).diagnostic?.code === 'unknown-opcode'
  ) {
    let normalized = diagnoseNormalizeAliasedWordcode(
      source,
      container,
      routeOptions,
    )
    if (!normalized.ok) {
      normalized = diagnoseNormalizeAliasedWordcode(source, container, {
        ...routeOptions,
        allowObservedPrefix: true,
      })
    }
    if (!normalized.ok) {
      normalized = diagnoseNormalizeMacroWordcode(
        source,
        container,
        routeOptions,
      )
    }
    if (!normalized.ok) {
      normalized = diagnoseNormalizeSpecializedWordcode(
        source,
        container,
        routeOptions,
      )
    }
    if (!normalized.ok) {
      normalized = diagnoseNormalizeAntiSpecializedWordcode(
        source,
        container,
        routeOptions,
      )
    }
    if (!normalized.ok) {
      normalized = diagnoseNormalizeAntiWordcode(
        source,
        container,
        routeOptions,
      )
    }
    if (normalized.ok) {
      records = normalized.result
      container = records.container
      wordcode = records.wordcode
      // A route publishes origin PCs -> its output; an alias projection keeps PCs and passes the
      // incoming map on.
      originPcMap = records.originPcMap ?? originPcMap
      suspects = records.suspects ?? suspects
      if (settle()) records = {}
    }
  }
  wordcode = requireValue(wordcode, ...DECLINES['read-wordcode'])
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
    ...DECLINES['validate-references'],
  )
  // Every multi-parent closure entry is published as a suspect (a shared string helper): the
  // dispatcher and CFF remap it, the string inverse removes the helper, and ordinary partitionFunctions after the
  // string attempt refuses any suspect left.
  const partition = () =>
    requireValue(
      diagnoseFunctionPartition(container, wordcode, references, {
        sharedParentSuspects: true,
      }).result,
      ...DECLINES['partition-functions'],
    )
  let functions = records.functions ?? partition()
  if (
    wordcode.instructions.some((instruction) => instruction.name === 'JUMP_REG')
  ) {
    const prepared = diagnoseNormalizeDispatcherWordcode(
      container,
      wordcode,
      functions,
      targetOptions(),
    )
    if (prepared.ok) {
      records = prepared.result
      advance(records)
      container = records.container
      wordcode = records.wordcode
      references = records.references
      functions = records.functions
      if (settle()) {
        records = {}
        references = requireValue(
          validateReferences(container, wordcode),
          ...DECLINES['validate-references'],
        )
        functions = partition()
      }
    }
  }
  // CFF reports one of three outcomes: no state loop (the stream carries on), recovered, or a loop
  // it read and cannot invert, which is the decode's refusal. A record builder (readWordcode
  // through partitionFunctions) refusing CFF's rewritten words is published as that builder's
  // refusal.
  const cff = diagnoseNormalizeCffWordcode(container, wordcode, functions)
  if (cff.ok) {
    records = cff.result
    advance(records)
    container = records.container
    wordcode = records.wordcode
    references = records.references
    functions = records.functions
  } else if (cff.diagnostic.code !== 'cff-absent') {
    const declined = DECLINES[cff.diagnostic.refusedBy]
    if (declined) decline(...declined)
    decline(
      'cff-declined',
      'Control flow flattening normalization declined the input',
    )
  }
  if (
    wordcode.instructions[0]?.name === 'MAKE_CLOSURE' &&
    wordcode.instructions[1]?.name === 'LOAD_CONST' &&
    wordcode.instructions[2]?.name === 'CALL' &&
    wordcode.instructions[0].functionMeta?.paramCount === 1
  ) {
    const diagnosis = diagnoseNormalizeStringConcealing(
      container,
      wordcode,
      references,
    )
    records = requireValue(
      diagnosis.ok ? diagnosis.result : null,
      'string-concealing-declined',
      'String concealment normalization declined the input',
    )
    advance(records)
    container = records.container
    wordcode = records.wordcode
    references = records.references
    functions = records.functions
  }
  if (functions.sharedParentStarts.length)
    decline(...DECLINES['partition-functions'])
  for (const instruction of wordcode.instructions) {
    if (!SUPPORTED_INSTRUCTIONS.has(instruction.name))
      decline(
        'unsupported-opcode',
        `Standalone emission does not support ${instruction.name}`,
      )
  }
  return {
    constants: references.constants.values,
    functions,
    instructionsByFunction: functionInstructionMap(wordcode, functions),
    wordcode,
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
