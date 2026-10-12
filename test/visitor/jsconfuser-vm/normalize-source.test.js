import vm from 'node:vm'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import normalizeVmInput, {
  createNormalizeControlBodies,
  createRestoreVarInitializers,
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

test('restores initializers at the assignment site, including conditional and later writes', () => {
  const source = `
    var x, y; output = [x];
    x = 3;
    if (false) { y = 7; }
    x = x + 1;
    output.push(x, y);
  `
  const ast = normalize(source)
  expect(ast.program.body[0].type).toBe('ExpressionStatement')
  expect(ast.program.body[1].declarations[0].init.value).toBe(3)
  expect(ast.program.body[2].consequent.body[0].type).toBe(
    'VariableDeclaration',
  )
  expect(ast.program.body[3].expression.type).toBe('AssignmentExpression')
})

test('initializer restoration preserves sibling declarations and shadowed bindings on one AST', () => {
  const ast = parse(`
    var x, retained; x = 4;
    function inner() { var x; x = 6; return x; }
    output = [x, retained, inner()];
  `)
  traverse(ast, createRestoreVarInitializers())
  expectConsistentState(ast)
  expect(ast.program.body[0].declarations[0].id.name).toBe('retained')
  expect(execute(generate(ast).code)).toBe('[4,null,6]')
})

test('restoration leaves lexical, parameter, compound and loop-header declarations untouched', () => {
  const source = `
    let x; x = 1;
    var y; y += 2;
    function f(p) { p = 3; return p; }
    for (var k; false;) { k = 4; }
  `
  const ast = parse(source)
  const before = generate(ast).code
  traverse(ast, createRestoreVarInitializers())
  expect(generate(ast).code).toBe(before)
  expectConsistentState(ast)
})

test('promotes an initial group of functions with unused inner names and captured calls', () => {
  const ast = normalize(`
    var f, g;
    f = function hidden(x) { return g(x) + 1; };
    g = function (x) { return x * 2; };
    output = f(3);
  `)
  expect(ast.program.body.slice(0, 2).map((node) => node.type)).toEqual([
    'FunctionDeclaration',
    'FunctionDeclaration',
  ])
})

test.each([
  'var f; f = function self() { return self; }; output = f() === f;',
  'var f; f = function inner() {}; output = f.name;',
  'var f; f = function inner() {}; var alias = f; output = alias.name;',
  'var f; output = typeof f; f = function () {};',
  'var f; if (true) { f = function () {}; } output = typeof f;',
  'var f; f = function () {}; f = function () {}; output = f();',
])(
  'does not promote an observed, escaping, late, conditional or mutable function: %s',
  (source) => {
    const ast = normalize(source)
    expect(
      ast.program.body.some((node) => node.type === 'FunctionDeclaration'),
    ).toBe(false)
  },
)

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
