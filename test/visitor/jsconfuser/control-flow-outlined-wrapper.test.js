import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { describe, expect, test } from 'vitest'
import controlFlow from '#visitor/jsconfuser/control-flow-graph.js'

// N1 (checkpoint gap #2): `matchOutlinedFunctionWrapper` must accept BOTH callee shapes an
// outlined nested-function wrapper can take -
//   - a bare `mainFnName(...)` (the top-level `_main` FunctionDeclaration case, already
//     covered by the real-sample nested-function test), and
//   - the `(1, mainFnName)(...)` comma-guard (what an *inline* `var = function(...){}` shared
//     interpreter's own nested wrappers use).
// Verified against real output: an inline interpreter's fresh-scope nested wrappers are the
// only reason the residual stayed raw, and the comma-guard callee was the single mismatch.
// A plain numeric vector decompresses with `sequence=[]`, `sliceFnName=null` (no spreads).

// The first `Function` path in `code` (the wrapper `function (...r) {...}` expression).
function wrapperFn(code) {
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

const CTX = {
  mainFnName: 'main',
  sequence: [],
  sliceFnName: null,
  runtimeName: 'rt',
}

describe('matchOutlinedFunctionWrapper (N1, guarded + unguarded callee)', () => {
  test('matches a bare `mainFnName(...)` callee', () => {
    const match = controlFlow.matchOutlinedFunctionWrapper(
      wrapperFn(
        'var w = function (...r) { return main([1, 2, 3], s0, rt, r); };',
      ),
      CTX,
    )
    expect(match).not.toBeNull()
    expect(match.restName).toBe('r')
    expect(match.entryVector).toEqual([1, 2, 3])
  })

  test('matches the `(1, mainFnName)(...)` comma-guard callee', () => {
    const match = controlFlow.matchOutlinedFunctionWrapper(
      wrapperFn(
        'var w = function (...r) { return (1, main)([1, 2, 3], s0, rt, r); };',
      ),
      CTX,
    )
    expect(match).not.toBeNull()
    expect(match.restName).toBe('r')
    expect(match.entryVector).toEqual([1, 2, 3])
  })

  test('reads a negative-literal vector through the comma-guard', () => {
    const match = controlFlow.matchOutlinedFunctionWrapper(
      wrapperFn(
        'var w = function (...r) { return (1, main)([1, -2, 3], s0, rt, r); };',
      ),
      CTX,
    )
    expect(match.entryVector).toEqual([1, -2, 3])
  })

  test('rejects a comma-guard whose final expression is a different identifier', () => {
    expect(
      controlFlow.matchOutlinedFunctionWrapper(
        wrapperFn(
          'var w = function (...r) { return (1, other)([1, 2, 3], s0, rt, r); };',
        ),
        CTX,
      ),
    ).toBeNull()
  })

  test('rejects a bare callee that is a different identifier', () => {
    expect(
      controlFlow.matchOutlinedFunctionWrapper(
        wrapperFn(
          'var w = function (...r) { return other([1, 2, 3], s0, rt, r); };',
        ),
        CTX,
      ),
    ).toBeNull()
  })

  test('rejects when the runtime argument does not match runtimeName', () => {
    expect(
      controlFlow.matchOutlinedFunctionWrapper(
        wrapperFn(
          'var w = function (...r) { return (1, main)([1, 2, 3], s0, notRt, r); };',
        ),
        CTX,
      ),
    ).toBeNull()
  })

  test('rejects when the rest argument is not forwarded as the last argument', () => {
    expect(
      controlFlow.matchOutlinedFunctionWrapper(
        wrapperFn(
          'var w = function (...r) { return (1, main)([1, 2, 3], s0, rt, other); };',
        ),
        CTX,
      ),
    ).toBeNull()
  })
})
