import { join } from 'path'
import { test } from 'vitest'
import getResult from '../helper.js'
import parseControlFlowStorage from '#visitor/parse-control-flow-storage'

const root = join(__dirname, 'parse-control-flow-storage')

test('object-invalid-1', () => {
  const tc = 'object-invalid-1'
  getResult(parseControlFlowStorage, false, join(root, tc))
})
