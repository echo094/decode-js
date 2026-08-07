import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { describe, expect, test } from 'vitest'
import dePack from '#visitor/jsconfuser/pack.js'

// Pack ships the real program as a string passed through the `Function`
// constructor: `Function(objName, outputCode)(objectLiteral)`. Because that
// string becomes a function *body*, the encoder (pack.ts finalASTHandler)
// rewrites the program's last ExpressionStatement into a `return <expr>` so the
// wrapper's completion value is preserved. dePack unwraps the string back into
// the program body; the regression here is that the trailing top-level `return`
// must be turned back into an ExpressionStatement, otherwise the decoded output
// is not a valid standalone script.

function run(code) {
  const ast = parse(code)
  return generate(dePack(ast)).code
}

// Assert the decoded output is a legal top-level *script* (a stray `return`
// outside a function would throw here).
function expectValidScript(code) {
  expect(() => parse(code, { sourceType: 'script' })).not.toThrow()
}

describe('dePack', () => {
  test('trailing return becomes an expression statement', () => {
    const enc =
      'Function("o","const a=10;const b=20;return console[\\"log\\"](a+b);")({});'
    const out = run(enc)
    expect(out).toBe(
      ['const a = 10;', 'const b = 20;', 'console["log"](a + b);'].join('\n')
    )
    expectValidScript(out)
  })

  test('bare trailing return is dropped', () => {
    const enc = 'Function("o","const a=1;return;")({});'
    const out = run(enc)
    expect(out).toBe('const a = 1;')
    expectValidScript(out)
  })

  test('no trailing return is left untouched', () => {
    const enc = 'Function("o","const a=1;function f(){return a;}")({});'
    const out = run(enc)
    expect(out).toBe(
      ['const a = 1;', 'function f() {', '  return a;', '}'].join('\n')
    )
    expectValidScript(out)
  })

  test('property mappings are substituted, then trailing return reversed', () => {
    // objName["p"] getter -> real identifier `x`; trailing return -> expr stmt.
    const enc =
      'Function("o","return o[\\"p\\"] + 1;")({ get "p"() { return x; } });'
    const out = run(enc)
    expect(out).toBe('x + 1;')
    expectValidScript(out)
  })

  test('non-pack program is returned unchanged', () => {
    const src = 'const a = 1;\nconsole.log(a);'
    expect(run(src)).toBe(src)
  })
})
