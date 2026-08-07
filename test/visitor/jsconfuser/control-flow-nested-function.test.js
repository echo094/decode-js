import fs from 'fs'
import { join } from 'path'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as t from '@babel/types'
import { expect, test } from 'vitest'
import controlFlow from '#visitor/jsconfuser/control-flow-graph.js'

// `nested-function-sample.js` is one frozen, real `js-confuser` `dist/` obfuscation of:
//
//   function target(a, b) {
//     function helper(x, y) {
//       var sum = x + y + a;
//       return sum;
//     }
//     var r = helper(a, b);
//     return r + b;
//   }
//   console.log(target(3, 4));
//
// with only `controlFlowFlattening: true` enabled (`target: "node"`) - captured once
// (CFF's output is randomized per run, no seed option) rather than regenerated, matching
// `control-flow-graph/real-sample.js`'s precedent. `helper` gets outlined into the *same*
// shared switch/case table as `target` itself (one `mainFnName` per CFF application, not
// per outlined function - see the encoder skill doc). Running the file directly prints
// `14` (`helper(3,4) = 3+4+3 = 10`, `r + b = 10+4 = 14`).
const samplePath = join(
  __dirname,
  'control-flow-graph',
  'nested-function-sample.js',
)

test('decodeFlattenedFunction: recovers an outlined nested function from a real obfuscated sample', () => {
  const code = fs.readFileSync(samplePath, { encoding: 'utf-8' })
  const ast = parse(code)

  let mainFnPath
  let sequence
  let sliceFnName
  let xorFnName
  let stringsBlob
  let startCallPath

  traverse(ast, {
    VariableDeclarator(path) {
      const id = path.get('id')
      if (id.isIdentifier() && id.node.name.endsWith('_cff_sequence')) {
        sequence = path.node.init.elements.map((el) =>
          el.type === 'UnaryExpression' ? -el.argument.value : el.value,
        )
      }
      if (id.isIdentifier() && id.node.name.endsWith('_strings')) {
        stringsBlob = path.node.init.value
      }
    },
    FunctionDeclaration(path) {
      if (path.node.id?.name.endsWith('_cff_slice')) {
        sliceFnName = path.node.id.name
      }
      if (path.node.id?.name.endsWith('_cff_xor')) {
        xorFnName = path.node.id.name
      }
      if (path.node.id?.name.endsWith('_main')) {
        mainFnPath = path
      }
    },
    CallExpression(path) {
      if (
        !startCallPath &&
        path.get('callee').isIdentifier() &&
        path.node.callee.name.endsWith('_main') &&
        // The real entry call site is a sibling of the `_main` FunctionDeclaration, not
        // inside it - an outlined nested function's own re-entrant call lives *inside*
        // `_main`'s own body (as the wrapper's `return main(...)`) and, walked in source
        // order, comes first textually since it's nested deeper in the same statement
        // list the FunctionDeclaration itself sits in.
        !path.findParent((p) => p.node === mainFnPath?.node)
      ) {
        startCallPath = path
      }
    },
  })

  const dispatcher = controlFlow.parseDispatcher(mainFnPath)
  expect(dispatcher).not.toBeNull()

  const startVector = controlFlow.decompressStateVector(
    startCallPath.get('arguments.0'),
    sequence,
    sliceFnName,
  )
  expect(startVector).not.toBeNull()

  // params: (states, scope = {...}, runtime, ...arg) - same fixed order every flattened
  // function/program uses, regardless of whether it turns out to have any outlined nested
  // functions inside it.
  const scopeParam = mainFnPath.node.params[1]
  const scopeName =
    scopeParam.type === 'AssignmentPattern'
      ? scopeParam.left.name
      : scopeParam.name
  const runtimeName = mainFnPath.node.params[2].name
  const argName = mainFnPath.node.params[3]?.name

  const groups = controlFlow.parseSwitchCaseGroups(dispatcher.switchPath)

  const ctx = {
    groups,
    statesName: dispatcher.statesName,
    switchLabel: dispatcher.switchLabel,
    endTotalState: dispatcher.endTotalState,
    mainFnName: mainFnPath.node.id.name,
    sequence,
    sliceFnName,
    runtimeName,
    argName,
    xorFnName,
    stringsBlob,
    scopeName,
    pairNames: new Map(),
    usedNames: new Set(),
  }

  const body = controlFlow.decodeFlattenedFunction(startVector, ctx)
  expect(body).not.toBeNull()

  const bodyCode = body.map((node) => generate(node).code).join('\n')

  // The decoded body should contain a real nested function declaration/expression - not a
  // leftover call back into the shared dispatcher.
  expect(bodyCode).not.toContain(ctx.mainFnName)
  expect(bodyCode).toMatch(/=\s*function\s*\(/)

  // Full assembly: wrap in `function target(a, b) {...}` and actually *run* it - the same
  // strongest-available check `control-flow-real-sample.test.js` uses. Original source:
  // `target(3, 4)` prints `14`.
  const fn = t.functionDeclaration(
    t.identifier('target'),
    [t.identifier('a'), t.identifier('b')],
    t.blockStatement(body),
  )
  const target = new Function(`${generate(fn).code}\nreturn target;`)()
  expect(target(3, 4)).toBe(14)
})
