import os from 'node:os'
import { beforeAll, describe, expect, test } from 'vitest'
import { inspectCurrent } from '../../../../scripts/qualify-jsconfuser-vm/oracles.mjs'
import { diagnoseContainer } from '../../../../src/vm/jsconfuser-vm/extract-container.js'
import { diagnoseNormalizeAliasedWordcode } from '../../../../src/vm/jsconfuser-vm/normalize-aliased-wordcode.js'
import { diagnoseNormalizeAntiWordcode } from '../../../../src/vm/jsconfuser-vm/normalize-anti-wordcode.js'
import { diagnoseNormalizeConcealedConstants } from '../../../../src/vm/jsconfuser-vm/normalize-concealed-constants.js'
import { diagnoseNormalizeCffWordcode } from '../../../../src/vm/jsconfuser-vm/normalize-cff-wordcode.js'
import { diagnoseNormalizeDispatcherWordcode } from '../../../../src/vm/jsconfuser-vm/normalize-dispatcher-wordcode.js'
import { diagnoseNormalizeMacroWordcode } from '../../../../src/vm/jsconfuser-vm/normalize-macro-wordcode.js'
import { diagnoseNormalizeSelfModifyingWordcode } from '../../../../src/vm/jsconfuser-vm/normalize-self-modifying-wordcode.js'
import { diagnoseNormalizeSpecializedWordcode } from '../../../../src/vm/jsconfuser-vm/normalize-specialized-wordcode.js'
import { diagnoseNormalizeStringConcealing } from '../../../../src/vm/jsconfuser-vm/normalize-string-concealing.js'
import { diagnoseFunctionPartition } from '../../../../src/vm/jsconfuser-vm/partition-functions.js'
import { readWordcode } from '../../../../src/vm/jsconfuser-vm/read-wordcode.js'
import { validateReferences } from '../../../../src/vm/jsconfuser-vm/validate-references.js'
import { expectedBehavior, runOracle } from './oracle-runner.js'
import { formIndicators } from './readability-metrics.js'
import {
  expandCells,
  freshSeeds,
  generateMissing,
  suites,
  plainCell,
  readCell,
  writeResult,
} from './cells.js'

// Every suite cell is encoded by the pinned encoder into the ignored cache, then
// decoded by the public adapter. The oracle is the source's own behaviour in the
// browser-like host (and the committed expectation where an oracle.json has one).
// VM_CELLS=<regexp> restricts a local run to the matching cell ids.
// Vitest runs test files in parallel and one file in order, so a suite has its own folder
// (generated-cells/<suite>/), a large suite several files, and each file takes its share of the
// generation workers.
const filter = process.env.VM_CELLS ? new RegExp(process.env.VM_CELLS) : null
const generators = Math.max(
  1,
  Math.floor((os.availableParallelism() - 1) / suites.length),
)

// An interpreter rewrite leaves the program alone, so its decode equals the plain one.
const samePlainDecode = /^interpreter-rewrite-/

const accepted = (diagnosis) => {
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  return diagnosis.result
}

const routes = (container) => {
  const wordcode = readWordcode(container)
  const references = validateReferences(container, wordcode)
  const functions = accepted(
    diagnoseFunctionPartition(container, wordcode, references, {
      sharedParentSuspects: true,
    }),
  )
  return { wordcode, references, functions }
}

// A stage that only re-spells instructions leaves the stage-free program. Macro handlers change
// the encoder's register allocation, so a macro cell compares names and direct targets.
const exactProgram = ({ instructions }) =>
  instructions.map(({ name, words }) => [name, ...words.slice(1)])
const programShape = ({ instructions }) =>
  instructions.map(({ name, wordOperands = [] }) => [
    name,
    ...wordOperands
      .filter(({ kind }) => kind === 'label-target')
      .map(({ pc }) => pc),
  ])
const plainWordcode = (cell) =>
  readWordcode(accepted(diagnoseContainer(readCell(plainCell(cell)).encoded)))

// Each stage's decoder step, called on its own input, and what it must leave. A failure here names
// the step; the whole decode is checked by its own test.
const stageSteps = {
  'string-concealing'(encoded, container) {
    const { wordcode, references } = routes(container)
    const result = accepted(
      diagnoseNormalizeStringConcealing(container, wordcode, references),
    )
    const [inflate, bank] = result.wordcode.instructions
    expect(
      inflate.name === 'MAKE_CLOSURE' &&
        inflate.functionMeta.paramCount === 1 &&
        bank.name === 'LOAD_CONST',
    ).toBe(false)
  },
  'control-flow-flattening'(encoded, container) {
    const { wordcode, functions } = routes(container)
    const result = accepted(
      diagnoseNormalizeCffWordcode(container, wordcode, functions),
    )
    expect(
      diagnoseNormalizeCffWordcode(
        result.container,
        result.wordcode,
        result.functions,
      ).diagnostic?.code,
    ).toBe('cff-absent')
  },
  dispatcher(encoded, container) {
    const { wordcode, functions } = routes(container)
    const result = accepted(
      diagnoseNormalizeDispatcherWordcode(container, wordcode, functions, {}),
    )
    expect(
      diagnoseNormalizeDispatcherWordcode(
        result.container,
        result.wordcode,
        result.functions,
        {},
      ).diagnostic?.code,
    ).toBe('no-dispatcher')
  },
  'conceal-constants'(encoded, container) {
    const result = accepted(
      diagnoseNormalizeConcealedConstants(
        encoded,
        container,
        readWordcode(container),
      ),
    )
    expect(result.concealedPoolEntries).toBeGreaterThan(0)
    expect(
      result.wordcode.instructions
        .flatMap(({ operands }) => operands)
        .filter(
          ({ kind, concealKey }) => kind === 'constant-ref' && concealKey,
        ),
    ).toEqual([])
  },
  'anti-instrumentation'(encoded, container) {
    const result = accepted(diagnoseNormalizeAntiWordcode(encoded, container))
    expect(result.syntheticInstructionCount).toBeGreaterThan(0)
    expect(readWordcode(result.container)).toBeTruthy()
  },
  'specialized-opcodes'(encoded, container, cell) {
    const result = accepted(
      diagnoseNormalizeSpecializedWordcode(encoded, container),
    )
    expect(result.specializedInstructionCount).toBeGreaterThan(0)
    expect(exactProgram(result.wordcode)).toEqual(
      exactProgram(plainWordcode(cell)),
    )
  },
  'macro-opcodes'(encoded, container, cell) {
    const result = accepted(diagnoseNormalizeMacroWordcode(encoded, container))
    expect(result.macroInstructionCount).toBeGreaterThan(0)
    expect(programShape(result.wordcode)).toEqual(
      programShape(plainWordcode(cell)),
    )
  },
  'aliased-opcodes'(encoded, container, cell) {
    const result = accepted(
      diagnoseNormalizeAliasedWordcode(encoded, container),
    )
    expect(result.aliasedInstructionCount).toBeGreaterThan(0)
    expect(exactProgram(result.wordcode)).toEqual(
      exactProgram(plainWordcode(cell)),
    )
  },
  'self-modifying'(encoded, container) {
    const result = accepted(
      diagnoseNormalizeSelfModifyingWordcode(container, { source: encoded }),
    )
    expect(
      result.wordcode.instructions.filter(({ name }) => name === 'PATCH'),
    ).toEqual([])
  },
}

export function defineCellTests(about, file) {
  const suite = about.name
  const cells = expandCells(freshSeeds()).filter(
    (cell) =>
      cell.suite === suite &&
      cell.file === file &&
      (!filter || filter.test(cell.id)),
  )
  // A file without a test is an error, and VM_CELLS can leave this source without a cell.
  if (!cells.length) {
    test.skip(`${suite}/${file}: no cell selected`, () => {})
    return
  }

  beforeAll(async () => {
    await generateMissing(
      samePlainDecode.test(suite) || suite === 'single-payload-stage'
        ? [...cells, ...cells.map(plainCell)]
        : cells,
      generators,
    )
  }, 3600000)

  const protects = (cell) => about.cases?.[cell.name] ?? about.protects
  describe.each(cells.map((cell) => [cell.id, cell]))('%s', (id, cell) => {
    if (suite === 'single-payload-stage')
      test(`the ${file} decoder step removes its stage`, () => {
        const { encoded } = readCell(cell)
        stageSteps[file](encoded, accepted(diagnoseContainer(encoded)), cell)
      })
    test(`decodes with the source behaviour: ${protects(cell)}`, () => {
      const { record, encoded } = readCell(cell)
      expect(record.generation, record.error ?? '').toBe('ok')
      const inspected = inspectCurrent(encoded)
      const { publicRecord } = inspected
      const result = {
        cell: id,
        seed: cell.seed,
        fresh: cell.fresh,
        ok: publicRecord.ok,
        // The public decline names the component that refused; firstBoundary is the
        // first raw reader to refuse, which for PATCH input is read-wordcode before
        // the self-modifying normalizer runs.
        diagnostic: publicRecord.diagnostic
          ? {
              code: publicRecord.diagnostic.code,
              message: publicRecord.diagnostic.message,
            }
          : null,
        firstBoundary: inspected.firstBoundary
          ? {
              refusedBy: inspected.firstBoundary.refusedBy,
              code: inspected.firstBoundary.diagnostic?.code ?? null,
              message: inspected.firstBoundary.diagnostic?.message ?? null,
            }
          : null,
        checks: { ...inspected.checks, sourceRoles: undefined },
        inputState: inspected.inputState,
        opcodes: inspected.analysis.ok
          ? [
              ...new Set(
                inspected.analysis.model.wordcode.instructions.map(
                  ({ name }) => name,
                ),
              ),
            ].sort()
          : null,
        bytes: {
          source: cell.source.length,
          encoded: encoded.length,
          decoded: publicRecord.ok ? publicRecord.output.length : null,
        },
      }
      if (cell.expect !== 'accepted') {
        writeResult(cell, result, null)
        expect(publicRecord.ok).toBe(false)
        expect(publicRecord.diagnostic.code).toBe(cell.expect.code)
        expect(publicRecord.output).toBe(encoded)
        return
      }
      const host = { browser: true }
      const behaviour = {
        source: runOracle(cell.source, cell.oracle, host),
        encoded: runOracle(encoded, cell.oracle, host),
        decoded: publicRecord.ok
          ? runOracle(publicRecord.output, cell.oracle, host)
          : null,
      }
      result.behaviour = behaviour
      writeResult(cell, result, publicRecord.ok ? publicRecord.output : null)
      expect(publicRecord.ok, JSON.stringify(result.diagnostic)).toBe(true)
      expect(inspected.checks.ok, JSON.stringify(inspected.checks)).toBe(true)
      expect(inspected.inputState).toBe(true)
      if (Object.hasOwn(cell.oracle, 'expected'))
        expect(behaviour.source).toEqual(expectedBehavior(cell.oracle))
      expect(behaviour.encoded).toEqual(behaviour.source)
      expect(behaviour.decoded).toEqual(behaviour.source)
      if (samePlainDecode.test(suite))
        expect(publicRecord.output).toBe(
          inspectCurrent(readCell(plainCell(cell)).encoded).publicRecord.output,
        )
    })
    // A suite names the form indicators a source's decode must share with the source (M1, M2).
    const indicators = about.indicators?.[cell.name]
    if (indicators)
      test(`reads as its source: ${indicators.join(', ')}`, () => {
        const { publicRecord } = inspectCurrent(readCell(cell).encoded)
        expect(publicRecord.ok, JSON.stringify(publicRecord.diagnostic)).toBe(
          true,
        )
        const pick = (code) => {
          const found = formIndicators(code)
          return Object.fromEntries(
            indicators.map((name) => [name, found[name]]),
          )
        }
        expect(pick(publicRecord.output)).toEqual(pick(cell.source))
      })
  })
}
