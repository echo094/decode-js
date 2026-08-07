import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../../helper.js'
import deAntiTooling from '#visitor/jsconfuser/anti-tooling'

const root = join(__dirname, 'anti-tooling')

test('merged-call', () => {
  const tc = 'merged-call'
  getResult(deAntiTooling, true, join(root, tc))
})

test('unrelated-empty-function-not-corrupted', () => {
  const tc = 'unrelated-empty-function-not-corrupted'
  getResult(deAntiTooling, false, join(root, tc))
})
