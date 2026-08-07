import fs from 'fs'
import { join } from 'path'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { describe, expect, test } from 'vitest'
import PluginJsconfuser from '#plugin/jsconfuser.js'

// Structural acceptance test for `collapseInlineFlattenedFunction` - the step that folds away
// the call harness `decodeInlineFlattenedFunction` leaves standing (checkpoint open item #5 /
// Issue B). `decodeInlineFlattenedFunction` alone already produced runtime-correct output, so
// runtime-correctness cannot tell the two apart; what the collapse changes is *readability*,
// and these are the properties that measure it:
//
//   - no surviving `<name> = function (...rest) { [states, scope, ...] = rest; ... }`
//     interpreter wrapper, and so no ~100-element entry vector at its call site;
//   - no completion-flag dance (`flag = undefined; result = (1, fn)([...]); if (flag) ...`);
//   - no Program-level `_cff_slice`/`_cff_sequence` helpers - those are only alive *because*
//     the entry vector referenced them, which is why an orphaned CFF helper is a symptom of
//     this residue rather than a defect of `cleanupOrphanedCffHelpers`.
//
// Deliberately shares the frozen sample the plugin-level fixture already uses rather than
// committing a second 22KB copy of the same obfuscation. That fixture pins the exact expected
// bytes; this pins the intent, so a future change that keeps the file small by some other
// route still has to satisfy the same structural bar.
const samplePath = join(
  __dirname,
  '..',
  '..',
  'jsconfuser',
  'control-flow-flattening-minify-return.js',
)
const rawCode = fs.readFileSync(samplePath, { encoding: 'utf-8' })

// A CFF inline-flattened interpreter wrapper: exactly one rest parameter, whose value is
// destructured into the fixed `[states, scope, runtime, arg]` local list.
function countInterpreterWrappers(ast) {
  let found = 0
  traverse(ast, {
    Function(path) {
      const params = path.get('params')
      if (params.length !== 1 || !params[0].isRestElement()) {
        return
      }
      const restName = params[0].node.argument.name
      const body = path.get('body')
      if (!body.isBlockStatement()) {
        return
      }
      for (const stmt of body.get('body')) {
        if (!stmt.isExpressionStatement()) {
          continue
        }
        const expr = stmt.get('expression')
        if (
          expr.isAssignmentExpression({ operator: '=' }) &&
          expr.get('left').isArrayPattern() &&
          expr.get('right').isIdentifier({ name: restName }) &&
          expr.node.left.elements.length >= 3
        ) {
          found++
          return
        }
      }
    },
  })
  return found
}

function runCapturingLogs(code) {
  const logs = []
  new Function('console', code)({ log: (...args) => logs.push(args.join(' ')) })
  return logs
}

describe('inline-flattened CFF call-harness collapse (issue B)', () => {
  const decoded = PluginJsconfuser(rawCode)

  // No "before" count to compare against: the wrapper shape only exists *mid-decode*, after
  // the earlier plugin stages normalize the raw output into it, so the raw file legitimately
  // contains none. The `_cff_slice` check below is what keeps this from being vacuous.
  test('no interpreter wrapper survives the decode', () => {
    expect(countInterpreterWrappers(parse(decoded))).toBe(0)
  })

  test('the CFF entry-vector helpers are no longer referenced, so they are removed', () => {
    expect(rawCode).toMatch(/_cff_slice\b/)
    expect(decoded).not.toMatch(/_cff_slice\b/)
    expect(decoded).not.toMatch(/_cff_sequence\b/)
  })

  test('the collapsed output still produces the original result', () => {
    expect(runCapturingLogs(decoded)).toEqual(runCapturingLogs(rawCode))
  })
})
