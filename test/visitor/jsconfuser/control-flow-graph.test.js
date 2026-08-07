import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import controlFlow from '#visitor/jsconfuser/control-flow-graph.js'

// These functions consume a NodePath directly (they resolve values, they don't
// transform code), so there's no generated-code fixture to compare against - just find
// the first path matching `matcher` in `code` and hand it to the function under test.
function firstPath(code, matcher) {
  const ast = parse(code)
  let found
  traverse(ast, {
    enter(path) {
      if (!found && matcher(path)) {
        found = path
        path.stop()
      }
    },
  })
  return found
}

// The `_cff_slice` helper and the `_cff_sequence` array it reads are resolved from the
// spread's own callee binding, never from a name - `renameVariables` scrambles every
// `_cff_*` suffix away, and a name-keyed lookup then failed the whole CFF decode closed.
const SLICE_PROGRAM = (sliceName, seqName) => `
  var ${seqName} = [10, 20, 30, 40, 50, 60, 70, 80];
  function ${sliceName}(min, max) { return ${seqName}["slice"](min, max); }
  var x = [...${sliceName}(0, 3), -5, ...${sliceName}(5, 7)];
`

const firstSpreadArray = (code) =>
  firstPath(
    code,
    (p) =>
      p.isArrayExpression() &&
      p.node.elements.some((el) => el && el.type === 'SpreadElement'),
  )

test('decompressStateVector: mixes literal and spread-slice elements', () => {
  const path = firstSpreadArray(SLICE_PROGRAM('a_cff_slice', 'a_cff_sequence'))
  expect(controlFlow.decompressStateVector(path)).toEqual([
    10, 20, 30, -5, 60, 70,
  ])
})

test('decompressStateVector: resolves the same under renamed helpers', () => {
  const path = firstSpreadArray(SLICE_PROGRAM('qZ', 'r7'))
  expect(controlFlow.decompressStateVector(path)).toEqual([
    10, 20, 30, -5, 60, 70,
  ])
})

test('decompressStateVector: rejects a spread whose callee is not a slice helper', () => {
  const path = firstSpreadArray('var x = [1, ...notAHelper(0, 3)];')
  expect(controlFlow.decompressStateVector(path)).toBeNull()
})

test('decompressStateVector: rejects an unrecognized element', () => {
  const path = firstPath('var x = [1, foo()];', (p) => p.isArrayExpression())
  expect(controlFlow.decompressStateVector(path)).toBeNull()
})

// Same rename-proofing for the string-entanglement helper: found from a three-argument call
// site whose callee binds to a three-parameter function reading a Program-level string blob.
test('resolveXorHelper: resolves the xor helper and blob from a use site', () => {
  const program = firstPath(
    `
    var qq = "payload-blob";
    function zz(key, start, length) {
      for (var result = '', i = 0; i < length; i++) {
        result += qq["charCodeAt"](start + i);
      }
      return result;
    }
    function app(states) { var s = zz(states[0] + 4, 3, 7); }
    `,
    (p) => p.isProgram(),
  )
  expect(controlFlow.resolveXorHelper(program)).toEqual({
    xorFnName: 'zz',
    stringsBlob: 'payload-blob',
  })
})

test('resolveXorHelper: returns null when no string is entangled', () => {
  const program = firstPath('function app(states) { return states[0]; }', (p) =>
    p.isProgram(),
  )
  expect(controlFlow.resolveXorHelper(program)).toBeNull()
})

test('applyStateMutations: plain assignment and relative-diff assignment', () => {
  const path = firstPath('states[0] = 5, states[1] += states[2] - 3;', (p) =>
    p.isSequenceExpression(),
  )
  expect(
    controlFlow.applyStateMutations(path, 'states', [100, 200, 300]),
  ).toEqual([5, 497, 300])
})

test('applyStateMutations: later expressions read earlier mutations, not the entry vector', () => {
  const path = firstPath('states[0] = 5, states[1] += states[0] - 1;', (p) =>
    p.isSequenceExpression(),
  )
  expect(controlFlow.applyStateMutations(path, 'states', [100, 200])).toEqual([
    5, 204,
  ])
})

test('applyStateMutations: rejects an unrecognized expression shape', () => {
  const path = firstPath('states[0] = 5, doSomething();', (p) =>
    p.isSequenceExpression(),
  )
  expect(controlFlow.applyStateMutations(path, 'states', [100, 200])).toBeNull()
})

test('evaluateBooleanExpression: comparison operators beyond ==/!=', () => {
  const lt = firstPath('states[0] < states[1] + 5;', (p) =>
    p.isBinaryExpression(),
  )
  expect(controlFlow.evaluateBooleanExpression(lt, 'states', [10, 3])).toBe(
    false,
  )
})

test('evaluateBooleanExpression: unwinds a leading negation', () => {
  const neg = firstPath('!(states[0] != states[1]);', (p) =>
    p.isUnaryExpression({ operator: '!' }),
  )
  expect(controlFlow.evaluateBooleanExpression(neg, 'states', [7, 7])).toBe(
    true,
  )
})

const dispatcherCode = `
switch (sum(states)) {
  case 5:
  case states[0] + 7:
    doReal();
    break;
  case 9:
    doOther();
    break;
  case states[1] != 99 && states[0] + 7:
    doGuarded();
    break;
}
`

test('parseSwitchCaseGroups: groups fallthrough decoys with the body-bearing case', () => {
  const path = firstPath(dispatcherCode, (p) => p.isSwitchStatement())
  const groups = controlFlow.parseSwitchCaseGroups(path)
  expect(groups.length).toBe(3)
  expect(groups[0].tests.length).toBe(2)
  expect(groups[1].tests.length).toBe(1)
})

test('matchCaseGroup: matches by evaluating every test in a group against the sum', () => {
  const path = firstPath(dispatcherCode, (p) => p.isSwitchStatement())
  const groups = controlFlow.parseSwitchCaseGroups(path)
  // sum([10, 7]) === 17 === states[0] + 7, the decoy-paired complex test in group 0
  const match = controlFlow.matchCaseGroup(groups, 'states', [10, 7])
  expect(match).toBe(groups[0])
})

test('matchCaseGroup: an && guard that fails to hold excludes its group', () => {
  const path = firstPath(dispatcherCode, (p) => p.isSwitchStatement())
  const groups = controlFlow.parseSwitchCaseGroups(path)
  // sum([10, 99]) === 109: group 2's guard (states[1] != 99) evaluates false here, so its
  // test short-circuits to `false` and can never match a numeric sum - even though group
  // 2's own guarded value (states[0] + 7 === 17) has nothing to do with 109 either, this
  // specifically exercises the guard-false short-circuit path, not just a value mismatch.
  const match = controlFlow.matchCaseGroup(groups, 'states', [10, 99])
  expect(match).toBe(null)
})

test('matchCaseGroup: no group matches an unreachable sum', () => {
  const path = firstPath(dispatcherCode, (p) => p.isSwitchStatement())
  const groups = controlFlow.parseSwitchCaseGroups(path)
  expect(controlFlow.matchCaseGroup(groups, 'states', [1, 1])).toBeNull()
})

test('parseDispatcher: accepts a negative endTotalState (prints as UnaryExpression, not NumericLiteral)', () => {
  const mainFnPath = firstPath(
    'function main(states, scope, runtime) { while (sum(states) !== -894) { switch (sum(states)) { case 1: break; } } }',
    (p) => p.isFunctionDeclaration(),
  )
  const dispatcher = controlFlow.parseDispatcher(mainFnPath)
  expect(dispatcher).not.toBeNull()
  expect(dispatcher.endTotalState).toBe(-894)
})

test('parseWhileSwitch: accepts the normal block-wrapped switch body', () => {
  const whilePath = firstPath(
    'while (sum(states) !== 5) { switch (sum(states)) { case 1: break; } }',
    (p) => p.isWhileStatement(),
  )
  const loop = controlFlow.parseWhileSwitch(whilePath)
  expect(loop).not.toBeNull()
  expect(loop.endTotalState).toBe(5)
})

test('parseWhileSwitch: accepts a braceless switch body (minify strips the block from a single-statement while body)', () => {
  const whilePath = firstPath(
    'while (sum(states) !== 5) switch (sum(states)) { case 1: break; }',
    (p) => p.isWhileStatement(),
  )
  const loop = controlFlow.parseWhileSwitch(whilePath)
  expect(loop).not.toBeNull()
  expect(loop.endTotalState).toBe(5)
})

test('parseWhileSwitch: accepts a braceless labeled switch body', () => {
  const whilePath = firstPath(
    'while (sum(states) !== 5) lbl: switch (sum(states)) { case 1: break lbl; }',
    (p) => p.isWhileStatement(),
  )
  const loop = controlFlow.parseWhileSwitch(whilePath)
  expect(loop).not.toBeNull()
  expect(loop.switchLabel).toBe('lbl')
})

test('parseWhileSwitch: still rejects a block body with more than the one switch statement', () => {
  const whilePath = firstPath(
    'while (sum(states) !== 5) { doSomethingElse(); switch (sum(states)) { case 1: break; } }',
    (p) => p.isWhileStatement(),
  )
  expect(controlFlow.parseWhileSwitch(whilePath)).toBeNull()
})

test('parseDispatcher: works through a braceless while body too (minify shape)', () => {
  const mainFnPath = firstPath(
    'function main(states, scope, runtime) { while (sum(states) !== -894) switch (sum(states)) { case 1: break; } }',
    (p) => p.isFunctionDeclaration(),
  )
  const dispatcher = controlFlow.parseDispatcher(mainFnPath)
  expect(dispatcher).not.toBeNull()
  expect(dispatcher.endTotalState).toBe(-894)
})

test('matchGotoSequence: recognizes a zero-assignment goto (EmptyStatement + break)', () => {
  // controlFlowFlattening.ts skips a slot's assignment whenever the jump target's value
  // matches the current block's - if every slot matches (e.g. a dead-code fake jump whose
  // random target happens to be its own block), the resulting empty SequenceExpression
  // prints/reparses as a bare EmptyStatement, not an ExpressionStatement wrapping one.
  const path = firstPath('switch (1) { case 1: if (x) { ; break; } }', (p) =>
    p.isIfStatement(),
  )
  const seq = controlFlow.matchGotoSequence(
    path.get('consequent').get('body'),
    'states',
    null,
  )
  expect(seq).not.toBeNull()
})

test('matchGotoSequence: still rejects a bare EmptyStatement not followed by break', () => {
  const path = firstPath('if (x) { ; foo(); }', (p) => p.isIfStatement())
  const seq = controlFlow.matchGotoSequence(
    path.get('consequent').get('body'),
    'states',
    null,
  )
  expect(seq).toBeNull()
})

// AstScrambler (Order 29) runs after CFF (Order 24) and merges consecutive expression
// statements into one no-op call, spreading any SequenceExpression it finds into the flat
// argument list. Un-merging that call cannot restore the original partition (the encode
// step is many-to-one), so the goto matcher has to accept either shape.

test('matchGotoSequence: accepts the un-merged run of separate assignment statements', () => {
  const path = firstPath(
    'switch (1) { case 1: if (x) { states[0] = 5; states[1] += 2; break; } }',
    (p) => p.isIfStatement(),
  )
  const exprPaths = controlFlow.matchGotoSequence(
    path.get('consequent').get('body'),
    'states',
    null,
  )
  expect(exprPaths).not.toBeNull()
  expect(exprPaths).toHaveLength(2)
})

test('matchGotoSequence: accepts a single-assignment statement, which reparses without a SequenceExpression wrapper', () => {
  const path = firstPath(
    'switch (1) { case 1: if (x) { states[3] = 9; break; } }',
    (p) => p.isIfStatement(),
  )
  const exprPaths = controlFlow.matchGotoSequence(
    path.get('consequent').get('body'),
    'states',
    null,
  )
  expect(exprPaths).toHaveLength(1)
})

test('matchGotoSequence: accepts a bare break as the zero-assignment goto AstScrambler strips', () => {
  // The placeholder is an ExpressionStatement wrapping an empty SequenceExpression in the
  // encoder's own AST, so spreading its zero expressions emits nothing at all - the
  // `; break;` shape becomes a bare `break;`.
  const path = firstPath('switch (1) { case 1: if (x) { break; } }', (p) =>
    p.isIfStatement(),
  )
  const exprPaths = controlFlow.matchGotoSequence(
    path.get('consequent').get('body'),
    'states',
    null,
  )
  expect(exprPaths).toEqual([])
})

test('matchGotoSequence: rejects a window whose head holds a non-goto statement', () => {
  const path = firstPath(
    'switch (1) { case 1: if (x) { doSomething(); states[0] = 5; break; } }',
    (p) => p.isIfStatement(),
  )
  expect(
    controlFlow.matchGotoSequence(
      path.get('consequent').get('body'),
      'states',
      null,
    ),
  ).toBeNull()
})

test('findGotoRunEnd: takes only the maximal trailing run, leaving merged user code behind', () => {
  // AstScrambler merges across statement boundaries, so real user code can share the run
  // with the goto's updates. Starting on the user statement must not match; starting on
  // the first state update must, and must stop at the break.
  const path = firstPath(
    'switch (1) { case 1: user(); states[0] = 5; states[1] += 2; break; }',
    (p) => p.isSwitchCase(),
  )
  const stmts = path.get('consequent')
  expect(controlFlow.findGotoRunEnd(stmts, 0, 'states')).toBe(-1)
  expect(controlFlow.findGotoRunEnd(stmts, 1, 'states')).toBe(3)
})

test('findGotoRunEnd: rejects a run that does not end at a break', () => {
  const path = firstPath(
    'switch (1) { case 1: states[0] = 5; user(); break; }',
    (p) => p.isSwitchCase(),
  )
  expect(controlFlow.findGotoRunEnd(path.get('consequent'), 0, 'states')).toBe(
    -1,
  )
})

test('readGotoAssignments: reads both partitions and rejects a non-state assignment', () => {
  const seq = firstPath(
    'switch (1) { case 1: states[0] = 5, states[1] += 2; }',
    (p) => p.isExpressionStatement(),
  )
  expect(controlFlow.readGotoAssignments(seq, 'states')).toHaveLength(2)

  const single = firstPath('switch (1) { case 1: states[0] = 5; }', (p) =>
    p.isExpressionStatement(),
  )
  expect(controlFlow.readGotoAssignments(single, 'states')).toHaveLength(1)

  const other = firstPath('switch (1) { case 1: notStates[0] = 5; }', (p) =>
    p.isExpressionStatement(),
  )
  expect(controlFlow.readGotoAssignments(other, 'states')).toBeNull()
})
