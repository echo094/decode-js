import fs from 'fs'
import vm from 'vm'
import { join } from 'path'
import { expect, test } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import PluginObfuscatorX from '#plugin/obfuscatorx.js'
import normalizeStatements from '#visitor/obfuscator/normalize-statements'
import decodeStringArray from '#visitor/obfuscator/string-array'
import normalizeConverting from '#visitor/obfuscator/normalize-converting'
import calculateConstantExp from '#visitor/calculate-constant-exp'
import pruneIfBranch from '#visitor/prune-if-branch'
import inlineControlFlowStorage from '#visitor/obfuscator/inline-control-flow-storage'
import { createUnflattenSwitchDispatch } from '#visitor/obfuscator/unflatten-switch-dispatch'
import unlockEnv from '#visitor/obfuscator/unlock-env'
import deleteExtra from '#visitor/delete-extra'
import { expectConsistentState } from '../helper.js'

const root = join(__dirname, 'static-top-level-declaration')
const seeds = [52601, 52607, 52613, 52619]
const versions = ['5.3.1', '5.4.0']

function read(name, suffix = '') {
  return fs.readFileSync(join(root, `${name}${suffix}`), 'utf-8')
}

function quiet(fn) {
  const old = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  console.log = () => {}
  console.info = () => {}
  console.warn = () => {}
  console.error = () => {}
  try {
    return fn()
  } finally {
    Object.assign(console, old)
  }
}

function decodeDirect(code) {
  const ast = parse(code, {
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  })
  normalizeStatements(ast)
  traverse(ast, inlineControlFlowStorage)
  const stringArray = decodeStringArray(ast)
  expect(stringArray.status).not.toBe('unreadable')

  let previous = null
  for (let round = 0; round < 8; round++) {
    normalizeConverting(ast)
    traverse(ast, calculateConstantExp)
    traverse(ast, inlineControlFlowStorage)
    traverse(ast, calculateConstantExp)
    traverse(ast, pruneIfBranch)
    traverse(
      ast,
      createUnflattenSwitchDispatch(() => {}),
    )
    const current = generate(ast, { compact: true }).code
    if (current === previous) break
    previous = current
  }
  unlockEnv(ast)
  traverse(ast, deleteExtra)
  return {
    ast,
    code: generate(ast, {
      comments: false,
      jsescOption: { minimal: true },
    }).code,
  }
}

function run(code) {
  const output = []
  vm.runInNewContext(code, {
    console: { log: (...args) => output.push(args.join(' ')) },
  })
  return output
}

function objectPatternShorthandCount(code) {
  const ast = parse(code)
  let count = 0
  traverse(ast, {
    ObjectPattern(path) {
      count += path.node.properties.filter(
        (property) => property.shorthand,
      ).length
    },
  })
  return count
}

function splitObjectWriteCount(code) {
  const ast = parse(code)
  const objectBindings = new Set()
  traverse(ast, {
    VariableDeclarator(path) {
      if (
        t.isIdentifier(path.node.id) &&
        t.isObjectExpression(path.node.init)
      ) {
        objectBindings.add(path.node.id.name)
      }
    },
  })
  let count = 0
  traverse(ast, {
    AssignmentExpression(path) {
      const left = path.node.left
      if (
        t.isMemberExpression(left) &&
        t.isIdentifier(left.object) &&
        objectBindings.has(left.object.name)
      ) {
        count++
      }
    },
  })
  return count
}

test('decodes exact 5.3.1 and 5.4.0 static-block declaration output', () => {
  for (const version of versions) {
    for (const seed of seeds) {
      const name = `${version}-seed-${seed}`
      const input = read(name, '.js').trimEnd()
      const expected = read(name, '.fix.js').trimEnd()
      const direct = quiet(() => decodeDirect(input))
      const plugin = quiet(() => PluginObfuscatorX(input))

      expect(plugin).toBe(expected)
      expect(direct.code).toBe(expected)
      expect(direct.code).toBe(plugin)
      expect(() => parse(input)).not.toThrow()
      expect(() => parse(direct.code)).not.toThrow()
      expect(run(input)).toEqual(['42'])
      expect(run(direct.code)).toEqual(['42'])
      expectConsistentState(direct.ast, direct.code)
      expect(splitObjectWriteCount(direct.code)).toBe(0)

      if (version === '5.3.1') {
        expect(objectPatternShorthandCount(input)).toBeGreaterThan(0)
      } else {
        expect(objectPatternShorthandCount(input)).toBe(0)
      }
    }
  }
})
