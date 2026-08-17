import fs from 'fs'
import { join } from 'path'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import unlockEnv from '#visitor/obfuscator/unlock-env'
import { expectConsistentState } from '../../helper.js'

const root = join(__dirname, 'unlock-env')

/**
 * The removing cases are real javascript-obfuscator output carried through the same passes that
 * run ahead of this one, so each `.js` is what `unlock-env` actually receives rather than raw
 * encoder output. Their goldens were written by a builder that refuses unless the golden **runs**
 * and reproduces the pre-obfuscation source's output, which is the check that separates "stripped"
 * from "deleted too much" - a residue count cannot tell those apart, since both drive it to zero.
 *
 * The two source shapes come from upstream's own `SelfDefendingCodeHelper` spec, whose two
 * variants are "appended inside global scope" and "appended inside function scope". That is
 * exactly the placement axis this pass has to handle, and taking it from upstream keeps it an
 * authoritative case list rather than one we invented.
 *
 * **The builder never runs the fixture input**, only the source and the golden. An input still
 * carrying debug protection has been re-spelled by our own pipeline, which is what its tampering
 * branch tests for, and that branch is an unbounded loop by design.
 */
function run(name) {
  const input = fs.readFileSync(join(root, `${name}.js`), 'utf-8')
  const ast = parse(input, { errorRecovery: true, allowReturnOutsideFunction: true })
  unlockEnv(ast)
  expectConsistentState(ast)
  return generate(ast, { comments: false }).code
}

function expectFixed(name) {
  expect(run(name)).toBe(fs.readFileSync(join(root, `${name}.fix.js`), 'utf-8'))
}

// New files are kept editable by the repository patch tool, which terminates text files with a
// newline; generator output intentionally has none. Keep this normalization local to those
// fixtures rather than weakening the existing exact-text checks.
function expectFixedTrimmed(name) {
  expect(run(name)).toBe(
    fs.readFileSync(join(root, `${name}.fix.js`), 'utf-8').trimEnd(),
  )
}

/**
 * A decline is asserted against a re-generation of the input, not against the input text: the
 * comparison has to be "did the tree move", and printing normalises formatting that was never the
 * subject. A count of zero removals would not be enough on its own - it says the pass reported no
 * change, not that it made none, and mutate-then-decline is the failure this pass's match-then-
 * mutate structure exists to rule out.
 */
function expectDeclined(name) {
  const input = fs.readFileSync(join(root, `${name}.js`), 'utf-8')
  const untouched = generate(parse(input, { errorRecovery: true, allowReturnOutsideFunction: true }), { comments: false }).code
  expect(run(name)).toBe(untouched)
}

// --- the two placement variants, which are upstream's own two spec cases -----------------------
test('self-defending, helpers at program level (empty calls graph)', () => {
  expectFixed('self-defending-global')
})

test('self-defending, helpers inside the callee (non-empty calls graph)', () => {
  expectFixed('self-defending-function')
})

/**
 * The era below `E-selfdef-search`, whose callback declares a nested function and tests a regexp
 * built through `constructor` instead of returning a `search` chain. Without this case the pass
 * would be pinned at one era while claiming both, which is the gap an era column on a fixture
 * table exists to expose.
 */
test('self-defending, the regexp era', () => {
  expectFixed('self-defending-regexp-era')
})

test('console output disabler', () => {
  expectFixed('console-output')
})

test('debug protection', () => {
  expectFixed('debug-protection')
})

/**
 * The interval form fires the protection function from a `setInterval` rather than from a guard,
 * so it is the one reference that is not inside a callback being removed - and the case that
 * fails if the pass reads the protection function's bindings without re-crawling after the guards
 * are gone. That defect was real and this is what pins the fix.
 */
test('debug protection with its interval', () => {
  expectFixed('debug-protection-interval')
})

test('debug protection with a member-qualified interval', () => {
  expectFixed('debug-protection-interval-member')
})

/**
 * The direct initialized-holder template is the service-worker producer's 4.1.0+ resolver. The
 * input is the smallest slice retained from the exact 4.1.0 seed-41001 pre-unlock stage: its
 * holder conditional, member interval, protection function, and observable program effect.
 */
test('debug protection with the service-worker global resolver', () => {
  expectFixedTrimmed('debug-protection-interval-member-service-worker')
})

test('debug protection with the transformed inline global resolver', () => {
  expectFixedTrimmed('debug-protection-interval-member-inline')
})

/**
 * The inline resolver is only a larger removal target. Nearby wrappers still lose their own
 * recognised interval and protection, but their wrapper must remain when its exact local shape is
 * not proved. These hand-built cases exercise that match-before-mutate boundary.
 */
test('declines the inline resolver wrapper with an extra effect', () => {
  expectFixedTrimmed('decline-inline-resolver-extra-effect')
})

test('declines the inline resolver with an altered Function signature', () => {
  expectFixedTrimmed('decline-inline-resolver-signature')
})

/**
 * The interval fused into a sequence expression with the program's own calls - the encoder's
 * adjacent-statement merging does this and does not care whose statements it merges.
 *
 * Hand-built rather than harvested, deliberately: the fusion only survives to this pass when
 * `normalize-statements` has not run, which is not a shipped configuration, so no corpus cell
 * carries it. It is exactly the case W7 says to build by hand - one where the pass **corrupts
 * instead of declining**. Removing the enclosing statement here deleted two program writes and
 * left a program that ran, printed nothing and threw nothing; a residue census cannot see that,
 * because the residue went down.
 */
test('debug protection whose interval is fused into a sequence', () => {
  expectFixed('interval-fused-sequence')
})

/**
 * Two protections in one sample, which the encoder emits as two independent calls controllers.
 * A pass that treated the controller as a singleton would leave one of them behind.
 */
test('two protections, two controllers', () => {
  expectFixed('two-protections')
})

// --- declines: shapes stock output cannot produce, so they can only be hand-built --------------
test('declines a controller carrying two guards', () => {
  expectDeclined('decline-two-guards')
})

test('declines a controller the program itself still calls', () => {
  expectDeclined('decline-controller-used-elsewhere')
})

test('declines a guard whose callback matches no known protection', () => {
  expectDeclined('decline-unrecognised-guard')
})

test('declines a member call with a non-interval property', () => {
  expectDeclined('decline-member-non-interval')
})

test('declines a member call with a dynamic property', () => {
  expectDeclined('decline-member-dynamic-property')
})

test('declines a member interval when the protection has another reference', () => {
  expectDeclined('decline-member-with-other-reference')
})

test('declines a service-worker resolver with an altered condition', () => {
  expectFixedTrimmed('decline-service-worker-resolver-condition')
})

test('declines a service-worker resolver with another holder reference', () => {
  expectFixedTrimmed('decline-service-worker-holder-reference')
})

test('declines a service-worker resolver with a non-static member', () => {
  expectDeclined('decline-service-worker-non-static-member')
})
