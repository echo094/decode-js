import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { diagnoseStandaloneInput } from '../../../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { numericToVmSwitch } from '../../../src/vm/jsconfuser-vm/numeric-to-vm-switch.js'
import normalizeVmInput from '../../../src/visitor/jsconfuser-vm/normalize-source.js'
import { planStatements } from '../../../src/vm/switch/vm-switch-statements.js'
import { emitVmSwitchProgram } from '../../../src/vm/switch/vm-switch-to-source.js'

// The numeric frontend supplies the model; these tests read the regions the shared backend
// plans for it.
function planned(relativePath) {
  const diagnosis = diagnoseStandalone(
    fs.readFileSync(
      new URL(`../jsconfuser-vm/fixtures/${relativePath}`, import.meta.url),
      'utf8',
    ),
  )
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  const { control, statements } = diagnosis.result
  return {
    regions: statements.flatMap(({ regions }) => regions),
    edgesById: new Map(control.edges.map((edge) => [edge.id, edge])),
    blockIds: new Set(
      control.functions.flatMap(({ blocks }) => blocks.map(({ id }) => id)),
    ),
  }
}

test('plans one linear region for straight-line control', () => {
  const { regions, blockIds } = planned('reference/encoded.js')
  expect(regions).toHaveLength(1)
  expect(regions[0].kind).toBe('linear')
  expect(regions[0].blockIds).toHaveLength(blockIds.size)
})

test('plans a conditional with its merge and condition', () => {
  const { regions, edgesById, blockIds } = planned(
    'corpus/raw/f-branching/encoded.js',
  )
  const conditional = regions.find(({ kind }) => kind === 'conditional')
  expect(conditional).toBeDefined()
  expect(conditional.proof).toContain('first block both arms reach')
  expect(edgesById.get(conditional.branchEdgeId)).toMatchObject({
    kind: 'conditional',
    targetPc: conditional.branchTargetPc,
    condition: conditional.condition,
  })
  expect(edgesById.get(conditional.fallthroughEdgeId)).toMatchObject({
    kind: 'fallthrough',
    targetPc: conditional.fallthroughTargetPc,
  })
  expect(conditional.mergeBlockId).toMatch(/^0:b@\d+$/)
  expect(blockIds.has(conditional.mergeBlockId)).toBe(true)
})

test('plans natural loops only with a validated header, back-edge, and exit', () => {
  const { regions, edgesById } = planned('corpus/raw/f-loop-forms/encoded.js')
  const loops = regions.filter(({ kind }) => kind === 'natural-loop')
  expect(loops.length).toBeGreaterThan(0)
  for (const loop of loops) {
    expect(loop.proof).toContain('header dominates')
    expect(loop.bodyBlockIds).toContain(loop.headerBlockId)
    expect(loop.backEdgeIds.length).toBeGreaterThan(0)
    expect(loop.exitEdgeIds.length).toBeGreaterThan(0)
    for (const edgeId of [...loop.backEdgeIds, ...loop.exitEdgeIds])
      expect(edgesById.has(edgeId)).toBe(true)
  }
})

// One function per way a statement can end inside a function (fixtures/vm-switch-statements/exits).
// Functions 1-8 follow the source's declaration order; the planned rows pin the decisions and the
// output pins the readable form: one labeled loop per source loop, a guard without `else`.
const exitsDirectory = new URL(
  './fixtures/vm-switch-statements/exits/forms/',
  import.meta.url,
)
const exitsLoops = { 1: 1, 2: 1, 3: 2, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0 }

function functionOutput(output, functionId) {
  const start = output.indexOf(`function __recovered_function_${functionId}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = output.indexOf('\n  function __recovered_function_', start + 1)
  return output.slice(start, next === -1 ? output.length : next)
}

function observe(code) {
  const window = {}
  vm.runInNewContext(
    code,
    { window, performance: { now: () => 0 } },
    { timeout: 5000 },
  )
  return JSON.stringify(window.TEST_OUTPUT)
}

test('recovers every way a statement ends inside a function in its source form', () => {
  const source = fs.readFileSync(new URL('source.js', exitsDirectory), 'utf8')
  const diagnosis = diagnoseStandalone(
    fs.readFileSync(new URL('encoded.js', exitsDirectory), 'utf8'),
  )
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  const { output, control } = diagnosis.result
  expect(control.functions.every(({ mode }) => mode === 'structured')).toBe(
    true,
  )
  expect(output).not.toContain('__recovered_dispatch')
  expect(observe(output)).toBe(observe(source))
  for (const [id, loops] of Object.entries(exitsLoops))
    expect(
      functionOutput(output, id).match(/: while \(true\) \{/g)?.length ?? 0,
      `function ${id}`,
    ).toBe(loops)
  expect(functionOutput(output, 7)).not.toContain('else')
  expect(functionOutput(output, 8)).toContain('} else {')
})

// The planner is called directly on the frontend's model, so these rows are read even while
// emission declines.
test('plans a continuation for every loop and merges a guard at its branch target', () => {
  const preflight = diagnoseStandaloneInput(
    normalizeVmInput(
      fs.readFileSync(new URL('encoded.js', exitsDirectory), 'utf8'),
    ),
  )
  expect(preflight.ok, JSON.stringify(preflight.diagnostic)).toBe(true)
  const model = numericToVmSwitch(preflight.model)
  const planned = new Map(
    model.functions.functions.map((functionRecord) => [
      functionRecord.id,
      planStatements(
        functionRecord,
        model.controlByFunction.get(functionRecord.id),
        model.structuredControl.edges.filter(
          ({ functionId }) => functionId === functionRecord.id,
        ),
      ),
    ]),
  )
  const loops = [...planned.values()]
    .flat()
    .filter(({ kind }) => kind === 'natural-loop')
  // Seven in the forms and two in the script's driver.
  expect(loops).toHaveLength(9)
  for (const loop of loops)
    expect(loop.continuationBlockId, loop.headerBlockId).not.toBeNull()
  const guard = planned.get(7).find(({ kind }) => kind === 'conditional')
  expect(guard.mergeBlockId).toBe(`7:b@${guard.branchTargetPc}`)
})

// One function per loop whose test is a compound condition (fixtures/vm-switch-statements/
// loop-tests): the short-circuit branches inside the test close before the branch that leaves the
// loop, so each loop still has its own end and one labeled loop per source loop.
const loopTestsDirectory = new URL(
  './fixtures/vm-switch-statements/loop-tests/forms/',
  import.meta.url,
)

test('closes loops whose test is a compound condition', () => {
  const encoded = fs.readFileSync(
    new URL('encoded.js', loopTestsDirectory),
    'utf8',
  )
  const preflight = diagnoseStandaloneInput(normalizeVmInput(encoded))
  expect(preflight.ok, JSON.stringify(preflight.diagnostic)).toBe(true)
  const model = numericToVmSwitch(preflight.model)
  const loops = model.functions.functions
    .flatMap((functionRecord) =>
      planStatements(
        functionRecord,
        model.controlByFunction.get(functionRecord.id),
        model.structuredControl.edges.filter(
          ({ functionId }) => functionId === functionRecord.id,
        ),
      ),
    )
    .filter(({ kind }) => kind === 'natural-loop')
  expect(loops).toHaveLength(7)
  for (const loop of loops)
    expect(loop.continuationBlockId, loop.headerBlockId).not.toBeNull()

  const diagnosis = diagnoseStandalone(encoded)
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  const { output } = diagnosis.result
  expect(output).not.toContain('__recovered_dispatch')
  const source = fs.readFileSync(
    new URL('source.js', loopTestsDirectory),
    'utf8',
  )
  expect(observe(output)).toBe(observe(source))
  for (const [id, count] of Object.entries({
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 2,
  }))
    expect(
      functionOutput(output, id).match(/: while \(true\) \{/g)?.length ?? 0,
      `function ${id}`,
    ).toBe(count)
})

// One function per way a try statement ends (fixtures/vm-switch-statements/try-ends); functions
// 2-7 follow the source's order. A try ends where its normal exit tail leads, or nowhere when its
// block never completes normally: then the catch keeps the code only it reaches. A continue routed
// through a finally ends at the loop's update (function 7): the try ends at the code after it, and
// the loop is written as a for whose update clause the native continue runs; an update that
// branches (function 8) is one clause too, its conditional written as a conditional expression.
const tryEndsDirectory = new URL(
  './fixtures/vm-switch-statements/try-ends/forms/',
  import.meta.url,
)

test('plans where every try statement ends and recovers it in its source form', () => {
  const encoded = fs.readFileSync(
    new URL('encoded.js', tryEndsDirectory),
    'utf8',
  )
  const preflight = diagnoseStandaloneInput(normalizeVmInput(encoded))
  expect(preflight.ok, JSON.stringify(preflight.diagnostic)).toBe(true)
  const model = numericToVmSwitch(preflight.model)
  const plans = new Map(
    model.functions.functions.map((functionRecord) => [
      functionRecord.id,
      planStatements(
        functionRecord,
        model.controlByFunction.get(functionRecord.id),
        model.structuredControl.edges.filter(
          ({ functionId }) => functionId === functionRecord.id,
        ),
      ),
    ]),
  )
  const tries = new Map(
    [...plans].map(([id, regions]) => [
      id,
      regions.filter(({ kind }) => kind === 'try'),
    ]),
  )
  const loopOf = (id) =>
    plans.get(id).find(({ kind }) => kind === 'natural-loop')
  const ends = {
    2: true,
    3: false,
    4: true,
    5: false,
    6: true,
    7: true,
    8: true,
  }
  for (const [id, ending] of Object.entries(ends)) {
    expect(tries.get(Number(id)), `function ${id}`).toHaveLength(1)
    expect(
      tries.get(Number(id))[0].continuationBlockId !== null,
      `function ${id}`,
    ).toBe(ending)
  }
  // The break in function 6 leaves the loop; only function 7's continue enters the update.
  expect(loopOf(6).continueBlockId).toBeNull()
  const loop = loopOf(7)
  const [routed] = tries.get(7)
  expect(loop.bodyBlockIds).toContain(loop.continueBlockId)
  expect(loop.updateBlockIds[0]).toBe(loop.continueBlockId)
  expect(routed.continuationBlockId).not.toBe(loop.continueBlockId)
  for (const id of loop.updateBlockIds)
    expect(routed.memberBlockIds).not.toContain(id)
  // Function 8's continue enters its update before the update's own branch.
  const branching = loopOf(8)
  const [branchingTry] = tries.get(8)
  expect(branching.updateBlockIds[0]).toBe(branching.continueBlockId)
  expect(
    plans
      .get(8)
      .some(
        ({ kind, testBlockId }) =>
          kind === 'conditional' &&
          branching.updateBlockIds.includes(testBlockId),
      ),
  ).toBe(true)
  for (const id of branching.updateBlockIds)
    expect(branchingTry.memberBlockIds).not.toContain(id)

  const diagnosis = diagnoseStandalone(encoded)
  expect(diagnosis.ok, JSON.stringify(diagnosis.diagnostic)).toBe(true)
  const { output } = diagnosis.result
  expect(output).not.toContain('__recovered_dispatch')
  const source = fs.readFileSync(new URL('source.js', tryEndsDirectory), 'utf8')
  expect(observe(output)).toBe(observe(source))
  for (const id of Object.keys(ends)) {
    const text = functionOutput(output, id)
    expect(text.match(/\btry \{/g), `function ${id}`).toHaveLength(1)
    expect(
      text.match(/: while \(true\) \{/g)?.length ?? 0,
      `function ${id}`,
    ).toBe(id === '6' ? 1 : 0)
    expect(text.match(/: for \(; ; /g)?.length ?? 0, `function ${id}`).toBe(
      id === '7' || id === '8' ? 1 : 0,
    )
  }
  // Function 3's block always throws: no reachable end, but the frontend's layout end (the dead
  // TRY_END; JUMP the compiler places before the catch) closes the catch where the source does.
  const [alwaysThrows] = tries.get(3)
  expect(alwaysThrows.continuationBlockId).toBeNull()
  expect(alwaysThrows.layoutEndBlockId).toMatch(/^3:b@\d+$/)
  expect(alwaysThrows.memberBlockIds).not.toContain(
    alwaysThrows.layoutEndBlockId,
  )
  const throwsText = functionOutput(output, 3)
  expect(
    throwsText.slice(
      throwsText.indexOf('} catch ('),
      throwsText.indexOf('"after"'),
    ),
  ).toMatch(/\n {4}\}\n/)
  // Without the hint the catch keeps the code only it reaches, with the same behaviour.
  for (const cases of model.instructionsByFunction.values())
    for (const { operation } of cases) delete operation.layoutEnd
  const unhinted = emitVmSwitchProgram(model).output
  expect(observe(unhinted)).toBe(observe(source))
  const nestedText = functionOutput(unhinted, 3)
  expect(
    nestedText.slice(
      nestedText.indexOf('} catch ('),
      nestedText.indexOf('"after"'),
    ),
  ).not.toMatch(/\n {4}\}\n/)
  for (const id of [7, 8]) {
    const routedText = functionOutput(output, id)
    expect(
      routedText.slice(
        routedText.indexOf('try {'),
        routedText.indexOf('} finally {'),
      ),
      `function ${id}`,
    ).toMatch(/\bcontinue __recovered_loop_/)
  }
  expect(functionOutput(output, 8)).toMatch(/: for \(; ; [^\n]* \? \(/)

  // A do-while's continue enters its test, so the test is the continue target and the loop reads
  // `do { … } while (test)`, whose native continue runs the test.
  const doWhile = fs.readFileSync(
    new URL('../dowhile-continue/encoded.js', tryEndsDirectory),
    'utf8',
  )
  const doWhileModel = numericToVmSwitch(
    diagnoseStandaloneInput(normalizeVmInput(doWhile)).model,
  )
  const doWhileFunction = doWhileModel.functions.functions.find(
    ({ id }) => id === 2,
  )
  const doWhileRegions = planStatements(
    doWhileFunction,
    doWhileModel.controlByFunction.get(2),
    doWhileModel.structuredControl.edges.filter(
      ({ functionId }) => functionId === 2,
    ),
  )
  const doWhileLoop = doWhileRegions.find(({ kind }) => kind === 'natural-loop')
  const [doWhileTry] = doWhileRegions.filter(({ kind }) => kind === 'try')
  expect(doWhileLoop.updateBlockIds).toBeNull()
  expect(doWhileLoop.testBlockIds[0]).toBe(doWhileLoop.continueBlockId)
  expect(doWhileTry.continuationBlockId).not.toBeNull()
  for (const id of doWhileLoop.testBlockIds)
    expect(doWhileTry.memberBlockIds).not.toContain(id)
  const recovered = diagnoseStandalone(doWhile)
  expect(recovered.ok, JSON.stringify(recovered.diagnostic)).toBe(true)
  expect(observe(recovered.result.output)).toBe(
    observe(
      fs.readFileSync(
        new URL('../dowhile-continue/source.js', tryEndsDirectory),
        'utf8',
      ),
    ),
  )
  const doWhileText = functionOutput(recovered.result.output, 2)
  expect(doWhileText).toMatch(/: do \{/)
  expect(doWhileText).toMatch(/\} while \(\(/)
  expect(
    doWhileText.slice(
      doWhileText.indexOf('try {'),
      doWhileText.indexOf('} finally {'),
    ),
  ).toMatch(/\bcontinue __recovered_loop_/)

  // Control flow flattening shuffles the blocks: a try's normal exit can fall through into the
  // code after it, with its catch placed elsewhere. The try still ends where its body and its
  // catch rejoin, and every function reads as the plain cell does.
  const flattened = fs.readFileSync(
    new URL('../forms-cff/encoded.js', tryEndsDirectory),
    'utf8',
  )
  const flattenedModel = numericToVmSwitch(
    diagnoseStandaloneInput(normalizeVmInput(flattened)).model,
  )
  for (const [id, ending] of Object.entries(ends)) {
    const functionRecord = flattenedModel.functions.functions.find(
      (item) => item.id === Number(id),
    )
    const flattenedTries = planStatements(
      functionRecord,
      flattenedModel.controlByFunction.get(Number(id)),
      flattenedModel.structuredControl.edges.filter(
        ({ functionId }) => functionId === Number(id),
      ),
    ).filter(({ kind }) => kind === 'try')
    expect(flattenedTries, `function ${id}`).toHaveLength(1)
    expect(
      flattenedTries[0].continuationBlockId !== null,
      `function ${id}`,
    ).toBe(ending)
  }
  const flattenedDiagnosis = diagnoseStandalone(flattened)
  expect(
    flattenedDiagnosis.ok,
    JSON.stringify(flattenedDiagnosis.diagnostic),
  ).toBe(true)
  const flattenedOutput = flattenedDiagnosis.result.output
  expect(flattenedOutput).not.toContain('__recovered_dispatch')
  expect(observe(flattenedOutput)).toBe(observe(source))
  for (const id of Object.keys(ends)) {
    const text = functionOutput(flattenedOutput, id)
    const plain = functionOutput(output, id)
    expect(text.match(/\btry \{/g), `function ${id}`).toHaveLength(1)
    for (const loop of [/: while \(true\) \{/g, /: for \(; ; /g])
      expect(text.match(loop)?.length ?? 0, `function ${id}`).toBe(
        plain.match(loop)?.length ?? 0,
      )
  }
})
