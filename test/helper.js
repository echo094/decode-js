import fs from 'fs'
import { expect } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'

export default function (visitor, fix, input) {
  const sourceCode = fs.readFileSync(input + '.js', { encoding: 'utf-8' })
  const ast = parse(sourceCode)
  traverse(ast, visitor)
  if (fix) {
    const cmpCode = fs.readFileSync(input + '.fix.js', { encoding: 'utf-8' })
    expect(generate(ast).code).toBe(cmpCode)
  } else {
    expect(generate(ast).code).toBe(sourceCode)
  }
}
