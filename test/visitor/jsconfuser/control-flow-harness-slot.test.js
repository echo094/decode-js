import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import { expect, test } from 'vitest'
import controlFlow from '#visitor/jsconfuser/control-flow-graph.js'

// `dropDeadHarnessSlot` runs at the harness-removal site, so these fixtures are what the
// enclosing block looks like *after* `decodeControlFlowFlatteningInBlock` has spliced the
// reconstructed body in: the harness assignments and its `if (flag) return result;` are
// already gone, and what is left is the `var flag, result;` `MovedDeclarations` (encoder
// Order 25) hoisted out of them plus whatever `(flag = true, value)` return wraps sat inside
// statements CFF copied through opaquely.
function fnBody(code, name) {
  const ast = parse(code)
  let found
  traverse(ast, {
    FunctionDeclaration(path) {
      if (!found && path.node.id?.name === name) {
        found = path.get('body')
        path.stop()
      }
    },
  })
  return found
}

const run = (code, ...names) => {
  const body = fnBody(code, 'f')
  for (const name of names) {
    controlFlow.dropDeadHarnessSlot(body, name)
  }
  return generate(body.parentPath.node).code
}

test('dropDeadHarnessSlot: strips nested return wraps and removes both hoisted slots', () => {
  const out = run(
    `function f(k) {
      var flag, result;
      switch (k) {
        case "a": return flag = true, obj["x"];
        case "b": return flag = true, obj["y"];
      }
    }`,
    'flag',
    'result',
  )
  expect(out).not.toMatch(/flag/)
  expect(out).not.toMatch(/result/)
  expect(out).toMatch(/return obj\["x"\];/)
  expect(out).toMatch(/return obj\["y"\];/)
})

test('dropDeadHarnessSlot: declines while the flag still has a reader', () => {
  // The `decodeInlineFlattenedFunction` case: an inline fn stays callable and its harness is
  // not removed, so `keepReturnFlag` deliberately leaves the write in place and the enclosing
  // `if (flag) return result;` still reads it. Liveness alone has to be enough to decline.
  const src = `function f(k) {
      var flag, result;
      result = g(k);
      if (flag) {
        return result;
      }
      return flag = true, obj["x"];
    }`
  expect(run(src, 'flag', 'result')).toBe(generate(parse(src)).code)
})

test('dropDeadHarnessSlot: declines on a write that is not a Stage 2 return wrap', () => {
  // Nothing reads `flag`, so its *value* is unobservable - but `sideEffect()` is not, and
  // dropping the declarator alone would turn the assignment into an implicit global.
  const src = `function f(k) {
      var flag;
      flag = sideEffect();
      return k;
    }`
  expect(run(src, 'flag')).toBe(generate(parse(src)).code)
})

test('dropDeadHarnessSlot: keeps the whole tail of a flattened return wrap', () => {
  // The wrapped value is not always one expression. `Dispatcher` (encoder Order 6) re-spells
  // a call as `(payload = [...args], dispatch(...))`, and wrapping *that* return flattens the
  // two into a single three-element sequence - so "the value" is `expressions.slice(1)`, not
  // `expressions[1]`. Reading it as the latter dropped the payload assignment the call
  // depends on, which is why this declined on arity instead.
  const out = run(
    `function f(k) {
      var flag;
      return flag = true, payload = [k], dispatch("e");
    }`,
    'flag',
  )
  expect(out).not.toMatch(/flag/)
  expect(out).toMatch(/return payload = \[k\], dispatch\("e"\);/)
})

test('dropDeadHarnessSlot: declines when the write is not the head of the sequence', () => {
  // Stage 2 always wraps as `(didReturnVar = true, value)`, so a write sitting anywhere else
  // is some other construct: the expressions before it would have to be evaluated first, and
  // this has no basis for reordering or discarding them.
  const src = `function f(k) {
      var flag;
      return sideEffect(), flag = true, k;
    }`
  expect(run(src, 'flag')).toBe(generate(parse(src)).code)
})

test('dropDeadHarnessSlot: removes only its own declarator from a merged declaration', () => {
  // `movedDeclarations.ts` pushes each hoisted declarator onto the block's existing leading
  // `var` statement rather than emitting one per slot, so the statement it lands in routinely
  // also holds live user declarations.
  const out = run(
    `function f(k) {
      var live, flag, result;
      live = k + 1;
      return flag = true, live;
    }`,
    'flag',
    'result',
  )
  expect(out).toMatch(/var live;/)
  expect(out).not.toMatch(/flag/)
  expect(out).not.toMatch(/result/)
  expect(out).toMatch(/return live;/)
})
