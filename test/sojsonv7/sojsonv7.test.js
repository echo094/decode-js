import { join } from 'path'
import { test } from 'vitest'
import { getPluginResult } from '../helper.js'
import PluginSojsonV7 from '#plugin/sojsonv7.js'

const root = __dirname

test('sample_189', () => {
  const tc = 'sample_189'
  getPluginResult(PluginSojsonV7, true, join(root, tc))
})
