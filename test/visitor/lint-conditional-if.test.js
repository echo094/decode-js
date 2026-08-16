import fs from 'fs'
import { join } from 'path'
import { test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import {
  getVisitorResult as getResult,
  expectConsistentState,
} from '../helper.js'
import lintConditionalIf from '#visitor/atomic/lint-conditional-if'

const root = join(__dirname, 'lint-conditional-if')

// The `-valid` cases are the shapes javascript-obfuscator's IfStatementSimplifyTransformer
// emits; the `-invalid` ones are every position where a conditional carries a value rather
// than a branch, and must come back byte-identical.

test('statement-valid', () => {
  getResult(lintConditionalIf, true, join(root, 'statement-valid'))
})

test('return-valid', () => {
  getResult(lintConditionalIf, true, join(root, 'return-valid'))
})

// Babel requeues a replaced node, so the inner conditional - value position while the outer
// still existed - becomes convertible in the same traversal once the outer is an `if`.
test('nested-consequent-valid', () => {
  getResult(lintConditionalIf, true, join(root, 'nested-consequent-valid'))
})

test('declarator-invalid', () => {
  getResult(lintConditionalIf, false, join(root, 'declarator-invalid'))
})

test('argument-invalid', () => {
  getResult(lintConditionalIf, false, join(root, 'argument-invalid'))
})

test('arrow-body-invalid', () => {
  getResult(lintConditionalIf, false, join(root, 'arrow-body-invalid'))
})

test('operand-invalid', () => {
  getResult(lintConditionalIf, false, join(root, 'operand-invalid'))
})

test('property-invalid', () => {
  getResult(lintConditionalIf, false, join(root, 'property-invalid'))
})

// The cases above use unbound globals, so `scope.bindings` is empty and the helper's
// reference-state check compares two empty lists - they pin the output text and nothing else.
// These two bind `x` and reference it inside both branches, so that check has something to
// compare and the rewrite is exercised against real bindings rather than free names.
//
// **They do not reproduce the duplicated-reference defect this visitor had**, and that is worth
// stating rather than leaving implied. On real obfuscator output the pre-fix visitor duplicated
// seven references of one heavily-referenced function-local var; six hand-built shapes were tried
// against the pre-fix visitor - program-scope binding, function-local var, return form, many
// references, nested block, and a parameter - and none of them duplicated anything. Whatever the
// trigger is, it is not reachable from a fixture this size. Closing that gap needs a case
// harvested from real output, which is W7's point about isolated fixtures omitting exactly what
// breaks a matcher on combined output.
test('bound-statement-valid', () => {
  const tc = 'bound-statement-valid'
  getResult(lintConditionalIf, true, join(root, tc))
})

test('bound-return-valid', () => {
  const tc = 'bound-return-valid'
  getResult(lintConditionalIf, true, join(root, tc))
})

// A case harvested from real javascript-obfuscator output rather than built, because the trigger
// for this visitor's own reference duplication is NOT reproducible by hand: six shapes were tried
// against the pre-fix visitor - program-scope binding, function-local var, return form, many
// references, nested block, parameter - and a scale sweep to 200 references, all reading zero.
// Deleting any single statement from this function also kills it. Whatever the trigger is, this is
// currently the smallest thing known to exhibit it.
//
// **No `.fix.js`, deliberately.** The input is eleven kilobytes of generated identifiers, so a
// golden could not be honestly reviewed, and an unreviewed golden is worse than none because exact
// string equality makes it look authoritative. What this pins is the state invariant instead,
// compared against a fresh parse of the visitor's own output - which is the claim being made about
// this case and needs no expected text.
test('real-output-state', () => {
  const input = fs.readFileSync(join(root, 'real-output-state.js'), 'utf-8')
  const ast = parse(input, {
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  })
  traverse(ast, lintConditionalIf)
  expectConsistentState(ast, undefined, {
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  })
})
