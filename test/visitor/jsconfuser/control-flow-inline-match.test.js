import fs from 'fs'
import { join } from 'path'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { describe, expect, test } from 'vitest'
import controlFlow from '#visitor/jsconfuser/control-flow-graph.js'

// M1: detection of the inline-flattened-function residual (checkpoint gap #2), and the
// shared `parseWhileSwitch` reader extracted from `parseDispatcher`. Detection only - the
// matcher reads names/facts and never mutates the AST. Decoding the matched function is N2
// (`decodeInlineFlattenedFunction`); the scope-member-state variant is M2.

// Every `Function` in `code`, run through `matchInlineFlattenedFunction`; non-null results
// collected. `path.skip()` so a matched function's nested inner interpreter (a separate,
// non-function-wrapped shape) isn't re-descended into as its own function match.
function collectInlineMatches(code) {
  const ast = parse(code)
  const matches = []
  traverse(ast, {
    Function(path) {
      const match = controlFlow.matchInlineFlattenedFunction(path)
      if (match) {
        matches.push(match)
        path.skip()
      }
    },
  })
  return matches
}

// Every `WhileStatement` in `code`, run through `matchScopeMemberInterpreter`; non-null
// results collected.
function collectScopeMemberInterpreters(code, options) {
  const matches = []
  traverse(parse(code), {
    WhileStatement(path) {
      const match = controlFlow.matchScopeMemberInterpreter(path, options)
      if (match) {
        matches.push(match)
      }
    },
  })
  return matches
}

// The first `Function` path in `code`, for single-shape negative cases.
function firstFunction(code) {
  let found = null
  traverse(parse(code), {
    Function(path) {
      if (!found) {
        found = path
      }
    },
  })
  return found
}

// The first `WhileStatement` path in `code`, for `parseWhileSwitch` cases.
function firstWhile(code) {
  let found = null
  traverse(parse(code), {
    WhileStatement(path) {
      if (!found) {
        found = path
      }
    },
  })
  return found
}

// The `Program` path for `code`, the search root `collectInlineEntryVectors` traverses.
function programPath(code) {
  let found = null
  traverse(parse(code), {
    Program(path) {
      found = path
      path.stop()
    },
  })
  return found
}

const decodedFixture = fs.readFileSync(
  join(__dirname, 'control-flow-graph', 'inline-flattened-decoded.js'),
  { encoding: 'utf-8' },
)

describe('matchInlineFlattenedFunction (M1, local-array-state variant)', () => {
  test('finds exactly the one inline-flattened function in the decoded fixture', () => {
    // The fixture's residual is a single inline-flattened function (`<name> = function
    // (...arg) { ... }`). Its inner scope-member interpreter is nested in the switch, not a
    // second function, so exactly one function matches.
    const matches = collectInlineMatches(decodedFixture)
    expect(matches.length).toBe(1)
  })

  test('reads the destructured state/scope/runtime/arg names and interpreter facts', () => {
    const [match] = collectInlineMatches(decodedFixture)

    // The packed rest parameter, `...<something>__arg` by the encoder's naming.
    expect(typeof match.restName).toBe('string')
    expect(match.restName.endsWith('__arg')).toBe(true)

    // Four distinct destructured slots: state array, scope object, runtime, packed args.
    const names = [
      match.statesName,
      match.scopeName,
      match.runtimeName,
      match.argName,
    ]
    for (const name of names) {
      expect(typeof name).toBe('string')
    }
    expect(new Set(names).size).toBe(4)

    // The interpreter is driven by `<name>_cff_sum(state) !== end`.
    expect(match.sumFnName.endsWith('_cff_sum')).toBe(true)
    expect(match.endTotalState).toBe(-203) // frozen fixture's end state
    expect(match.switchLabel).toBeNull() // this run's switch came out unlabeled
    expect(match.switchPath.isSwitchStatement()).toBe(true)
    expect(match.whilePath.isWhileStatement()).toBe(true)
  })

  test('statesName is the first destructured element', () => {
    const [match] = collectInlineMatches(decodedFixture)
    // Cross-check against the AST: the while's discriminant argument is the first slot.
    const stateArg = match.whilePath.get('test').get('left').get('arguments.0')
    expect(stateArg.isIdentifier({ name: match.statesName })).toBe(true)
  })

  test('rejects a plain rest-param function (no unpack, no interpreter)', () => {
    expect(
      controlFlow.matchInlineFlattenedFunction(
        firstFunction('var f = function (...r) { return r; };'),
      ),
    ).toBeNull()
  })

  test('rejects a function that unpacks but has no interpreter loop', () => {
    expect(
      controlFlow.matchInlineFlattenedFunction(
        firstFunction(
          'var f = function (...r) { var a, b; [a, b = {}] = r; return a; };',
        ),
      ),
    ).toBeNull()
  })

  test('rejects a non-rest-parameter function', () => {
    expect(
      controlFlow.matchInlineFlattenedFunction(
        firstFunction('var f = function (x) { return x; };'),
      ),
    ).toBeNull()
  })

  test('rejects when the interpreter state is not the first destructured local', () => {
    // Unpack binds `a`, but the loop reads `b` - not this function's own state machine.
    expect(
      controlFlow.matchInlineFlattenedFunction(
        firstFunction(
          'var f = function (...r) { var a; [a] = r; while (sum(b) !== 1) { switch (sum(b)) { case 1: break; } } };',
        ),
      ),
    ).toBeNull()
  })
})

describe('collectInlineEntryVectors', () => {
  // Plain numeric vectors decompress with `sequence=[]`, `sliceFnName=null` (no spreads).
  const CONSTS = { sequence: [], sliceFnName: null }

  test('collects both the bare and comma-guard call sites of the named fn', () => {
    const vectors = controlFlow.collectInlineEntryVectors(
      programPath('fn([1, 2], a); (1, fn)([3, 4], b); other([9, 9]);'),
      'fn',
      CONSTS,
    )
    expect(vectors).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  test('de-duplicates identical vectors across call sites', () => {
    const vectors = controlFlow.collectInlineEntryVectors(
      programPath('fn([1, 2], a); (1, fn)([1, 2], b);'),
      'fn',
      CONSTS,
    )
    expect(vectors).toEqual([[1, 2]])
  })

  test('skips a call whose first argument is not a static array', () => {
    const vectors = controlFlow.collectInlineEntryVectors(
      programPath('fn(dynamicVec, a); fn([5, 6], b);'),
      'fn',
      CONSTS,
    )
    expect(vectors).toEqual([[5, 6]])
  })

  test('returns an empty list when the named fn is never called', () => {
    expect(
      controlFlow.collectInlineEntryVectors(
        programPath('other([1, 2]);'),
        'fn',
        CONSTS,
      ),
    ).toEqual([])
  })

  test('excludePath drops call sites inside the excluded subtree (keeps externals)', () => {
    // The inline fn's own body is excluded so only its *external* entry is collected - the
    // in-body self-calls are its nested wrappers, decoded separately (gap #2 N2).
    const program = programPath(
      'function f() { fn([1, 2], a); } fn([3, 4], b);',
    )
    let fnBody = null
    program.traverse({
      FunctionDeclaration(p) {
        fnBody = p
      },
    })
    expect(
      controlFlow.collectInlineEntryVectors(program, 'fn', {
        ...CONSTS,
        excludePath: fnBody,
      }),
    ).toEqual([[3, 4]])
  })
})

describe('parseWhileSwitch (M1 shared reader)', () => {
  test('reads sumFn / end / label and returns an Identifier state operand', () => {
    const parsed = controlFlow.parseWhileSwitch(
      firstWhile(
        'while (s0(v) !== 5) { lbl: switch (s0(v)) { case 1: break lbl; } }',
      ),
    )
    expect(parsed).not.toBeNull()
    expect(parsed.sumFnName).toBe('s0')
    expect(parsed.endTotalState).toBe(5)
    expect(parsed.switchLabel).toBe('lbl')
    expect(parsed.switchPath.isSwitchStatement()).toBe(true)
    expect(parsed.statePath.isIdentifier({ name: 'v' })).toBe(true)
  })

  test('handles an unlabeled switch and a negative end state', () => {
    const parsed = controlFlow.parseWhileSwitch(
      firstWhile('while (s0(v) !== -12) { switch (s0(v)) { case 1: break; } }'),
    )
    expect(parsed).not.toBeNull()
    expect(parsed.switchLabel).toBeNull()
    expect(parsed.endTotalState).toBe(-12)
  })

  test('is state-shape agnostic: accepts a scope-member discriminant (M2 groundwork)', () => {
    // The scope-member-state variant reads its state from `scope[k1][k2]`; the shared reader
    // returns that MemberExpression as `statePath` without judging it - the M2 matcher will.
    const parsed = controlFlow.parseWhileSwitch(
      firstWhile(
        'while (s0(scope["a"]["b"]) !== 7) { switch (s0(scope["a"]["b"])) { case 1: break; } }',
      ),
    )
    expect(parsed).not.toBeNull()
    expect(parsed.statePath.isMemberExpression({ computed: true })).toBe(true)
    expect(parsed.endTotalState).toBe(7)
  })

  test('rejects a non-interpreter while loop', () => {
    expect(
      controlFlow.parseWhileSwitch(firstWhile('while (x < 10) { x++; }')),
    ).toBeNull()
  })
})

describe('matchScopeMemberInterpreter (M2, scope-member-state variant)', () => {
  test('finds the scope-member interpreter nested in the decoded fixture', () => {
    const matches = collectScopeMemberInterpreters(decodedFixture)
    expect(matches.length).toBe(1)

    const [match] = matches
    // State array lives in a computed string-key member chain (`scope["a"]["b"]`).
    expect(typeof match.scopeName).toBe('string')
    expect(Array.isArray(match.stateKeys)).toBe(true)
    expect(match.stateKeys.length).toBeGreaterThanOrEqual(1)
    for (const key of match.stateKeys) {
      expect(typeof key).toBe('string')
    }
    expect(match.sumFnName.endsWith('_cff_sum')).toBe(true)
    expect(match.endTotalState).toBe(-803) // frozen fixture's inner end state
    expect(match.switchPath.isSwitchStatement()).toBe(true)
  })

  test('its scope object belongs to the enclosing inline function', () => {
    // The nested interpreter belongs to the M1 function: its state's root identifier is that
    // function's second destructured slot (`scopeName`). This is how M3/M4 bind the two.
    const [fn] = collectInlineMatches(decodedFixture)
    const [inner] = collectScopeMemberInterpreters(decodedFixture)
    expect(inner.scopeName).toBe(fn.scopeName)
  })

  test('scopeName filter accepts the matching scope and rejects a wrong one', () => {
    const [inner] = collectScopeMemberInterpreters(decodedFixture)
    expect(
      collectScopeMemberInterpreters(decodedFixture, {
        scopeName: inner.scopeName,
      }).length,
    ).toBe(1)
    expect(
      collectScopeMemberInterpreters(decodedFixture, {
        scopeName: 'definitely-not-the-scope',
      }).length,
    ).toBe(0)
  })

  test('rejects a local-array-state interpreter (Identifier state, not a member)', () => {
    expect(
      controlFlow.matchScopeMemberInterpreter(
        firstWhile('while (s0(v) !== 1) { switch (s0(v)) { case 1: break; } }'),
      ),
    ).toBeNull()
  })

  test('accepts a dot-notation member state (minify rewrites scope["a"]["b"] to scope.a.b)', () => {
    const match = controlFlow.matchScopeMemberInterpreter(
      firstWhile(
        'while (s0(scope.aB1.xYz) !== 1) { switch (s0(scope.aB1.xYz)) { case 1: break; } }',
      ),
    )
    expect(match).not.toBeNull()
    expect(match.scopeName).toBe('scope')
    expect(match.stateKeys).toEqual(['aB1', 'xYz'])
  })

  test('rejects a non-string-key member state (e.g. an array index)', () => {
    expect(
      controlFlow.matchScopeMemberInterpreter(
        firstWhile(
          'while (s0(scope[i]) !== 1) { switch (s0(scope[i])) { case 1: break; } }',
        ),
      ),
    ).toBeNull()
  })

  test('rejects a non-interpreter while loop', () => {
    expect(
      controlFlow.matchScopeMemberInterpreter(
        firstWhile('while (x < 10) { x++; }'),
      ),
    ).toBeNull()
  })
})
