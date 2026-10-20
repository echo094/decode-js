import { indexWordcode } from './wordcode-index.js'
import {
  CFG_SCHEMA,
  EXCEPTION_FINALLY_SCHEMA,
  STRUCTURED_CONTROL_SCHEMA,
  StructuredControlDecline,
  WORDCODE_SCHEMA,
  arrayEqual,
  cloneData,
  deepFreeze,
} from './structured-control-contract.js'
import { edgeKey } from './structured-control-input.js'
import { indexCfg } from './structured-control-cfg.js'
import { indexExceptionFinally } from './structured-control-exceptions.js'

function structuredControl(
  fn,
  edges,
  blockById,
  irreducibleRegions,
  edgeIdsByKey,
) {
  const blocks = [...blockById.values()].sort(
    (left, right) => left.startPc - right.startPc,
  )
  const blockOrder = blocks.map(({ id }) => id)
  if (irreducibleRegions.length) {
    return {
      mode: 'state-machine',
      control: {
        kind: 'state-machine',
        stateVariable: '__jsconfuserVmState',
        entryBlockId: `${fn.id}:b@${fn.startPc}`,
        blockOrder,
        dispatch: blocks.map((block) => ({
          state: block.id,
          blockId: block.id,
          successorEdgeIds: edges
            .filter(({ sourcePc }) => sourcePc === block.instructionPcs.at(-1))
            .map((edge) => edgeIdsByKey.get(edgeKey(edge))),
        })),
        proof: {
          irreducible: cloneData(fn.irreducible),
          exactBlockGraph: true,
          explicitLeaves: true,
        },
      },
    }
  }
  // Statement recovery needs no encoder knowledge, so the shared backend performs it from these
  // blocks and edges (vm-switch-boundary.md, section 1).
  return {
    mode: 'structured',
    control: {
      kind: 'structured',
      blockOrder,
      proof:
        'statement regions are recovered by the shared backend from these blocks and edges',
    },
  }
}

function buildResult(wordcodeData, cfgData, hData) {
  const globalEdges = cfgData.allEdges.map((edge, index) => ({
    id: `e${index}`,
    ...cloneData(edge),
  }))
  const edgeIdsByKey = new Map(
    cfgData.allEdges.map((edge, index) => [edgeKey(edge), `e${index}`]),
  )
  const functionResults = []
  let structuredCount = 0
  let stateMachineCount = 0
  const emittedPcs = []
  for (const fn of cfgData.functions) {
    const blockById = cfgData.functionBlocks.get(fn.id)
    const fnEdges = cfgData.edgesByFunction.get(fn.id)
    const control = structuredControl(
      fn,
      fnEdges,
      blockById,
      cfgData.irreducibleByFunction.get(fn.id),
      edgeIdsByKey,
    )
    if (control.mode === 'structured') structuredCount += 1
    else stateMachineCount += 1
    const states = hData.statesByFunction.get(fn.id)
    const blocks = [...blockById.values()]
      .sort((left, right) => left.startPc - right.startPc)
      .map((block) => {
        const leaves = block.instructionPcs.map((pc) => {
          const instruction = wordcodeData.byPc.get(pc)
          const state = states.get(pc)
          emittedPcs.push(pc)
          return {
            kind: 'opcode',
            ...cloneData(instruction),
            reachable: state.reachable,
            semanticBoundary: 'later-packet',
          }
        })
        return {
          id: block.id,
          functionId: fn.id,
          startPc: block.startPc,
          endPc: block.endPc,
          leaves,
          handlerStateIn: cloneData(block.handlerStateIn),
          successorEdgeIds: fnEdges
            .filter(({ sourcePc }) => sourcePc === block.instructionPcs.at(-1))
            .map((edge) => edgeIdsByKey.get(edgeKey(edge))),
        }
      })
    const instructionCount = blocks.reduce(
      (count, block) => count + block.leaves.length,
      0,
    )
    functionResults.push({
      id: fn.id,
      kind: fn.kind,
      startPc: fn.startPc,
      endPc: fn.endPc,
      parentFunctionId: fn.parentFunctionId,
      regCount: fn.regCount,
      paramCount: fn.paramCount,
      captureCount: fn.captureCount,
      hasRest: fn.hasRest,
      instructionCount,
      blockCount: blocks.length,
      mode: control.mode,
      control: control.control,
      blocks,
    })
  }
  const overallMode =
    stateMachineCount === 0
      ? 'structured'
      : structuredCount === 0
        ? 'state-machine'
        : 'mixed'
  return deepFreeze({
    schemaVersion: STRUCTURED_CONTROL_SCHEMA,
    encoding: 'numeric-u32',
    parseOnly: true,
    targetExecution: false,
    wordCount: wordcodeData.words.length,
    instructionCount: wordcodeData.instructions.length,
    functionCount: functionResults.length,
    mode: overallMode,
    modeCounts: {
      structured: structuredCount,
      stateMachine: stateMachineCount,
    },
    predecessorSchemas: {
      wordcode: WORDCODE_SCHEMA,
      cfg: CFG_SCHEMA,
      exceptionFinally: EXCEPTION_FINALLY_SCHEMA,
    },
    functions: functionResults,
    edges: globalEdges,
    coverage: {
      instructions: {
        expected: wordcodeData.instructions.length,
        emitted: emittedPcs.length,
        unique: new Set(emittedPcs).size === emittedPcs.length,
        complete: arrayEqual(
          [...emittedPcs].sort((left, right) => left - right),
          [...wordcodeData.boundaries].sort((left, right) => left - right),
        ),
      },
      edges: {
        expected: cfgData.allEdges.length,
        emitted: globalEdges.length,
        unique:
          new Set(globalEdges.map(({ id }) => id)).size === globalEdges.length,
        complete: globalEdges.length === cfgData.allEdges.length,
      },
    },
    omissions: {
      targetSemantics:
        'not-emitted; opcode leaves retain exact typed B records',
      callsPropertiesScalarsClosuresCompletion:
        'not-reclassified; owned by later packets',
      exceptionEmission:
        'not-emitted; exact Packet H states and routes are carried',
      sourceReplacement: 'not performed',
      visitorCliIntegration: 'not performed',
      targetExecution: 'not performed',
    },
  })
}

function recognize(wordcode, cfg, exceptionFinally) {
  const wordcodeData = indexWordcode(wordcode)
  const cfgData = indexCfg(cfg)
  const hData = indexExceptionFinally(exceptionFinally)
  return buildResult(wordcodeData, cfgData, hData)
}

export function diagnoseStructuredControl(wordcode, cfg, exceptionFinally) {
  try {
    return deepFreeze({
      ok: true,
      result: recognize(wordcode, cfg, exceptionFinally),
      diagnostic: null,
    })
  } catch (error) {
    return deepFreeze({
      ok: false,
      result: null,
      diagnostic: {
        code:
          error instanceof StructuredControlDecline
            ? error.code
            : 'structured-control-error',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

export function emitStructuredControl(wordcode, cfg, exceptionFinally) {
  return diagnoseStructuredControl(wordcode, cfg, exceptionFinally).result
}

export default emitStructuredControl
