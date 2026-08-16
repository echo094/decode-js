import fs from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import normalizeStatements from '#visitor/obfuscator/normalize-statements'
import decodeStringArray from '#visitor/obfuscator/string-array'

const root = join(__dirname, 'string-array')

/**
 * Every case is real javascript-obfuscator 2.19.0 output, and every `decoded` and `absent` case
 * was built from a case the *encoder's own* test suite asserts — each one's comment names the
 * variant it came from in `StringArrayTransformer.spec.ts` or
 * `StringArrayRotateFunctionTransformer.spec.ts`. That matters because a fixture pins a claim, and
 * cases invented to match what the pass happens to do pin the pass to itself.
 *
 * Three of the four outcomes are not failures, so only `decoded` has an obvious golden. The other
 * three assert a status **and** that the tree came through byte-identical, which is what
 * "resolve a matched structure completely or leave it entirely alone" means as a measurement.
 */
function run(name, options = {}) {
  const input = fs.readFileSync(join(root, `${name}.js`), 'utf-8')

  // The untouched baseline is the tree after normalization, not the raw input: U1 runs first and
  // does its job, so comparing against the raw bytes would report every non-`decoded` case as
  // mutated and be measuring the wrong pass.
  const only = parse(input, { allowReturnOutsideFunction: true })
  normalizeStatements(only)
  const baseline = generate(only).code

  const ast = parse(input, { allowReturnOutsideFunction: true })
  normalizeStatements(ast)
  const res = decodeStringArray(ast, options)
  return { res, code: generate(ast).code, baseline }
}

/** A `decoded` case: the golden is the whole assertion. */
function expectDecoded(name, sites) {
  const { res, code } = run(name)
  expect(res.status).toBe('decoded')
  expect(res.replaced).toBe(sites)
  expect(code).toBe(fs.readFileSync(join(root, `${name}.fix.js`), 'utf-8'))
  return res
}

/** Any other outcome: the status, and the tree provably untouched. */
function expectUntouched(name, status, options = {}) {
  const { res, code, baseline } = run(name, options)
  expect(res.status).toBe(status)
  expect(res.replaced).toBe(0)
  expect(code).toBe(baseline)
  return res
}

describe("decoded — claims taken from the encoder's own StringArrayTransformer.spec.ts", () => {
  // Variant #1: default behaviour.
  test('baseline', () => expectDecoded('baseline', 3))

  // Variant #3.2. The index arrives as a *string* literal, `w('0x0')` rather than `w(0x0)`, and
  // nothing in the corpus reaches this: `stringArrayIndexesType` appears only in the maximal
  // profile, whose array is starved by its own `splitStringsChunkLength` and so has no live call
  // site to spell either way.
  test('index-numeric-string', () => expectDecoded('index-numeric-string', 3))

  // Variant #3.3: both spellings in one sample, so a matcher that handles one type globally
  // rather than per site still passes the two cases above and fails here.
  test('index-mixed-types', () => expectDecoded('index-mixed-types', 5))

  // Variant #4.1. `stringArrayIndexShift` rewrites the wrapper to subtract a constant from every
  // index. Absorbed by evaluating the wrapper rather than modelled — which is the whole point of
  // the strategy, and, like the index type above, had no corpus cell with live call sites.
  test('index-shift', () => expectDecoded('index-shift', 5))

  // Variant #4.5: shift, rotation and shuffling at once. The shift is computed against an array
  // whose order the rotator has to restore first, so the three interact rather than stack.
  test('index-shift-rotate-shuffle', () =>
    expectDecoded('index-shift-rotate-shuffle', 5))

  // Variant #5: one array item, several call sites. Pins that the evaluation cache is keyed on
  // the call rather than on the site.
  test('same-literal-values', () => expectDecoded('same-literal-values', 4))

  // Variant #8. The rc4 body hangs a memo cache off the wrapper object and carries an inline
  // self-defending guard; neither may be read as a use site, and evaluating a call executes both.
  test('encoding-rc4', () => expectDecoded('encoding-rc4', 3))

  // Variant #11: two root wrappers, one per encoding, with **no** `none` wrapper — so there is no
  // plain fallback and every site has to reach the wrapper it was actually compiled against.
  test('encoding-base64-rc4', () => expectDecoded('encoding-base64-rc4', 10))

  // Variant #13, and it is the name trap in the encoder's own words. Under mangled names the root
  // wrapper is `b` and its parameters are `c` and `d`, which collide with a function declaration
  // and with an inner `var b; function b(){}` pair. Resolution goes through bindings; a matcher
  // holding the wrapper as a string decodes the wrong references here.
  test('calls-wrapper-name', () => expectDecoded('calls-wrapper-name', 1))

  // Variant #16.2. A computed object key becomes a call site in computed-member-key position —
  // the positive direction of the guard that `guard-rotator-removed` exercises negatively.
  test('object-computed-key', () => expectDecoded('object-computed-key', 5))

  // StringArrayRotateFunctionTransformer, "prevent early successful comparison": enough array
  // items that the rotator cannot succeed on its first trial rotation, so the checksum search
  // genuinely runs inside the isolate instead of terminating immediately.
  test('rotate-search', () => expectDecoded('rotate-search', 22))
})

/**
 * U3 - the per-scope calls wrapper. Every claim below is a describe() in the encoder's own
 * StringArrayScopeCallsWrapperTransformer.spec.ts, and each case names it.
 *
 * All of these were `unowned` before U3: U2 could not evaluate a call whose arguments are another
 * function's parameters, and could not delete machinery such a wrapper still calls.
 */
describe('scope calls wrappers — StringArrayScopeCallsWrapperTransformer.spec.ts', () => {
  // Variant #1.2: function scope. Four wrappers, two of them nested and forwarding to a
  // Program-scope wrapper rather than to the root, so this is already a two-hop chain.
  test('wrappers-function', () => expectDecoded('wrappers-function', 8))

  // Variant #6.1.1: `Mangled` identifier names generator. THE case the synthetic lifted names
  // exist for - mangled output reuses short names across sibling scopes, and every wrapper is
  // lifted into one flat isolate scope, so lifting them verbatim would let one definition win.
  test('scope-chained-mangled', () => expectDecoded('scope-chained-mangled', 9))

  // Variant #6.2.2: chained calls, advanced. Three levels deep, so a wrapper's upper is itself a
  // wrapper whose upper is a wrapper - membership cannot be settled in one pass.
  test('scope-chained-deep', () => expectDecoded('scope-chained-deep', 7))

  // Variant #7.1.2: `hexadecimal-numeric-string` indexes. The offset is a coercing STRING,
  // `param - '0x28b'`. Distinct from `index-numeric-string`, whose variable-form index is a bare
  // literal and so never exercises the coercion.
  test('scope-numeric-string-offset', () =>
    expectDecoded('scope-numeric-string-offset', 8))

  // Variant #7.3: no wrappers on a root scope. The chain bottoms out at the root *wrapper*, not
  // at a root-scope wrapper, which is the case a fixpoint seeded from the wrong end would miss.
  test('scope-no-root-wrappers', () =>
    expectDecoded('scope-no-root-wrappers', 5))

  // Variant #4: prevailing kind of variables. A `const` program gets `const` wrappers - no corpus
  // input is anything but `var`, so this shape has no other coverage.
  test('scope-prevailing-const', () =>
    expectDecoded('scope-prevailing-const', 8))

  // Variant #3.1: if statement scope is *prohibited*, so the read inside it routes to an
  // enclosing scope's wrapper. The callee is not declared in the call's own block.
  test('scope-prohibited-if', () => expectDecoded('scope-prohibited-if', 3))

  // Variant #2.4: a literal in a function default parameter, read in the enclosing scope rather
  // than the function body's.
  test('scope-default-parameter', () =>
    expectDecoded('scope-default-parameter', 5))
})

describe('absent — a verdict, not a failure', () => {
  // Variant #2. Obfuscated output with the option off. This is what the terminating round of a
  // peel loop reads, and it must not be confusable with a fingerprint miss.
  test('string-array-off', () => expectUntouched('string-array-off', 'absent'))

  // Variant #6: every literal below the encoder's three-character membership gate, so no array is
  // built at all.
  test('short-literal-value', () =>
    expectUntouched('short-literal-value', 'absent'))
})

describe('unowned — mine, readable, and a later unit owns the rest', () => {
  // **Deliberately empty for now.** `wrappers-function` used to live here: U2 could not decode
  // through a function-form scope wrapper, so it left the sample alone and said so. U3 resolves
  // that shape, and the case moved to `decoded` above.
  //
  // The outcome itself is NOT dead and must not be deleted with the last case that reached it -
  // `foreignWrappers` still fires for a function that calls the machinery with non-constant
  // arguments and is not a resolvable scope wrapper, which is what U5's control-flow storage
  // looks like. It has no committed case only because no fixture reaches it yet.
  test.todo('a construct a later unit owns — needs a U5-shaped case')
})

describe('unreadable — the refusal, kept narrow', () => {
  // A refusal path with no committed case is one a later refactor can silently delete, so each of
  // these damages a sample that decodes cleanly in exactly one way. **The note is asserted, not
  // just the status:** all five refusals report `unreadable`, so a case can land on somebody
  // else's guard and still look right. That is not hypothetical — a corrupted-array case once
  // terminated normally and was caught by the identifier check while claiming to test the timeout.

  // The rotator deleted. Nothing about the remaining shape says it should be there, so the array
  // is simply left rotated: every call site returns a real string from the wrong slot, and the
  // output parses, runs, and reads zero on every residue axis. The array items here are
  // deliberately not identifier-shaped, or the wrong strings would be plausible ones and the
  // guard would correctly stay silent.
  test('guard-rotator-removed', () => {
    const res = expectUntouched('guard-rotator-removed', 'unreadable')
    expect(
      res.notes.some((n) =>
        n.includes('computed-member-key position are not valid identifiers'),
      ),
    ).toBe(true)
  })

  // A checksum operand corrupted. The compare loop searches until a checksum over the array's own
  // contents matches, so it cannot terminate — which is what makes the timeout a correctness
  // instrument rather than a safety net. Two seconds here because ten in a committed suite is ten
  // nobody wants; the pass's own default is longer.
  test('guard-checksum-corrupted', () => {
    const res = expectUntouched('guard-checksum-corrupted', 'unreadable', {
      timeout: 2000,
    })
    expect(res.notes.some((n) => n.includes('did not evaluate'))).toBe(true)
  }, 20000)

  // An alias assigned without a declaration, so it is a global with no binding and its call sites
  // cannot be enumerated. Deleting the machinery here breaks the program rather than leaving
  // countable residue — decode-js#138's real sample needed exactly this hand-edited first.
  test('guard-alias-undeclared', () => {
    const res = expectUntouched('guard-alias-undeclared', 'unreadable')
    expect(res.notes.some((n) => n.includes('have no binding'))).toBe(true)
  })

  // A read of the array from outside the machinery. The wrapper's call sites are enumerated
  // exhaustively but the holder is a separate binding, so without this gate the array would be
  // deleted out from under a program that indexes it directly.
  test('guard-array-read-outside', () => {
    const res = expectUntouched('guard-array-read-outside', 'unreadable')
    expect(res.notes.some((n) => n.includes('is read from'))).toBe(true)
  })

  // Evidence present, entrypoint unresolvable. This is the detection-time refusal, and keeping it
  // distinct from `absent` is the distinction the existing plugin collapses into one message.
  test('guard-wrapper-removed', () => {
    const res = expectUntouched('guard-wrapper-removed', 'unreadable')
    expect(
      res.notes.some((n) => n.includes('the entrypoint did not resolve')),
    ).toBe(true)
  })
})

describe('one run, one layer', () => {
  /**
   * The only case in the suite that pins the layer boundary, which is where the corruption class
   * lives: a pass that mutates the layer beneath it produces damage that is loud only when it
   * happens to throw, where an unmatched inner layer is residue anyone can count.
   *
   * The input is encoded twice at 2.19.0 with different seeds. The expected output is **derivable
   * rather than merely observed**: the second encode's input was the first encode's output, so
   * peeling layer 2 has to reproduce that input — up to what layer 2 destroyed (local identifier
   * names) and what our own normalization reprinted. So the assertions below are structural and
   * behavioural, not byte equality against the separately-built single-encode.
   */
  test('nested-one-layer', () => {
    const res = expectDecoded('nested-one-layer', 21)
    expect(res.removed.holder).toBe(1)

    // 1. What comes back is an ordinary single-encode: running the pass again finds a whole
    //    string-array subsystem and decodes it. A peel that had corrupted the inner layer would
    //    fail here, where a size- or residue-based check could easily pass.
    const peeled = fs.readFileSync(
      join(root, 'nested-one-layer.fix.js'),
      'utf-8',
    )
    const second = parse(peeled, { allowReturnOutsideFunction: true })
    normalizeStatements(second)
    const res2 = decodeStringArray(second)
    expect(res2.status).toBe('decoded')

    // 2. And one further run reaches the source: the literals the original program was written
    //    with are back, as literals.
    const final = generate(second).code
    const src = fs.readFileSync(join(root, 'nested-one-layer.src.js'), 'utf-8')
    for (const literal of src.match(/'[^']+'/g) || []) {
      const value = literal.slice(1, -1)
      if (value.length < 3 || value === '\\n') continue
      expect(final).toContain(JSON.stringify(value))
    }
  })
})
