import fs from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'vitest'
import PluginJsconfuser from '#plugin/jsconfuser.js'
import PluginObfuscatorX from '#plugin/obfuscatorx.js'

const fixture = join(__dirname, 'generator-minimal', 'escaped-literals')
const input = fs.readFileSync(`${fixture}.js`, 'utf-8')
const expected = fs.readFileSync(`${fixture}.fix.js`, 'utf-8').trimEnd()

describe('minimal jsesc generation', () => {
  test('obfuscatorx prints ASCII and non-ASCII literal values', () => {
    expect(PluginObfuscatorX(input)).toBe(expected)
  })

  test('jsconfuser prints ASCII and non-ASCII literal values', () => {
    expect(PluginJsconfuser(input)).toBe(expected)
  })
})
