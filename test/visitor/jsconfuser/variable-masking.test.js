import { join } from 'path'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { getVisitorResult as getResult } from '../../helper.js'
import deVariableMasking, {
  processStackParam,
} from '#visitor/jsconfuser/variable-masking'

const root = join(__dirname, 'variable-masking')

test('params-only-predictable', () => {
  const tc = 'params-only-predictable'
  getResult(deVariableMasking, false, join(root, tc))
})

test('alias-of-param-predictable', () => {
  const tc = 'alias-of-param-predictable'
  getResult(deVariableMasking, true, join(root, tc))
})

test('alias-of-param-with-truncation', () => {
  const tc = 'alias-of-param-with-truncation'
  getResult(deVariableMasking, true, join(root, tc))
})

// The copy arriving as `var stk;` + `[...stk] = rest;` rather than as one initialized
// declarator - what control-flow-graph.js reconstructs. Un-masking removes the copy, which
// is what makes the declaration dead, so the declaration has to go with it: left standing
// it is a bare zero-reference `var` at the head of every reconstructed masked function.
test('alias-copy-declaration', () => {
  const tc = 'alias-copy-declaration'
  getResult(deVariableMasking, true, join(root, tc))
})

// `var b = a; a = a + 1; return b;` - the alias cannot be *folded* onto the param's slot
// (it would read the post-reassignment value), and used to stay masked forever for that
// reason. Un-masking renames rather than folds, so the same function now comes out fully
// readable with the aliasing left exactly where it was.
test('alias-of-reassigned-param-guard', () => {
  const tc = 'alias-of-reassigned-param-guard'
  getResult(deVariableMasking, true, join(root, tc))
})

test('alias-of-local-literal', () => {
  const tc = 'alias-of-local-literal'
  getResult(deVariableMasking, true, join(root, tc))
})

test('negative-key-alias', () => {
  const tc = 'negative-key-alias'
  getResult(deVariableMasking, true, join(root, tc))
})

test('dynamic-local-value', () => {
  const tc = 'dynamic-local-value'
  getResult(deVariableMasking, true, join(root, tc))
})

test('array-pattern-locals', () => {
  const tc = 'array-pattern-locals'
  getResult(deVariableMasking, true, join(root, tc))
})

// A *nested* element in the fully-folded prologue - `[flatObject, [a, b]] = rest`, which is
// what control-flow-graph.js emits for a function whose original parameter list had a pattern
// in it. The element moves into the parameter list unchanged: same destructuring, one step
// earlier. Declining it left every such function rest-masked, which is what checkpoint 6.3(b)
// was, one consumer down.
test('folded-nested-pattern', () => {
  const tc = 'folded-nested-pattern'
  getResult(deVariableMasking, true, join(root, tc))
})

test('binary-expr-local-value', () => {
  const tc = 'binary-expr-local-value'
  getResult(deVariableMasking, true, join(root, tc))
})

// Un-masking is only equivalent while the stack array is never observable as a value, so
// each of these leaves the function masked rather than half-rewritten.
test('unmask-bare-stack-use', () => {
  const tc = 'unmask-bare-stack-use'
  getResult(deVariableMasking, false, join(root, tc))
})

test('unmask-dynamic-key', () => {
  const tc = 'unmask-dynamic-key'
  getResult(deVariableMasking, false, join(root, tc))
})

test('unmask-arguments', () => {
  const tc = 'unmask-arguments'
  getResult(deVariableMasking, false, join(root, tc))
})

// A slot written inside an `if` and updated with `++` is `invalid` for every folding rule
// in this file and used to stay a raw `stk[key]` forever. Renaming it needs none of those
// rules, so it comes out as an ordinary local.
test('unmask-nested-scope-slot', () => {
  const tc = 'unmask-nested-scope-slot'
  getResult(deVariableMasking, true, join(root, tc))
})

// Regression: processStackParam must not crash on an anonymous
// FunctionDeclaration (`id === null`), e.g. an `export default function () {}`,
// or one Babel left id-less mid-pipeline. The bug was a `path.node.id.name`
// deref in the else-branch debug log. This shape needs module-mode parsing and
// a caller-supplied `len`, so it targets the exported helper directly rather
// than the script-mode fixture-pair helper.
test('anonymous-fn-decl-no-crash', () => {
  const src = 'export default function (..._vm) {\n  return _vm[0] + _vm[1];\n}'
  const ast = parse(src, { sourceType: 'module' })
  let fnPath
  traverse(ast, {
    FunctionDeclaration(path) {
      fnPath = path
      path.stop()
    },
  })
  expect(fnPath.node.id).toBeNull()
  expect(() => processStackParam(fnPath, 2)).not.toThrow()
  expect(generate(ast).code).toBe(src)
})
