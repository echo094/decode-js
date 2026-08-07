import { join } from 'path'
import { test } from 'vitest'
import { getPluginResult } from '../helper.js'
import PluginJsconfuser from '#plugin/jsconfuser.js'

const root = __dirname

// The three fixtures below are frozen real js-confuser dist/ obfuscations (CFF's output
// is randomized per run, no seed option - same rationale as
// test/visitor/jsconfuser/control-flow-graph/real-sample.js), covering the three distinct
// entry-harness shapes deControlFlowFlatteningGraphInit has to recognize: a Function-level
// application (didReturnVar/result wiring), one containing an outlined nested function
// (recursing into decodeFlattenedFunction a second time), and a bare Program-level
// application (no didReturnVar wiring at all, and the one case where a decoded body's
// trailing statement needs unwrapping from `return` back to a plain expression statement).

test('control-flow-flattening', () => {
  const tc = 'control-flow-flattening'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

test('control-flow-flattening-nested-function', () => {
  const tc = 'control-flow-flattening-nested-function'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

test('control-flow-flattening-program-level', () => {
  const tc = 'control-flow-flattening-program-level'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// A frozen real `{ controlFlowFlattening: 1, minify: true }` sample (nested closures over a
// free variable, forcing scope-member state). `minify` strips the block from a
// single-statement `while` body (`while(x)switch(y){...}`, no braces) and rewrites
// `scope["key"]` to `scope.key` wherever the key is a compile-time string that's also a
// valid identifier - both of which broke this combo before `parseWhileSwitch` and
// `matchScopeMemberChain`/`matchScopeMemberInterpreter` were taught to accept the
// braceless/dot-notation forms (see checkpoint.md's "CFF scope-member computed-vs-dot-notation
// gap").
test('control-flow-flattening-minify', () => {
  const tc = 'control-flow-flattening-minify'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// A second frozen real `{ controlFlowFlattening: 1, minify: true }` sample, this one pinning
// the *block terminator* rewrite: CFF ends a block with `return undefined;`, which `minify`
// prints as a bare `return;`. `parseReturnValue` read an argument-less return as an
// unrecognized shape rather than a terminal, so the group failed, and with it the whole
// enclosing application - every minified sample whose walk reached such a block decoded 0%.
test('control-flow-flattening-minify-return', () => {
  const tc = 'control-flow-flattening-minify-return'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// A frozen real `{ controlFlowFlattening, renameVariables, movedDeclarations, dispatcher,
// minify }` sample pinning MovedDeclarations' *parameter packing* of the CFF `_main`
// declaration: it is retyped to an anonymous function expression, its name appended to the
// enclosing function's parameter list, and an `if (!X) { X = function (...) {...} }` guard
// prepended in its place. The CFF entry scan only ever looked for a `FunctionDeclaration`, so
// every packed application decoded 0% while staying runtime-correct. Six interpreters in,
// zero out. (`dispatcher` is what nests `_main` inside a PREDICTABLE function in the first
// place - without it MovedDeclarations never packs it, so the combo is load-bearing here.)
test('control-flow-flattening-moved-declarations', () => {
  const tc = 'control-flow-flattening-moved-declarations'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// A frozen real `{ controlFlowFlattening, renameVariables, astScrambler, dispatcher }`
// sample pinning both ways AstScrambler dissolves CFF's goto partition. CFF prints a goto as
// one `ExpressionStatement` wrapping a `SequenceExpression` of state updates, then `break`;
// AstScrambler spreads that sequence into its merged no-op call, and un-merging the call
// cannot restore the original partition, so the goto arrives as (1) a *run* of separate
// assignment statements, or (2) - for the zero-assignment goto, whose placeholder is an
// empty `SequenceExpression` that contributes no arguments at all - nothing, leaving a bare
// `if (pred) { break; }`. Both reached `interpretBlockGroup`'s bare-`break` guard and failed
// the whole enclosing application closed. Four interpreters in, zero out. The generator
// requires both shapes to be present in the obfuscated input, so the sample can't drift into
// exercising only one.
test('control-flow-flattening-ast-scrambler', () => {
  const tc = 'control-flow-flattening-ast-scrambler'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// A frozen real `{ controlFlowFlattening: 1, deadCode: 1 }` sample pinning `throw` as a block
// terminal. DeadCode (Order 8) injects templates whose argument guards throw; CFF (Order 24)
// then flattens those throws into switch cases. `interpretBlockGroup` recognized only
// `return` and goto terminals, so a case group ending in `throw` fell off the end and failed
// the whole enclosing application closed. Nine interpreters in, zero out. `cff` alone never
// emits a flattened throw, so the generator requires at least one to be present in the
// obfuscated input - and a surviving `throw` in the output, since dropping it would be a
// silent semantic change rather than a decode.
test('control-flow-flattening-dead-code-throw', () => {
  const tc = 'control-flow-flattening-dead-code-throw'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// A frozen real `{ controlFlowFlattening: 1, dispatcher: true }` sample of a single function.
// CFF stacked on Dispatcher leaves a memoized dispatcher-closure skeleton around the (already
// interpreter-decoded) body - a shared arg-slot outer var, a key->impl object, and the
// `(slot = [args], (1, disp)(key))` call-site convention. What pins this fixture is the
// *hand-off*: the CFF decode restores the dispatcher to its template shape, and `deDispatcher`
// - scheduled after it - then reverses the skeleton like any unflattened dispatcher, back to a
// plain `function(params){ body }` + direct call. It also pins the second
// `cleanupOrphanedCffHelpers` sweep, which is what removes the four CFF runtime helpers once
// that decode drops the template's references to them.
test('control-flow-flattening-dispatcher', () => {
  const tc = 'control-flow-flattening-dispatcher'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})
