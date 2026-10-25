import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseStandaloneInput } from '../../../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { numericToVmSwitch } from '../../../src/vm/jsconfuser-vm/numeric-to-vm-switch.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { solveControl } from '../../../src/vm/switch/vm-switch-control.js'

const repositoryRoot = new URL('../../../', import.meta.url)

function sourceAt(relativePath) {
  return fs.readFileSync(new URL(relativePath, repositoryRoot), 'utf8')
}

function solvedAt(relativePath) {
  const diagnosis = diagnoseStandaloneInput(sourceAt(relativePath))
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  const { model } = diagnosis
  const switchModel = numericToVmSwitch(model)
  return model.functions.functions.map((frame) => {
    const cases = switchModel.instructionsByFunction.get(frame.id)
    return { cases, ...solveControl(frame, cases) }
  })
}

test('solves finally and abrupt routes with finite indirect targets', () => {
  const solved = solvedAt(
    'test/vm/jsconfuser-vm/fixtures/corpus/raw/f-finally-abrupt/encoded.js',
  )
  const edges = solved.flatMap(({ edges }) => edges)
  const counts = {}
  for (const { kind } of edges) counts[kind] = (counts[kind] ?? 0) + 1
  // Each of the 2 catch and 5 finally setups also reaches its active handler; the two protected
  // `===` comparisons cannot throw, so they reach none.
  expect(counts).toEqual({
    branch: 14,
    call: 13,
    conditional: 3,
    fallthrough: 101,
    finally: 22,
    handler: 6,
    return: 5,
    throw: 12,
  })
  expect(
    solved.flatMap(({ functionId, indirectTargets }) =>
      indirectTargets.map(({ pc, sourceRegister, targets }) => ({
        functionId,
        pc,
        sourceRegister,
        targets,
      })),
    ),
  ).toEqual([
    { functionId: 1, pc: 170, sourceRegister: 2, targets: [172, 174] },
    { functionId: 2, pc: 245, sourceRegister: 3, targets: [247, 249] },
    { functionId: 3, pc: 303, sourceRegister: 5, targets: [305] },
    { functionId: 3, pc: 362, sourceRegister: 3, targets: [364, 366] },
    {
      functionId: 4,
      pc: 487,
      sourceRegister: 3,
      targets: [489, 491, 493, 495],
    },
  ])
  for (const { indirectTargets } of solved)
    for (const jump of indirectTargets) {
      const successors = edges.filter(({ sourcePc }) => sourcePc === jump.pc)
      expect(successors).toHaveLength(jump.targets.length)
      expect(
        successors.every(
          ({ kind, mode }) => kind === 'branch' && mode === 'indirect',
        ),
      ).toBe(true)
    }
  const protectedEquals = solved.flatMap(({ cases, stateIn }) =>
    cases.filter(
      ({ pc, operation }) =>
        stateIn.get(pc)?.length &&
        operation.value?.kind === 'binary' &&
        operation.value.operator === '===',
    ),
  )
  expect(protectedEquals).toHaveLength(2)
  for (const { pc } of protectedEquals)
    expect(
      edges.filter(({ sourcePc }) => sourcePc === pc).map(({ kind }) => kind),
    ).toEqual(['fallthrough'])
})

const deadCode = 'test/vm/jsconfuser-vm/fixtures/dead-code/'

// The compiler emits source dead code after a return as instructions no path reaches: here a
// try/catch and a try/finally, whose finalizer ends in its resume JUMP_REG. Unreachable code never
// decides behaviour, so the solver reads past them: no edge, no handler state, no indirect target.
test('reads past a try and a finalizer resume no path reaches', () => {
  const diagnosis = diagnoseStandaloneInput(sourceAt(deadCode + 'encoded.js'))
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  const { model } = diagnosis
  const switchModel = numericToVmSwitch(model)
  const pcsOf = (...names) =>
    model.wordcode.instructions
      .filter(({ name }) => names.includes(name))
      .map(({ pc }) => pc)
  const setups = pcsOf('TRY_SETUP', 'FINALLY_SETUP')
  const resumes = pcsOf('JUMP_REG')
  expect(setups).toHaveLength(2)
  expect(resumes).toHaveLength(1)
  const solved = model.functions.functions.map((frame) =>
    solveControl(frame, switchModel.instructionsByFunction.get(frame.id)),
  )
  const reached = new Set(solved.flatMap(({ reachablePcs }) => reachablePcs))
  const touched = new Set(
    solved.flatMap(({ edges }) =>
      edges.flatMap(({ sourcePc, targetPc }) => [sourcePc, targetPc]),
    ),
  )
  for (const pc of [...setups, ...resumes]) {
    expect(reached.has(pc)).toBe(false)
    expect(touched.has(pc)).toBe(false)
  }
  expect(solved.flatMap(({ indirectTargets }) => indirectTargets)).toEqual([])
})

test('decodes dead code after a return with the source behaviour', () => {
  const observe = (script) => {
    const window = {}
    vm.runInNewContext(script, { window }, { timeout: 1000 })
    return window.TEST_OUTPUT
  }
  const decoded = diagnoseStandalone(sourceAt(deadCode + 'encoded.js'))
  expect(decoded.ok, JSON.stringify(decoded.diagnostic)).toBe(true)
  expect(observe(decoded.result.output)).toEqual(
    observe(sourceAt(deadCode + 'source.js')),
  )
})
