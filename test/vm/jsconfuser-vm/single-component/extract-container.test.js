import { parse } from '@babel/parser'
import { expect, test } from 'vitest'
import {
  diagnoseContainer,
  extractContainer,
  extractContainerFromSource,
} from '../../../../src/vm/jsconfuser-vm/extract-container.js'
import { PARSER_OPTIONS } from '../../../../src/vm/jsconfuser-vm/container-role-helpers.js'

// A hand-written boot: the VM construction carries the words and the pool, and the start call
// receives it with the root descriptor. The words hold `window.TEST_OUTPUT = 1 + 2`.
const source = `var vm = new VM(
  [4, 1, 2, 2, 0, 0, 0, 3, 1, 0, 0, 4, 2, 0, 0, 5, 3, 0, 11, 6, 4, 5, 9, 2, 3, 6, 0, 2, 4, 0, 45, 2],
  ['window', 'TEST_OUTPUT', 1, 2, undefined],
);
run(vm, new Closure({ startPc: 0, paramCount: 0, regCount: 7 }));`

const deepFrozen = (value) =>
  value === null ||
  typeof value !== 'object' ||
  (Object.isFrozen(value) && Object.values(value).every(deepFrozen))

test('declines ordinary JavaScript before producing a result', () => {
  expect(extractContainerFromSource('var answer = 42;')).toBeNull()
  expect(diagnoseContainer('var answer = 42;')).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'missing-role' },
  })
})

test('returns a stable diagnostic rather than throwing for malformed input', () => {
  const report = diagnoseContainer('var =')

  expect(report).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'extractor-error' },
  })
  expect(report.diagnostic.message).toContain('Unexpected token')
})

test('reads an AST without changing it and returns deeply frozen data', () => {
  const ast = parse(source, PARSER_OPTIONS)
  const before = JSON.stringify(ast)
  const result = extractContainer(ast)
  expect(result.roles.words.values).toHaveLength(32)
  expect(JSON.stringify(ast)).toBe(before)
  expect(deepFrozen(result)).toBe(true)
})
