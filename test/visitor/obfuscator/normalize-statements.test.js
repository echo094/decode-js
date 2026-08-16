import fs from 'fs'
import { join } from 'path'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { expectConsistentState } from '../../helper.js'
import normalizeStatements from '#visitor/obfuscator/normalize-statements'

const root = join(__dirname, 'normalize-statements')

// A private runner rather than `getVisitorResult`, for one reason only: that helper does
// `traverse(ast, visitor)` and `normalizeStatements` is a function taking the AST, not a visitor
// object. These cases also assert on the returned stats, which neither shared helper returns.
//
// What the private runner must NOT do is opt out of the state audit, which is exactly what it did
// until this import landed: it compared output text and nothing else, so the four visitors this
// pass composes shipped inflated reference counts straight through it.
function run(name) {
  const input = fs.readFileSync(join(root, `${name}.js`), 'utf-8')
  const ast = parse(input, { allowReturnOutsideFunction: true })
  const stats = normalizeStatements(ast)
  const expected = fs.readFileSync(join(root, `${name}.fix.js`), 'utf-8')
  expect(generate(ast).code).toBe(expected)
  expectConsistentState(ast, expected, { allowReturnOutsideFunction: true })
  return stats
}

/**
 * Real javascript-obfuscator 2.19.0 output for four source shapes that all reduce to the same
 * `if`/`else`, each landing the conditional in a different position:
 *
 *   plain   `c ? a() : b();`                 - already a statement
 *   inSeq   `p(), c ? a() : b(), q();`       - middle of a sequence
 *   inRet   `return x(), c ? a() : b();`     - last element of a sequence in a return
 *   outer   `t && (x(), c ? a() : b());`     - inside a sequence inside a `&&`
 *
 * `outer` is the one that forces the fixpoint: its sequence sits under a LogicalExpression,
 * where split-sequence.js cannot reach it, so the conditional is unreachable until the `&&`
 * has been reversed and the resulting branch re-braced.
 */
test('nested-encoder-output', () => {
  const stats = run('nested-encoder-output')

  // Four conditionals and one `&&`, so nothing was left packed.
  expect(stats.conditional).toBe(4)
  expect(stats.logical).toBe(1)

  // The point of the test: one round is not enough, and the loop terminates on its own well
  // inside the guard rather than by hitting it.
  expect(stats.rounds).toBeGreaterThan(1)
  expect(stats.cappedOut).toBe(false)
})
