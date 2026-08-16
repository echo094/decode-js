import { join } from 'path'
import { test } from 'vitest'
import { getVisitorResult as getResult } from '../helper.js'
import splitSequence from '#visitor/split-sequence'

const root = join(__dirname, 'split-sequence')

// Every expression lifted out of the sequence references the outer binding `x`, so the
// helper's reference-state check sees the re-homing rather than only the text change.
test('expression-statement-valid', () => {
  getResult(splitSequence, true, join(root, 'expression-statement-valid'))
})

test('return-valid', () => {
  getResult(splitSequence, true, join(root, 'return-valid'))
})
