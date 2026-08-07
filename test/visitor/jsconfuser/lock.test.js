import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deLockInit from '#visitor/jsconfuser/lock'

const root = join(__dirname, 'lock')

test('anti-debug', () => {
  const tc = 'anti-debug'
  getResult(deLockInit(), true, join(root, tc))
})

test('self-defending', () => {
  const tc = 'self-defending'
  getResult(deLockInit(), true, join(root, tc))
})

test('invoke-countermeasures-cleanup', () => {
  const tc = 'invoke-countermeasures-cleanup'
  getResult(deLockInit(), true, join(root, tc))
})

test('invoke-countermeasures-still-live', () => {
  const tc = 'invoke-countermeasures-still-live'
  getResult(deLockInit(), true, join(root, tc))
})

test('not-a-wrapper', () => {
  const tc = 'not-a-wrapper'
  getResult(deLockInit(), false, join(root, tc))
})

test('date-lock', () => {
  const tc = 'date-lock'
  getResult(deLockInit(), true, join(root, tc))
})

test('date-lock-not-a-guard', () => {
  const tc = 'date-lock-not-a-guard'
  getResult(deLockInit(), false, join(root, tc))
})

test('domain-lock', () => {
  const tc = 'domain-lock'
  getResult(deLockInit(), true, join(root, tc))
})

test('domain-lock-not-a-guard', () => {
  const tc = 'domain-lock-not-a-guard'
  getResult(deLockInit(), false, join(root, tc))
})

test('tamper-protection', () => {
  const tc = 'tamper-protection'
  getResult(deLockInit(), true, join(root, tc))
})

test('tamper-protection-not-a-wrapper', () => {
  const tc = 'tamper-protection-not-a-wrapper'
  getResult(deLockInit(), false, join(root, tc))
})

test('tamper-protection-interleaved', () => {
  const tc = 'tamper-protection-interleaved'
  getResult(deLockInit(), true, join(root, tc))
})
