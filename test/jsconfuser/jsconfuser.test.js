import { join } from 'path'
import { test } from 'vitest'
import { getPluginResult } from '../helper.js'
import PluginJsconfuser from '#plugin/jsconfuser.js'

const root = __dirname

test('rgf-flatten', () => {
  const tc = 'rgf-flatten'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

test('dead-code-opaque-predicates', () => {
  const tc = 'dead-code-opaque-predicates'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// A `high`-preset encode, and the first fixture that pins StringConcealing's dependency
// cleanup across stage boundaries. Its sweeps are reference-count-gated and both ran while
// the base91 decode function's `return bufferToString(...)` still referenced the whole
// getGlobal/TextDecoder/utf8 chain; DeadCode's second visit removes that reference two
// stages later, so before the late cleanup slot the chain survived at zero references -
// 2098B of a 2238B decode, from a 75B source. No visitor-level test can catch this: the
// defect is in which pool the plugin hands each slot, not in any matcher.
//
// The expected output is 89B against a 75B source. What separates them is exactly two
// documented residues and nothing else - RenameVariables (irreversible by design) and the
// CFF decode's split `var x;` + `x = v` (checkpoint 6.4). When 6.4 lands this fixture is
// one of the things that should change, to `var adGeota = true;`.
test('high-string-runtime-cleanup', () => {
  const tc = 'high-string-runtime-cleanup'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// A `high`-preset encode, and what pins Calculator's *second* visit. At its own early slot
// the dispatch function is still sealed inside the ControlFlowFlattening interpreter, so
// that pass matches nothing - and the CFF decode then hands the function back as
// `f = function (…) {…}`, which a `FunctionDeclaration`-keyed visitor cannot see either.
// Both halves are needed: the second visit must also sit *after* the constant fold, because
// StringSplitting leaves each case test as a concatenation until then. Expected output is
// 74B against a 50B source, the two documented residues apart (RenameVariables, and the CFF
// decode's split `var x;` + `x = v` - checkpoint 6.4).
test('high-calculator-post-cff', () => {
  const tc = 'high-calculator-post-cff'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

test('calculator-string-concealing', () => {
  const tc = 'calculator-string-concealing'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

test('duplicate-literal-calculator', () => {
  const tc = 'duplicate-literal-calculator'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

test('duplicate-literal-string-concealing', () => {
  const tc = 'duplicate-literal-string-concealing'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

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

// hexadecimalNumbers + stringEncoding (Finalizer, order 35): both just re-escape a
// literal's raw source text without changing its parsed value, but Babel's generator
// prefers node.extra.raw over the value when present, so a plain re-parse/re-generate
// would otherwise print the hex/escaped form back out unchanged - deleteExtra strips
// that raw text so the generator falls back to plain-value printing.
test('finalizer', () => {
  const tc = 'finalizer'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// lock.domainLock + stringConcealing: a real encoder sample (target: node,
// { lock: { domainLock: [...] }, stringConcealing: true }) with two domainLock
// guards - one at Program level, one inside the function body, per lock.ts's
// per-block Block:exit placement - both wrapping a StringConcealed regex
// literal. Confirms lock.js's late pipeline position (after
// string-concealing.js) still recognizes the guard shape once its REGEX
// argument is a resolved string literal rather than a concealed call site.
test('domain-lock-string-concealing', () => {
  const tc = 'domain-lock-string-concealing'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// rgf + preserveFunctionLength: a real encoder sample (target: node, { rgf:
// true, preserveFunctionLength: true }) where RGF shrinks the transformed
// function to a zero-param stub and preserveFunctionLength wraps it in
// {ph}_fnLength(fn, length). Confirms function-length.js's hasRestParam guard
// (see variable-masking.md's Known gaps) lets the wrapper strip cleanly
// without crashing on the rest-param-less target, and RGF's own decode still
// finds the call-site shape underneath.
test('rgf-function-length', () => {
  const tc = 'rgf-function-length'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// flatten + preserveFunctionLength: a real encoder sample (target: node, {
// flatten: true, preserveFunctionLength: true }) where Flatten's rest-param
// wrapper has its length preserved via the same {ph}_fnLength(fn, length)
// call. Here the target DOES have a rest param, so function-length.js hands
// off to processStackParam, which resolves the wrapper's real param count.
test('flatten-function-length', () => {
  const tc = 'flatten-function-length'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// The string stack: stringConcealing + stringEncoding + stringSplitting together. No source
// string survives verbatim in the input (checked: the concealed table is one literal over 100
// chars, splitting leaves 7 concatenations, and the concealing runtime's array["slice"] is
// present), and the decode returns every one of them.
//
// The cleanest decode of the four whole-pipeline combos, and worth knowing why: with no CFF
// or MovedDeclarations in the config nothing splits a declaration, so `var x = "..."` comes
// back whole. What separates it from its source is renaming and the computed member spelling
// (preparation.md's Known Gaps) - nothing else.
test('string-stack', () => {
  const tc = 'string-stack'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})

// pack over a genuinely multi-transform payload (dispatcher + stringConcealing +
// variableMasking + stringSplitting). The input is a single top-level statement - the whole
// program sits inside one Function-constructor argument - and the decode unwraps it and drives
// the payload's own transforms to zero. The trailing-return + Function-constructor unwrap had
// only a unit test before this.
//
// Deliberately not combined with controlFlowFlattening: that costs 323KB against 8KB here for
// the same pack coverage, and the CFF interaction is already pinned by cff-dispatcher-masking.
test('pack-payload', () => {
  const tc = 'pack-payload'
  getPluginResult(PluginJsconfuser, true, join(root, tc))
})
