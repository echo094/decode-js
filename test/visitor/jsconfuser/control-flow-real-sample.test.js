import fs from 'fs'
import { join } from 'path'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as t from '@babel/types'
import { expect, test } from 'vitest'
import controlFlow from '#visitor/jsconfuser/control-flow-graph.js'

// `real-sample.js` is one frozen, real `js-confuser` `dist/` obfuscation of:
//
//   function target(a, b) {
//     var x = 1, y = 2, z = x + y + a + b;
//     if (z > 10) { z = z - 1; } else { z = z + 1; }
//     return z;
//   }
//
// with only `controlFlowFlattening: true` enabled (`target: "node"`). CFF's output is
// randomized per run (no seed option), so this is captured once and committed rather
// than regenerated in the test - it's what caught the walk loop's one wrong assumption
// during development (a labeled `switchLabel: switch(...)` isn't always present; some
// runs end up with an unlabeled switch and bare `break`s instead - see
// `parseDispatcher`'s comment). Running the file directly (`node real-sample.js`) prints
// `11` (`z = 1+2+3+4 = 10`, not `> 10`, so the `else` arm: `z = 10+1 = 11`).
const samplePath = join(__dirname, 'control-flow-graph', 'real-sample.js')

test('resolveBlockGraph: recovers the branch structure from a real obfuscated sample', () => {
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
        path.node.callee.name.endsWith('_main')
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

  const groups = controlFlow.parseSwitchCaseGroups(dispatcher.switchPath)

  const graph = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    startVector,
  )

  expect(graph).not.toBeNull()

  // scope.x = 1; scope.y = 2; scope.z = <xor-mangled scope reads> + a + b - three
  // statements before the real branch point (`if (z > 10)`).
  expect(graph.type).toBe('branch')
  expect(graph.statements.length).toBe(3)

  // Both arms: one mangled reassignment of `z`, then `return z`.
  for (const arm of [graph.consequent, graph.alternate]) {
    expect(arm.type).toBe('sequential')
    expect(arm.statements.length).toBe(1)
    expect(arm.next.type).toBe('return')
    expect(generate(arm.next.argument.node).code).toBe(
      generate(arm.statements[0].get('expression').get('left').node).code,
    )
  }

  controlFlow.undoLiteralEntanglementInGraph(graph, {
    statesName: dispatcher.statesName,
    xorFnName,
    stringsBlob,
  })

  // With literal entanglement undone, the recovered test and both arms' right-hand
  // sides should read back as the original source's `if (z > 10) { z = z - 1 } else {
  // z = z + 1 }` - modulo the scope-object member-expression form standing in for `z`,
  // undone next.
  expect(generate(graph.test.node).code.endsWith('> 10')).toBe(true)
  expect(
    generate(graph.consequent.statements[0].node).code.endsWith('- 1;'),
  ).toBe(true)
  expect(
    generate(graph.alternate.statements[0].node).code.endsWith('+ 1;'),
  ).toBe(true)

  // params: (states, scope = {...}, runtime) - `scope`'s own name, whatever it got
  // renamed to, is always the second parameter (an AssignmentPattern at the entry point).
  const scopeParam = mainFnPath.node.params[1]
  const scopeName =
    scopeParam.type === 'AssignmentPattern'
      ? scopeParam.left.name
      : scopeParam.name

  const introduced = controlFlow.flattenScopeMembersInGraph(graph, {
    scopeName,
  })

  // x, y, z - three distinct source-level locals, no naming collisions in this sample.
  expect(introduced.length).toBe(3)
  const [, , zName] = introduced

  // Now a full, exact match against the original source's shape (modulo whatever `z`
  // got renamed to, since its real source-level name is unrecoverable - see the skill
  // doc): `x = 1; y = 2; z = x + y + a + b; if (z > 10) { z = z - 1 } else { z = z + 1 }`.
  expect(generate(graph.test.node).code).toBe(`${zName} > 10`)
  expect(generate(graph.consequent.statements[0].node).code).toBe(
    `${zName} = ${zName} - 1;`,
  )
  expect(generate(graph.alternate.statements[0].node).code).toBe(
    `${zName} = ${zName} + 1;`,
  )
  expect(generate(graph.consequent.next.argument.node).code).toBe(zName)
  expect(generate(graph.alternate.next.argument.node).code).toBe(zName)

  // Both arms happen to jump to the exact same next block here (a `return z` block
  // doesn't care what path led to it, so the state machine reconverges there
  // regardless of which arithmetic ran) - confirmed by object identity, not just
  // matching content.
  expect(graph.consequent.next).toBe(graph.alternate.next)

  // Fold the DAG back into a real statement list. Since both arms reconverge on that
  // shared `return`, it should come out *once*, after the `if`/`else` - not duplicated
  // inside both branches - a byte-for-byte match of the original source (modulo `z`'s
  // name) once wrapped in a function and printed.
  const [xName, yName] = introduced
  const statements = controlFlow.foldBranchesInGraph(graph)
  expect(statements).not.toBeNull()
  const foldedCode = statements.map((node) => generate(node).code).join('\n')
  expect(foldedCode).toBe(
    `${xName} = 1;\n` +
      `${yName} = 2;\n` +
      `${zName} = ${xName} + ${yName} + a + b;\n` +
      `if (${zName} > 10) {\n` +
      `  ${zName} = ${zName} - 1;\n` +
      `} else {\n` +
      `  ${zName} = ${zName} + 1;\n` +
      `}\n` +
      `return ${zName};`,
  )

  // Full assembly: declare the vars flattenScopeMembersInGraph introduced, wrap the
  // folded statements in a real function, and actually *run* it - the strongest
  // available check that this is a faithful reconstruction, not just
  // structurally-plausible-looking output. Original source: `target(3, 4)` prints `11`.
  const declaration = controlFlow.declareIntroducedVariables(introduced)
  const fn = t.functionDeclaration(
    t.identifier('target'),
    [t.identifier('a'), t.identifier('b')],
    t.blockStatement([declaration, ...statements]),
  )
  const target = new Function(`${generate(fn).code}\nreturn target;`)()
  expect(target(3, 4)).toBe(11)
})
