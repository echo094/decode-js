import {
  decline,
  accepted,
  refused,
  requireValue,
  unwrap,
} from './standalone-contract.js'
import { extractContainer } from './extract-container.js'
import { diagnoseWordcode, readWordcode } from './wordcode/read-wordcode.js'
import { diagnoseNormalizeAntiWordcode } from './normalize/normalize-anti-wordcode.js'
import { diagnoseNormalizeAliasedWordcode } from './normalize/normalize-aliased-wordcode.js'
import { diagnoseNormalizeMacroWordcode } from './normalize/normalize-macro-wordcode.js'
import { composePcMaps } from './wordcode/expand-observed-word-stream.js'
import {
  diagnoseNormalizeAntiSpecializedWordcode,
  diagnoseNormalizeSpecializedWordcode,
} from './normalize/normalize-specialized-wordcode.js'
import {
  diagnoseNormalizeSelfModifyingWordcode,
  diagnoseSettleSelfModifyingSuspects,
} from './normalize/normalize-self-modifying-wordcode.js'
import {
  diagnoseNormalizeConcealedConstants,
  hasConcealedConstant,
} from './normalize/normalize-concealed-constants.js'
import { diagnoseNormalizeDispatcherWordcode } from './normalize/normalize-dispatcher-wordcode.js'
import { diagnoseNormalizeCffWordcode } from './normalize/normalize-cff-wordcode.js'
import { diagnoseNormalizeStringConcealing } from './normalize/normalize-string-concealing.js'
import { validateReferences } from './wordcode/validate-references.js'
import { diagnoseFunctionPartition } from './wordcode/partition-functions.js'

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

// One decline per record builder, keyed by its component: the generic code and the message the
// public diagnostic carries when that builder returns no record.
const DECLINES = Object.freeze({
  'extract-container': [
    'container-declined',
    'extractContainer declined the input container',
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

// The read-program codes a PATCH region leaves, and the one an added opcode leaves.
const PATCH_CODES = ['unknown-opcode', 'unsupported-hardening-opcode']

// The added-opcode routes, tried in order until one recovers the stream.
const ADDED_OPCODE_ROUTES = [
  (source, container, options) =>
    diagnoseNormalizeAliasedWordcode(source, container, options),
  (source, container, options) =>
    diagnoseNormalizeAliasedWordcode(source, container, {
      ...options,
      allowObservedPrefix: true,
    }),
  diagnoseNormalizeMacroWordcode,
  diagnoseNormalizeSpecializedWordcode,
  diagnoseNormalizeAntiSpecializedWordcode,
  diagnoseNormalizeAntiWordcode,
]

// The string helper prefix: the program opens by calling a one-parameter closure on a constant.
const opensWithStringHelper = ({ instructions: [closure, load, call] }) =>
  closure?.name === 'MAKE_CLOSURE' &&
  load?.name === 'LOAD_CONST' &&
  call?.name === 'CALL' &&
  closure.functionMeta?.paramCount === 1

/**
 * The frontend's records as its pipeline stages rebuild them. Every address the encoder wrote is an
 * origin PC: labels resolve once, after selfModifying, and the runtime patches in place.
 * `originPcMap` (origin PC -> current PC; null while they coincide) is recomposed after every stage
 * that moves code, from that stage's own pcMap, and resolves those addresses wherever a later stage
 * reads one. `suspects` (origin PCs) are PATCH fillers selfModifying could not decide while a
 * dispatcher hid labels: each decoder reads past them, and once a stage has recovered the labels,
 * `settle` reruns the filler rule and the derived records are rebuilt from the settled stream.
 * `references` and `functions` are null until read-program builds them from the current words.
 */
class Frontend {
  constructor(source) {
    this.source = source
    this.container = requireValue(
      extractContainer(source),
      ...DECLINES['extract-container'],
    )
    this.wordcode = readWordcode(this.container)
    this.references = null
    this.functions = null
    this.records = {}
    this.originPcMap = null
    this.originContinuationLoads = null
    this.suspects = []
    this.suspectRuns = []
    this.recoveredLabels = []
  }

  unreadCode() {
    return this.wordcode
      ? null
      : diagnoseWordcode(this.container).diagnostic?.code
  }

  // A route publishes origin PCs -> its output; an alias projection keeps PCs and passes the
  // incoming map on.
  adoptRoute(records) {
    this.records = records
    this.container = records.container
    this.wordcode = records.wordcode
    this.references = records.references ?? null
    this.functions = records.functions ?? null
    this.originPcMap = records.originPcMap ?? this.originPcMap
    this.suspects = records.suspects ?? this.suspects
  }

  // A rewrite publishes its own pcMap (input PC -> output PC) and, after read-program, the
  // records it rebuilt.
  adoptRewrite(records) {
    this.records = records
    if (records.pcMap)
      this.originPcMap = composePcMaps(this.originPcMap, records.pcMap)
    this.container = records.container
    this.wordcode = records.wordcode
    this.references = records.references ?? null
    this.functions = records.functions ?? null
  }

  // Settles the PATCH suspects once a stage has recovered labels; true when the words changed,
  // which leaves read-program's records to rebuild.
  settle() {
    this.recoveredLabels.push(...(this.records.skipLabels ?? []))
    if (this.suspects.length === 0) return false
    const settled = unwrap(
      diagnoseSettleSelfModifyingSuspects(this.container, this.wordcode, {
        suspects: this.suspects,
        suspectRuns: this.suspectRuns,
        originPcMap: this.originPcMap,
        recoveredLabels: this.recoveredLabels,
      }),
    )
    if (!settled) return false
    this.adoptRewrite(settled)
    this.records = {}
    this.suspects = settled.suspects
    this.suspectRuns = settled.suspectRuns
    return true
  }

  recoverPatch() {
    if (!PATCH_CODES.includes(this.unreadCode())) return
    const patched = diagnoseNormalizeSelfModifyingWordcode(this.container, {
      source: this.source,
    })
    if (!patched.ok) return
    this.adoptRoute(patched.result)
    this.records = {}
    this.originContinuationLoads = patched.result.originContinuationLoads
    this.suspectRuns = patched.result.suspectRuns
  }

  recoverAddedOpcodes() {
    if (this.unreadCode() !== 'unknown-opcode') return
    const options = this.originPcMap
      ? {
          originPcMap: this.originPcMap,
          originContinuationLoads: this.originContinuationLoads,
          suspects: this.suspects,
        }
      : {}
    for (const route of ADDED_OPCODE_ROUTES) {
      const normalized = route(this.source, this.container, options)
      if (!normalized.ok) continue
      this.adoptRoute(normalized.result)
      this.settle()
      return
    }
  }

  recoverConstants() {
    this.wordcode = requireValue(this.wordcode, ...DECLINES['read-wordcode'])
    if (!hasConcealedConstant(this.wordcode)) return
    const diagnosis = diagnoseNormalizeConcealedConstants(
      this.source,
      this.container,
      this.wordcode,
    )
    this.adoptRewrite(
      requireValue(
        diagnosis.ok ? diagnosis.result : null,
        'concealed-constants-declined',
        'Concealed constant normalization declined the input',
      ),
    )
  }

  // Every multi-parent closure entry is published as a suspect (a shared string helper): the
  // dispatcher and CFF remap it, the string inverse removes the helper, and the check before
  // lowering refuses any suspect left.
  readProgram() {
    if (!this.references)
      this.references = requireValue(
        validateReferences(this.container, this.wordcode),
        ...DECLINES['validate-references'],
      )
    if (!this.functions) {
      const partition = diagnoseFunctionPartition(
        this.container,
        this.wordcode,
        this.references,
        { sharedParentSuspects: true },
      )
      this.functions = requireValue(
        partition.result,
        ...DECLINES['partition-functions'],
      )
    }
  }

  recoverDispatcher() {
    if (!this.wordcode.instructions.some(({ name }) => name === 'JUMP_REG'))
      return
    const prepared = diagnoseNormalizeDispatcherWordcode(
      this.container,
      this.wordcode,
      this.functions,
      this.originPcMap
        ? { decodedTargetMap: this.originPcMap, suspects: this.suspects }
        : {},
    )
    if (!prepared.ok) return
    this.adoptRewrite(prepared.result)
    if (this.settle()) this.readProgram()
  }

  // CFF reports one of three outcomes: no state loop (the stream carries on), recovered, or a loop
  // it read and cannot invert, which is the decode's refusal. A record builder (readWordcode
  // through partitionFunctions) refusing CFF's rewritten words is published as that builder's
  // refusal.
  recoverCff() {
    const cff = diagnoseNormalizeCffWordcode(
      this.container,
      this.wordcode,
      this.functions,
    )
    if (cff.ok) return this.adoptRewrite(cff.result)
    if (cff.diagnostic.code === 'cff-absent') return
    const declined = DECLINES[cff.diagnostic.refusedBy]
    if (declined) decline(...declined)
    decline(
      'cff-declined',
      'Control flow flattening normalization declined the input',
    )
  }

  recoverStrings() {
    if (!opensWithStringHelper(this.wordcode)) return
    const diagnosis = diagnoseNormalizeStringConcealing(
      this.container,
      this.wordcode,
      this.references,
    )
    this.adoptRewrite(
      requireValue(
        diagnosis.ok ? diagnosis.result : null,
        'string-concealing-declined',
        'String concealment normalization declined the input',
      ),
    )
  }

  // The gate before lowering: no shared-parent suspect left and every opcode supported.
  model() {
    if (this.functions.sharedParentStarts.length)
      decline(...DECLINES['partition-functions'])
    for (const { name } of this.wordcode.instructions) {
      if (!SUPPORTED_INSTRUCTIONS.has(name))
        decline(
          'unsupported-opcode',
          `Standalone emission does not support ${name}`,
        )
    }
    const byPc = new Map(
      this.wordcode.instructions.map((instruction) => [
        instruction.pc,
        instruction,
      ]),
    )
    return {
      constants: this.references.constants.values,
      functions: this.functions,
      instructionsByFunction: new Map(
        this.functions.functions.map(({ id, instructionPcs }) => [
          id,
          instructionPcs.map((pc) => byPc.get(pc)),
        ]),
      ),
      wordcode: this.wordcode,
    }
  }
}

// The frontend pipeline in its stage order (the jsconfuser-vm pipeline map): admit-container and
// read-wordcode, then each recovery stage when its shape is present, rebuilding read-program after
// the words change, then the gate before lowering.
function reconstruct(source) {
  if (typeof source !== 'string')
    decline('invalid-input', 'Standalone decoder input must be a string')
  const frontend = new Frontend(source)
  frontend.recoverPatch()
  frontend.recoverAddedOpcodes()
  frontend.recoverConstants()
  frontend.readProgram()
  frontend.recoverDispatcher()
  frontend.recoverCff()
  frontend.recoverStrings()
  return frontend.model()
}

export function diagnoseStandaloneInput(source) {
  try {
    return accepted(reconstruct(source))
  } catch (error) {
    return refused(error)
  }
}
