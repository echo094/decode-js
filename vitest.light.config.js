import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.js'

// The light run: the default suite minus the files that dominate its time.
// Each listed file is still part of `npm test`, which stays the full suite; run
// that before a commit. A file joins this list for its cost, never because it
// is failing.
export const heavy = [
  // Real-encoder samples decoded under stacked options, with native behavior.
  'test/vm/jsconfuser-vm/class-runtime-combinations.test.js',
  'test/vm/jsconfuser-vm/encoded-bytecode-combinations.test.js',
  'test/vm/jsconfuser-vm/normalize-alias-combinations.test.js',
  'test/vm/jsconfuser-vm/normalize-anti-routing-combinations.test.js',
  'test/vm/jsconfuser-vm/normalize-anti-specialized-combinations.test.js',
  'test/vm/jsconfuser-vm/normalize-macro-combinations.test.js',
  'test/vm/jsconfuser-vm/runtime-binding-identities.test.js',
  // Large parameterized populations of retained cells.
  'test/vm/jsconfuser-vm/class-runtime-contract.test.js',
  'test/vm/jsconfuser-vm/minified-class-runtime.test.js',
  'test/vm/jsconfuser-vm/randomized-class.test.js',
  'test/vm/jsconfuser-vm/randomized-minified-class.test.js',
  // Native replay of every retained record's observations.
  'test/vm/jsconfuser-vm/qualification-replay.test.js',
]

export default mergeConfig(base, defineConfig({ test: { exclude: heavy } }))
