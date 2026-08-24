import fs from 'fs'
import vm from 'vm'
import { join } from 'path'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import PluginObfuscatorX from '#plugin/obfuscatorx.js'

const root = __dirname

function read(name, suffix = '') {
  return fs.readFileSync(join(root, `${name}${suffix}`), 'utf-8')
}

function run(code) {
  const output = []
  vm.runInNewContext(code, {
    console: { log: (...args) => output.push(args.join(' ')) },
  })
  return output
}

function decode(name) {
  const input = read(name, '.js')
  const output = PluginObfuscatorX(input)
  expect(output).toBe(read(name, '.fix.js').trimEnd())
  return { input, output }
}

function directWrapperShapes(code) {
  const ast = parse(code, { errorRecovery: true })
  const shapes = []
  traverse(ast, {
    ObjectExpression(path) {
      for (const property of path.node.properties) {
        const fn = property.value
        if (fn?.type !== 'FunctionExpression' || fn.params.length < 2) continue
        const returned = fn.body.body.find(
          (statement) => statement.type === 'ReturnStatement',
        )?.argument
        if (returned?.type !== 'CallExpression') continue
        if (returned.callee?.type !== 'Identifier') continue
        if (returned.callee.name !== fn.params[0].name) continue
        shapes.push(
          fn.params
            .slice(1)
            .map((param) => (param.type === 'RestElement' ? 's' : 'p'))
            .join(','),
        )
      }
    },
  })
  return shapes
}

/**
 * 5.4.5's same-length CFF wrappers keep plain and spread argument shapes separate. The exact
 * high-side outputs carry both wrapper spellings; checking the raw shape here keeps this test from
 * becoming only a golden-output assertion. The old 5.4.4 fixture is the focused seed where the
 * encoder reuses the plain wrapper for a spread call and runs as "broken"; the decoder recovers
 * the intended "ok" outcome in its golden.
 */
test('5.4 CFF storage wrappers separate same-length plain and spread calls', () => {
  for (const name of [
    '5.4.5-cff-spread-plain-same-plain-first',
    '5.4.5-cff-spread-plain-same-spread-first',
  ]) {
    expect(run(read(name, '.src.js'))).toEqual(['"ok"'])
    const { input, output } = decode(name)
    expect(directWrapperShapes(input)).toEqual(
      expect.arrayContaining(['p', 's']),
    )
    expect(run(input)).toEqual(['"ok"'])
    expect(run(output)).toEqual(['"ok"'])
  }
})

test('5.4.4 cross-shape wrapper reuse is decoded to the intended outcome', () => {
  expect(run(read('5.4.4-cff-spread-plain-reuse', '.src.js'))).toEqual(['"ok"'])
  const { input, output } = decode('5.4.4-cff-spread-plain-reuse')
  expect(directWrapperShapes(input)).toContain('p')
  expect(run(input)).toEqual(['"broken"'])
  expect(run(output)).toEqual(['"ok"'])
})

/** The 5.4.5 high-side generator output must remain parseable through the decoder entry. */
test('5.4.5 concise arrow in a for initializer survives plugin decoding', () => {
  expect(run(read('5.4.5-issue-1419-arrow-in-for', '.src.js'))).toEqual(['ok'])
  const { input, output } = decode('5.4.5-issue-1419-arrow-in-for')
  expect(() => parse(input)).not.toThrow()
  expect(() => parse(output)).not.toThrow()
  expect(run(output)).toEqual(['ok'])
})
