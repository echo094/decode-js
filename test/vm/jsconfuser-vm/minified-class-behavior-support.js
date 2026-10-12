import { expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { performance } from 'node:perf_hooks'
import { diagnoseStandaloneInput } from '../../../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { decodeJsconfuserVm } from '../../../src/plugin/jsconfuser-vm.js'
import {
  parseSuccessfulOutput,
  assertNoVmResidue,
  assertDerivedStateConsistency,
} from './integration/harness.js'

export function currentExceptionRecovery(encoded) {
  const analysis = diagnoseStandaloneInput(encoded)
  expect(analysis.ok, JSON.stringify(analysis.diagnostic)).toBe(true)
  const instructions = analysis.model.wordcode.instructions
  for (const name of [
    'CALL_METHOD',
    'GET_PROP',
    'THROW',
    'TRY_SETUP',
    'FINALLY_SETUP',
    'MAKE_CLOSURE',
    'RETURN',
    'LOAD_UPVALUE',
    'STORE_UPVALUE',
  ])
    expect(
      instructions.some((item) => item.name === name),
      `mandatory ${name} payload route`,
    ).toBe(true)
  const at = (pc) => instructions.find((item) => item.pc === pc)
  for (const setup of instructions.filter((item) => item.name === 'TRY_SETUP'))
    expect(at(setup.operands[0].pc)).toBeDefined()
  for (const setup of instructions.filter(
    (item) => item.name === 'FINALLY_SETUP',
  )) {
    expect(at(setup.operands[0].pc)).toBeDefined()
    expect(at(setup.operands[3].pc)?.name).toBe('THROW')
  }
  expect(
    analysis.model.functions.functions.some(
      (fn) => fn.captureCount > 0 && fn.descriptor.captures.length > 0,
    ),
  ).toBe(true)
  const current = decodeJsconfuserVm(encoded)
  expect(current.ok, JSON.stringify(current.diagnostic)).toBe(true)
  expect(current.output).not.toBe(encoded)
  const ast = parseSuccessfulOutput(current.output)
  expect(assertNoVmResidue(ast).ok).toBe(true)
  expect(assertDerivedStateConsistency(ast, current.output).ok).toBe(true)
  return current.output
}
export function observeException(source) {
  const context = { TEST_OUTPUT: undefined, performance, atob, btoa }
  context.window = context
  context.self = context
  runInNewContext(source, context, { timeout: 10000 })
  return context.TEST_OUTPUT
}
