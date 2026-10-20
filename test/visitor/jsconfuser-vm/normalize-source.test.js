import vm from 'node:vm'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import normalizeVmInput, {
  createNormalizeControlBodies,
  normalizeVmAst,
} from '../../../src/visitor/jsconfuser-vm/normalize-source.js'
import { expectConsistentState } from '../../helper.js'

function execute(source) {
  const context = {}
  vm.runInNewContext(source, context, { timeout: 1000 })
  return JSON.stringify(context.output)
}

function normalize(source) {
  const ast = parse(source)
  normalizeVmAst(ast)
  expectConsistentState(ast)
  const output = generate(ast).code
  expect(execute(output)).toBe(execute(source))
  return ast
}

// Declarator placement and function-expression form are left to the consumer,
// which selects a role by its single defining write rather than by spelling.
test('leaves declaration placement and function-expression form as written', () => {
  const source = `
    var x, f; output = [typeof x];
    x = 3;
    f = function hidden(v) { return v + x; };
    output.push(f(1));
  `
  const ast = normalize(source)
  expect(generate(ast).code).toBe(generate(parse(source)).code)
})

test('reuses guarded key rewrites while preserving special object and class keys', () => {
  const ast = normalize(`
    var object = { ["__proto__"]: 3, ["safe"]: 5 };
    class C { ["constructor"]() { return 7; } }
    output = [object["safe"], object["__proto__"], new C()["constructor"]()];
  `)
  const properties = ast.program.body[0].declarations[0].init.properties
  expect(properties[0].computed).toBe(true)
  expect(properties[1].computed).toBe(false)
  expect(ast.program.body[1].body.body[0].computed).toBe(true)
})

test('simple control bodies preserve lexical blocks and dangling-else grouping', () => {
  const source = `
    function f(x) {
      if (x) { return 1; } else { return 2; }
    }
    if (true) { let x = 4; }
    if (true) { if (false) output = 99; } else output = 100;
    output = [f(true), f(false)];
  `
  const ast = parse(source)
  traverse(ast, createNormalizeControlBodies())
  expectConsistentState(ast)
  expect(ast.program.body[0].body.body[0].consequent.type).toBe(
    'ReturnStatement',
  )
  expect(ast.program.body[1].consequent.type).toBe('BlockStatement')
  expect(ast.program.body[2].consequent.type).toBe('BlockStatement')
  expect(execute(generate(ast).code)).toBe(execute(source))
})

test('normalization is idempotent and does not recover malformed or non-script admission', () => {
  const source = 'var x; x = { ["safe"]: 5 }; output = x["safe"];'
  const once = normalizeVmInput(source)
  expect(normalizeVmInput(once)).toBe(once)
  for (const invalid of ['function (', 'return 5;', 'export const x = 3;'])
    expect(normalizeVmInput(invalid)).toBe(invalid)
})
