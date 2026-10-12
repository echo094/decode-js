import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@babel/parser'
import { expect, test } from 'vitest'
import { diagnoseContainer } from '../../../src/vm/jsconfuser-vm/extract-container.js'
import { materializeEncodedBytecode } from '../../../src/vm/jsconfuser-vm/materialize-encoded-bytecode.js'
import { diagnoseStandalone } from '../../../src/vm/jsconfuser-vm/decode-standalone.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

const fixture = new URL(
  'fixtures/encoded-bytecode-arithmetic/',
  import.meta.url,
)
const source = fs.readFileSync(new URL('source.js', fixture), 'utf8')
const encoded = fs.readFileSync(new URL('encoded.js', fixture), 'utf8')
const record = JSON.parse(
  fs.readFileSync(new URL('qualification.json', fixture)),
)

function observe(script) {
  const window = {}
  vm.runInNewContext(
    script,
    { window, atob, btoa, performance: { now: () => 0 } },
    { timeout: 30000 },
  )
  return JSON.parse(JSON.stringify(window.TEST_OUTPUT))
}

test('materializes pinned base64 u32 words without mutating source', () => {
  const ast = parse(encoded, { sourceType: 'script' })
  const original = ast.program.body.find(
    (node) =>
      node.type === 'VariableDeclaration' &&
      node.declarations.some(({ id }) => id.name === 'BYTECODE'),
  )
  expect(original.declarations[0].init.type).toBe('StringLiteral')
  const normalized = materializeEncodedBytecode(ast)
  expect(original.declarations[0].init.type).toBe('StringLiteral')
  const container = diagnoseContainer(normalized)
  expect(container.ok).toBe(true)
  expect(container.result.roles.words.values.slice(0, 4)).toEqual([4, 1, 2, 2])
  expect(container.result.roles.scalars.ENCODE_BYTECODE.value).toBe(false)
  expect(diagnoseContainer(encoded).result.roles.words.values).toEqual(
    container.result.roles.words.values,
  )

  const decoded = diagnoseStandalone(encoded)
  expect(decoded.ok).toBe(true)
  const output = parseSuccessfulOutput(decoded.result.output)
  expect(assertNoVmResidue(output).ok).toBe(true)
  expect(assertDerivedStateConsistency(output, decoded.result.output).ok).toBe(
    true,
  )
  expect(observe(encoded)).toEqual(observe(source))
  expect(observe(decoded.result.output)).toEqual(observe(source))
  expect(record.status).toBe('accepted')
  expect(record.effectObservation.observed).toBe(true)
})

test('declines a noncanonical encoded payload', () => {
  const damaged = encoded.replace(/(var BYTECODE = ")[^"]/, '$1*')
  expect(damaged).not.toBe(encoded)
  expect(() => materializeEncodedBytecode(parse(damaged))).toThrow(
    'Payload is not canonical base64',
  )
  expect(diagnoseStandalone(damaged)).toMatchObject({
    ok: false,
    result: null,
    diagnostic: { code: 'container-declined' },
  })
})

test('declines a changed runtime bytecode decoder or base64 helper', () => {
  for (const [before, after] of [
    ['>>> 0;', '>> 0;'],
    ['Buffer.from(s, "base64")', 'Buffer.from(s, "hex")'],
  ]) {
    const damaged = encoded.replace(before, after)
    expect(damaged).not.toBe(encoded)
    expect(diagnoseContainer(damaged).ok).toBe(false)
    expect(diagnoseStandalone(damaged)).toMatchObject({
      ok: false,
      result: null,
      diagnostic: { code: 'container-declined' },
    })
  }
})
