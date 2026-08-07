import fs from 'fs'
import { join } from 'path'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { describe, expect, test } from 'vitest'
import PluginJsconfuser from '#plugin/jsconfuser.js'

// M0 fixture + end-to-end test for the "inline-flattened function" gap (checkpoint gap #2).
// Once thought to need a relooper (a self-recursive, multi-entry loop structurer), the
// residual was verified to be an *acyclic* multi-entry dispatch DAG + fresh-scope nested
// wrappers - decodable by reusing the existing acyclic pipeline, no relooper. The N2 decode
// (`decodeInlineFlattenedFunction`, wired into the CFF visitor) fully resolves it; the
// end-to-end test at the bottom is the acceptance criterion.
//
// Both fixtures are one frozen, real `js-confuser` `dist/` obfuscation of:
//
//   function calc(a, b) {
//     var x = a + b;
//     var y = a * b;
//     return x + y;
//   }
//   console.log(calc(1, 2));   // prints 5  ((1+2) + (1*2))
//
// obfuscated with `{ target: "node", controlFlowFlattening: 1, dispatcher: true }`. CFF
// output is randomized per run (no seed option), so these are captured once and committed.
//
// Fixture-scope finding worth recording: the checkpoint documented this gap's repro recipe
// with `stringConcealing: true` as well (it's in the `high`/`medium` presets alongside the
// other two). Dropping `stringConcealing` *still* reproduces both inline-interpreter
// variants at less than half the byte size - it only added orthogonal string-decoding noise.
//
// - `inline-flattened-sample.js`   - the raw encoded input (full-decode target).
// - `inline-flattened-decoded.js`  - that input run through the decoder *as it stood at M0*,
//   before N2. Every proper `_main`+harness CFF application is decoded and the program runs
//   correctly, but two inline-flattened interpreters survive (one of each variant). This
//   frozen snapshot is the stable development target for the matcher unit tests (M1/M2) - it
//   is committed, not re-decoded at test time, so it stays fixed as a matcher fixture even
//   though the live pipeline (post-N2) now decodes the raw sample all the way.
const dir = join(__dirname, 'control-flow-graph')
const rawPath = join(dir, 'inline-flattened-sample.js')
const decodedPath = join(dir, 'inline-flattened-decoded.js')

const rawCode = fs.readFileSync(rawPath, { encoding: 'utf-8' })
const decodedCode = fs.readFileSync(decodedPath, { encoding: 'utf-8' })

// A CFF interpreter's driving loop is always `while (<name>_cff_sum(<state>) !== <end>)`.
// `<state>` is an Identifier for the local-array-state variant (`[state, scope, ...] = arg`)
// and a computed MemberExpression for the scope-member-state variant (`scope[k1][k2]`).
function collectInterpreterWhiles(ast) {
  const found = []
  traverse(ast, {
    WhileStatement(path) {
      const test = path.get('test')
      if (!test.isBinaryExpression({ operator: '!==' })) {
        return
      }
      const left = test.get('left')
      if (
        !left.isCallExpression() ||
        !left.get('callee').isIdentifier() ||
        !left.node.callee.name.endsWith('_cff_sum')
      ) {
        return
      }
      const stateArg = left.get('arguments.0')
      if (!stateArg) {
        return
      }
      found.push({
        stateArg,
        isLocalState: stateArg.isIdentifier(),
        isScopeMemberState: stateArg.isMemberExpression({ computed: true }),
      })
    },
  })
  return found
}

describe('inline-flattened CFF interpreter (gap #2, M0 characterization)', () => {
  test('both fixtures parse', () => {
    expect(() => parse(rawCode)).not.toThrow()
    expect(() => parse(decodedCode)).not.toThrow()
  })

  test('raw sample carries the CFF/dispatcher machinery this gap needs', () => {
    // Sanity that the frozen input is the intended combo: CFF shared helpers + at least one
    // `_main` dispatcher application. (No decode here - just that the ingredients are present.)
    expect(rawCode).toMatch(/_cff_sequence\b/)
    expect(rawCode).toMatch(/_cff_slice\b/)
    expect(rawCode).toMatch(/_cff_sum\b/)
    expect(rawCode).toMatch(/_main\b/)
  })

  test('the frozen M0 snapshot carries the two inline interpreters, one of each variant', () => {
    // This asserts the properties of the committed matcher-test fixture (the pre-N2 snapshot),
    // not the live decoder - the live decoder now resolves both (see the end-to-end test).
    const ast = parse(decodedCode)

    // Every proper `_main`+harness application is decoded away.
    const mains = generate(ast).code.match(/[A-Za-z0-9_$]+_main\b/g) || []
    expect(mains.length).toBe(0)

    const interpreters = collectInterpreterWhiles(ast)
    // Two survive in this pre-N2 snapshot, one of each variant. Both are driven by
    // `_cff_sum(state) !== end`.
    expect(interpreters.length).toBe(2)

    // One of each variant is present - this is what makes this single fixture exercise the
    // whole matcher surface (M1 local-array state, M2 scope-member state).
    expect(interpreters.some((i) => i.isLocalState)).toBe(true)
    expect(interpreters.some((i) => i.isScopeMemberState)).toBe(true)
  })

  test('the frozen M0 snapshot is already semantically correct (prints 5)', () => {
    // N2 must preserve this: same observable result, just without the residual interpreters.
    // Run the frozen snapshot with a captured console.
    const logs = []
    const fakeConsole = { log: (...args) => logs.push(args.join(' ')) }

    new Function('console', decodedCode)(fakeConsole)
    expect(logs).toEqual(['5'])
  })

  // N2 acceptance criterion: decoding `inline-flattened-sample.js` from scratch through the
  // full plugin produces output that (a) still prints 5 and (b) contains zero
  // `_cff_sum(state) !== end` interpreter loops.
  test('N2: full plugin decode of the raw sample leaves zero inline interpreters and prints 5', () => {
    const decoded = PluginJsconfuser(rawCode)

    const interpreters = collectInterpreterWhiles(parse(decoded))
    expect(interpreters.length).toBe(0)

    const logs = []
    const fakeConsole = { log: (...args) => logs.push(args.join(' ')) }

    new Function('console', decoded)(fakeConsole)
    expect(logs).toEqual(['5'])
  })
})
