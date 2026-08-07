import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deIntegrityInit from '#visitor/jsconfuser/integrity'

const root = join(__dirname, 'integrity')

test('simple', () => {
  const tc = 'simple'
  getResult(deIntegrityInit(), true, join(root, tc))
})

test('custom-countermeasures', () => {
  const tc = 'custom-countermeasures'
  getResult(deIntegrityInit(), true, join(root, tc))
})

test('shared-hash', () => {
  const tc = 'shared-hash'
  getResult(deIntegrityInit(), true, join(root, tc))
})

test('not-a-wrapper', () => {
  const tc = 'not-a-wrapper'
  getResult(deIntegrityInit(), false, join(root, tc))
})
