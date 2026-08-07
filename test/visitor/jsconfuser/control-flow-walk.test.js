import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { expect, test } from 'vitest'
import controlFlow from '#visitor/jsconfuser/control-flow-graph.js'

function findMainFn(code) {
  const ast = parse(code)
  let mainFnPath
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.node.id && path.node.id.name === 'main') {
        mainFnPath = path
      }
    },
  })
  return mainFnPath
}

function groupsFor(code) {
  const mainFnPath = findMainFn(code)
  const dispatcher = controlFlow.parseDispatcher(mainFnPath)
  return {
    dispatcher,
    groups: controlFlow.parseSwitchCaseGroups(dispatcher.switchPath),
  }
}

test('parseDispatcher: reads statesName, sumFnName, endTotalState, and an unlabeled switch', () => {
  const { dispatcher } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 17) {
        switch (sum(states)) {
          case 0:
            break;
        }
      }
    }
  `)
  expect(dispatcher.statesName).toBe('states')
  expect(dispatcher.sumFnName).toBe('sum')
  expect(dispatcher.endTotalState).toBe(17)
  expect(dispatcher.switchLabel).toBeNull()
})

test('parseDispatcher: also accepts a labeled switch', () => {
  const { dispatcher } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 17) {
        lbl: switch (sum(states)) {
          case 0:
            break lbl;
        }
      }
    }
  `)
  expect(dispatcher.switchLabel).toBe('lbl')
})

test('parseDispatcher: rejects a body that is not exactly one while loop', () => {
  const mainFnPath = findMainFn(`
    function main(states, scope, runtime) {
      doSomethingElse();
      while (sum(states) !== 17) {
        switch (sum(states)) {
          case 0:
            break;
        }
      }
    }
  `)
  expect(controlFlow.parseDispatcher(mainFnPath)).toBeNull()
})

test('resolveBlockGraph: a plain sequential jump reaches the end', () => {
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 17) {
        switch (sum(states)) {
          case 0:
            doPayload();
            states[0] = 10, states[1] += states[0] - 3;
            break;
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
  )
  expect(node.type).toBe('sequential')
  expect(node.statements.map((p) => generate(p.node).code)).toEqual([
    'doPayload();',
  ])
  expect(node.next.type).toBe('end')
})

test('resolveBlockGraph: a dead-jump guard that is provably false is skipped, not emitted', () => {
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 17) {
        switch (sum(states)) {
          case 0:
            if (states[0] > 999) {
              states[0] = 1, states[1] = 1;
              break;
            }
            doPayload();
            states[0] = 10, states[1] += states[0] - 3;
            break;
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
  )
  expect(node.type).toBe('sequential')
  expect(node.statements.map((p) => generate(p.node).code)).toEqual([
    'doPayload();',
  ])
  expect(node.next.type).toBe('end')
})

test('resolveBlockGraph: a dead-jump guard that evaluates true signals a wrong vector, not a taken branch', () => {
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 17) {
        switch (sum(states)) {
          case 0:
            if (states[0] < 999) {
              states[0] = 1, states[1] = 1;
              break;
            }
            doPayload();
            states[0] = 10, states[1] += states[0] - 3;
            break;
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
  )
  expect(node).toBeNull()
})

test('resolveBlockGraph: a real if/else-to-goto conversion fans out into a branch node', () => {
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 50) {
        switch (sum(states)) {
          case 0:
            doPayload();
            if (scope.z > states[0] + 5) {
              states[0] = 10, states[1] = 40;
              break;
            } else {
              states[0] = 20, states[1] = 30;
              break;
            }
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
  )
  expect(node.type).toBe('branch')
  expect(node.statements.map((p) => generate(p.node).code)).toEqual([
    'doPayload();',
  ])
  expect(generate(node.test.node).code).toBe('scope.z > states[0] + 5')
  expect(node.consequent.type).toBe('end')
  expect(node.alternate.type).toBe('end')
})

test('resolveBlockGraph: a real return ends the walk with its recovered value', () => {
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 999) {
        switch (sum(states)) {
          case 0:
            return (didReturn = true, scope.result);
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
  )
  expect(node.type).toBe('return')
  expect(generate(node.argument.node).code).toBe('scope.result')
})

test('resolveBlockGraph: keepReturnFlag keeps the didReturn side effect (gap #2 N2)', () => {
  // An inline-flattened fn's harness in the enclosing scope is not removed, so its returns
  // must keep the `didReturn = true` write. `keepReturnFlag` (the 8th arg) opts into that.
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 999) {
        switch (sum(states)) {
          case 0:
            return (didReturn = true, scope.result);
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
    new Map(),
    { count: 0 },
    true,
  )
  expect(node.type).toBe('return')
  expect(generate(node.argument.node).code).toBe(
    'didReturn = true, scope.result',
  )
})

test('resolveBlockGraph: an argument-less `return;` is a terminal, not a match failure', () => {
  // CFF's own block terminator prints as `return undefined;`, but `minify` rewrites it to a
  // bare `return;`. Reading that as an unrecognized shape failed the whole enclosing
  // application closed, so every minified sample whose walk reached such a block decoded 0%.
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 999) {
        switch (sum(states)) {
          case 0:
            return;
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
  )
  expect(node.type).toBe('return')
  expect(node.argument).toBeNull()

  const statements = controlFlow.foldBranchesInGraph(node)
  expect(statements.map((s) => generate(s).code)).toEqual(['return;'])
})

test('resolveBlockGraph: a block with no recognized terminal fails closed', () => {
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 17) {
        switch (sum(states)) {
          case 0:
            doPayload();
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
  )
  expect(node).toBeNull()
})

test('resolveBlockGraph: an unreachable sum (no matching case) fails closed', () => {
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 17) {
        switch (sum(states)) {
          case 0:
            states[0] = 10, states[1] += states[0] - 3;
            break;
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [1, 1],
  )
  expect(node).toBeNull()
})

test("undoLiteralEntanglementInGraph: decodes mangled literals using each node's own vector", () => {
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 20) {
        switch (sum(states)) {
          case 0:
            doPayload(states[0] + 5);
            if (scope.z > states[0] + 5) {
              states[0] = 10, states[1] = 40;
              break;
            } else {
              states[0] = 5, states[1] = 15;
              break;
            }
          case 50:
            return (didReturn = true, states[0] + 2);
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
  )
  controlFlow.undoLiteralEntanglementInGraph(node, {
    statesName: dispatcher.statesName,
  })

  expect(node.statements.map((p) => generate(p.node).code)).toEqual([
    'doPayload(5);',
  ])
  expect(generate(node.test.node).code).toBe('scope.z > 5')
  // consequent lands on vector [10, 40] (sum 50), matching the `case 50` return
  expect(node.consequent.type).toBe('return')
  expect(generate(node.consequent.argument.node).code).toBe('12')
  // alternate lands on vector [5, 15] (sum 20 === endTotalState) directly
  expect(node.alternate.type).toBe('end')
})

test('resolveBlockGraph: a genuine surviving if/else (non-goto-shaped) is copied through as payload', () => {
  const { dispatcher, groups } = groupsFor(`
    function main(states, scope, runtime) {
      while (sum(states) !== 17) {
        switch (sum(states)) {
          case 0:
            if (scope.x) { doA(); } else doB();
            states[0] = 10, states[1] += states[0] - 3;
            break;
        }
      }
    }
  `)
  const node = controlFlow.resolveBlockGraph(
    groups,
    dispatcher.statesName,
    dispatcher.switchLabel,
    dispatcher.endTotalState,
    [0, 0],
  )
  expect(node.type).toBe('sequential')
  expect(node.statements.map((p) => generate(p.node).code)).toEqual([
    'if (scope.x) {\n  doA();\n} else doB();',
  ])
})
