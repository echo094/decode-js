import fs from 'node:fs'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { expect, test } from 'vitest'
import { expectConsistentState } from '../../helper.js'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'

const directory = new URL('fixtures/minified-class-frontend/', import.meta.url)
const provenance = JSON.parse(
  fs.readFileSync(new URL('provenance.json', directory), 'utf8'),
)
const read = (seed, kind = 'arithmetic') =>
  fs.readFileSync(
    new URL(`${kind}--minifyClassObfuscation--${seed}.js`, directory),
    'utf8',
  )
test('local frozen parser fixtures retain config/seed/pin records', () => {
  expect(provenance.encoderPin).toBe('20c5b96bf57337c568579352758d7685358650de')
  for (const record of provenance.records) {
    expect(record.options.minify).toBe(
      ['minify', 'minifyClassObfuscation'].includes(record.profile),
    )
    expect(record.options.classObfuscation).toBe(
      ['classObfuscation', 'minifyClassObfuscation'].includes(record.profile),
    )
  }
})
for (const seed of [172, 173, 174]) {
  test(`${seed}: A locates the payload`, () => {
    expect(diagnoseContainer(read(seed)).ok).toBe(true)
  })
  test(`${seed}: mandatory exception input reaches structured shared N output`, () => {
    const source = read(seed, 'exceptionRoutes')
    expect(diagnoseContainer(source).ok).toBe(true)
    const result = decodeJsconfuserVm(source)
    expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
    expect(result.output).not.toBe(source)
    expect(result.output).toContain('catch (__recovered_error)')
    expect(result.output).toContain('} finally {')
    expect(result.output).not.toMatch(/__recovered_(?:dispatch|pc|handlers)/)
    expect(result.result.proof).toMatchObject({
      freshJavaScriptEmission: true,
      finalParseValidated: true,
      finalResidueValidated: true,
    })
    const outputAst = parse(result.output)
    traverse(outputAst, {})
    expectConsistentState(outputAst, result.output)
  })
}
