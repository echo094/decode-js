import fs from 'node:fs'
import { expect, test } from 'vitest'
import { diagnoseStandaloneInput } from '../../../src/vm/jsconfuser-vm/diagnose-standalone.js'

function fixture(relativePath) {
  return fs.readFileSync(
    new URL(`./fixtures/${relativePath}`, import.meta.url),
    'utf8',
  )
}

test('standalone diagnosis separates complete preflight from a container decline', () => {
  const positive = diagnoseStandaloneInput(
    fixture('corpus/raw/f-literals-order/encoded.js'),
  )
  expect(positive.ok).toBe(true)
  expect(positive.diagnostic).toBeNull()
  expect(positive.model.wordcode.instructionCount).toBeGreaterThan(0)
  expect(positive.model.controlByFunction.size).toBeGreaterThan(0)
  expect(positive.model).not.toHaveProperty('output')

  const negative = diagnoseStandaloneInput(
    fixture('corpus/negative/encoded-bytecode-mode/encoded.js'),
  )
  expect(negative).toEqual({
    ok: false,
    model: null,
    diagnostic: {
      code: 'container-declined',
      message: 'Packet A declined the input container',
    },
  })
})
