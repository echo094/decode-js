import fs from 'fs'
import vm from 'node:vm'
import { join } from 'path'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import unlockEnv from '#visitor/obfuscator/unlock-env'
import plugin from '#plugin/obfuscatorx'
import deleteExtra from '#visitor/delete-extra'
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
  const ast = parse(input, {
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  })
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
  const untouched = generate(
    parse(input, { errorRecovery: true, allowReturnOutsideFunction: true }),
    { comments: false },
  ).code
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

/**
 * Exact 5.4.5 output adds the newline bail before the existing search chain. The compact raw
 * fixture is kept because this boundary is an encoder spelling, not a hand-built approximation;
 * the `.src.js` sibling records the source used by the focused encoder run.
 */
test('self-defending, 5.4.5 newline bail', () => {
  expectFixedTrimmed('self-defending-newline-bail')
})

/**
 * Browser-no-eval's older self-defending helper resolves RegExp through its target-specific global
 * fallback. The nested-function classifier must still identify it after that producer spelling.
 */
test('browser-no-eval self-defending, the older global fallback form', () => {
  expectFixedTrimmed('browser-no-eval-self-defending')
})

test('console output disabler', () => {
  expectFixed('console-output')
})

/**
 * Current browser-no-eval console suppression shares GlobalVariableNoEvalTemplate with the
 * interval helper, but its method-list guard is the consumer-specific shape. This exact 5.5.0
 * output proves that both the guard/controller and the resolver are removed while the program call
 * survives the binding-state consistency audit.
 */
test('browser-no-eval console output disabler', () => {
  expectFixedTrimmed('browser-no-eval-console')
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
 * Browser-no-eval uses the exact window/process/require/global fallback and a literal debugger
 * body. The producer also merges the wrapper with the program's console effect, so this asserts
 * both target-specific removal and effect preservation.
 */
test('debug protection with the browser-no-eval resolver and literal debugger', () => {
  expectFixedTrimmed('browser-no-eval-debugger')
})

test('declines a browser-no-eval resolver with an altered host test', () => {
  expectFixedTrimmed('browser-no-eval-decline-condition')
})

test('domain lock with the nested ordinary resolver', () => {
  expectFixedTrimmed('domain-lock-5.4.1')
})

test('domain lock with the browser-no-eval resolver', () => {
  expectFixedTrimmed('domain-lock-browser-no-eval')
})

test('domain lock direct visitor and fresh plugin runs agree', () => {
  const normalize = (code) => {
    const ast = parse(code, {
      errorRecovery: true,
      allowReturnOutsideFunction: true,
    })
    traverse(ast, deleteExtra)
    return generate(ast, { comments: false }).code
  }
  for (const name of ['domain-lock-5.4.1', 'domain-lock-browser-no-eval']) {
    const input = fs.readFileSync(join(root, `${name}.js`), 'utf-8')
    expect(normalize(plugin(input))).toBe(normalize(run(name)))
    expect(normalize(plugin(input))).toBe(normalize(run(name)))
  }
})

test('domain lock preserves a payload fused with its trigger', () => {
  const input = fs
    .readFileSync(join(root, 'domain-lock-browser-no-eval.js'), 'utf-8')
    .replace(
      "_0x34b715();console.log('payload');",
      "_0x34b715(),console.log('payload');",
    )
  const ast = parse(input, {
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  })
  unlockEnv(ast)
  expectConsistentState(ast)
  expect(generate(ast, { comments: false }).code.trim()).toBe(
    fs
      .readFileSync(join(root, 'domain-lock-browser-no-eval.fix.js'), 'utf-8')
      .trim(),
  )
})

test('domain-like near miss cannot fall through to the RegExp debugger heuristic', () => {
  const input = fs
    .readFileSync(join(root, 'domain-lock-5.4.1.js'), 'utf-8')
    .replace(".split(';')", ".join(';')")
  const ast = parse(input, {
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  })
  const before = generate(ast, { comments: false }).code
  unlockEnv(ast)
  expectConsistentState(ast)
  expect(generate(ast, { comments: false }).code).toBe(before)
})

test('domain lock declines when its calls controller has another owner', () => {
  const input =
    fs.readFileSync(join(root, 'domain-lock-browser-no-eval.js'), 'utf-8') +
    ';void _0x54ea66;'
  const ast = parse(input, {
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  })
  const before = generate(ast, { comments: false }).code
  unlockEnv(ast)
  expectConsistentState(ast)
  expect(generate(ast, { comments: false }).code).toBe(before)
})

test('domain lock raw and decoded behavior under a Node-hosted location model', () => {
  const raw = fs.readFileSync(join(root, 'domain-lock-5.4.1.js'), 'utf-8')
  const fixed = fs.readFileSync(join(root, 'domain-lock-5.4.1.fix.js'), 'utf-8')
  const execute = (code, host) => {
    const output = []
    const context = {
      console: { log: (value) => output.push(value) },
      document: { domain: host, location: { hostname: host } },
    }
    context.window = context
    vm.runInNewContext(code, context)
    return { location: context.document.location, output }
  }

  expect(execute(raw, 'sub.example.com').output).toEqual(['match'])
  expect(execute(raw, 'off.example.net')).toEqual({
    location: 'about:blank',
    output: ['redirect'],
  })
  expect(execute(fixed, 'sub.example.com').output).toEqual(['match'])
  expect(execute(fixed, 'off.example.net').output).toEqual(['match'])
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
