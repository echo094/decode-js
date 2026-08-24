import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import mergeObject from '#visitor/merge-object'
import { expectConsistentState } from '../helper.js'

function runVisitor(source) {
  const ast = parse(source, {
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  })
  expect(() => traverse(ast, mergeObject)).not.toThrow()
  expectConsistentState(ast)
  return generate(ast).code
}

test('declines object and array pattern declarators without throwing', () => {
  const source = [
    'let { value } = { value: 42 };',
    'let [other] = [value];',
    'console.log(value, other);',
  ].join('\n')

  const output = runVisitor(source)
  expect(output).toBe(generate(parse(source)).code)
})

test('keeps identifier declarator object merging unchanged', () => {
  const output = runVisitor(
    'var source = {}; source.answer = 42; console.log(source.answer);',
  )

  expect(output).toBe(
    'var source = {\n  "answer": 42\n};\nconsole.log(source.answer);',
  )
  expect(output).toContain('"answer": 42')
  expect(output).not.toContain('source.answer = 42')
  expect(output).toContain('console.log(source.answer)')
})
