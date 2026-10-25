import fs from 'node:fs'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import {
  assertDerivedStateConsistency,
  assertNoVmResidue,
  parseSuccessfulOutput,
} from './integration/harness.js'

const fixture = (cell, name) =>
  fs.readFileSync(
    new URL(
      `../switch/fixtures/vm-switch-structured-emitter/try-region/${cell}/${name}`,
      import.meta.url,
    ),
    'utf8',
  )

// The oracle is the source's own execution under the same host.
function observe(code) {
  const window = {}
  vm.runInNewContext(
    code,
    { window, performance: { now: () => 0 } },
    { timeout: 5000 },
  )
  return window.TEST_OUTPUT
}

// forms-cff is the forms source under control flow flattening: there a try nested in a catch and
// its own catch jump to one shared jump step, the inner try's end, before the outer try's end.
for (const cell of ['routes', 'forms', 'forms-cff'])
  test(`${cell}: every try form recovers natively with source behaviour`, () => {
    const source = fixture(cell, 'source.js'),
      encoded = fixture(cell, 'encoded.js')
    const expected = observe(source)
    expect(expected.length).toBeGreaterThan(0)
    expect(observe(encoded)).toEqual(expected)
    const result = decodeJsconfuserVm(encoded)
    expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
    const ast = parseSuccessfulOutput(result.output)
    expect(assertNoVmResidue(ast).ok).toBe(true)
    expect(assertDerivedStateConsistency(ast, result.output).ok).toBe(true)
    expect(result.output).not.toContain('__recovered_dispatch')
    expect(observe(result.output)).toEqual(expected)
    // A catch whose try body cannot throw never runs, so behaviour cannot show it was kept:
    // its distinctive literal must survive in the recovered handler.
    if (cell !== 'routes')
      for (const literal of [41, 42])
        expect(result.output).toMatch(new RegExp(`= ${literal};`))
  })
