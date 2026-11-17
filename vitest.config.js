import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    "alias": {
      '#plugin': path.resolve(__dirname, './src/plugin'),
      '#visitor': path.resolve(__dirname, './src/visitor'),
    },
    "coverage": {
      "enabled": true,
      "include": [
        'src',
      ],
      "reporter": ['text', 'json', 'json-summary'],
      "reportOnFailure": true,
    },
    // sandbox-tests/ holds the encoder checkout the cells are encoded with
    // (scripts/jsconfuser-vm-cells); its own suites are not decoder tests.
    "exclude": [...configDefaults.exclude, 'sandbox-tests/**'],
    // The input cells, the encoded inputs of tests that are not cells, are
    // generated before any test runs
    // (test/vm/jsconfuser-vm/support/generate-input-cells.js); the pinned
    // encoder needs a JDK on PATH or JAVA_HOME for its minify cells.
    "globalSetup": ['./test/vm/jsconfuser-vm/support/generate-input-cells.js'],
    "passWithNoTests": true,
    // The heaviest jsconfuser and VM cases decode whole real-encoder samples,
    // and their time grows several-fold under v8 coverage and full parallel
    // load. One generous global limit replaces per-test overrides, so a slow
    // host or a coverage run is not a red build; a genuine hang still fails,
    // just later.
    "testTimeout": 180000,
  },
})
