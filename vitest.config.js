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
    // sandbox-tests/ holds encoder checkouts fetched for qualification
    // (scripts/qualify-jsconfuser-vm); their own suites are not decoder tests.
    "exclude": [...configDefaults.exclude, 'sandbox-tests/**'],
    "passWithNoTests": true,
    // The heaviest jsconfuser and VM cases decode whole real-encoder samples,
    // and their time grows several-fold under v8 coverage and full parallel
    // load. One generous global limit replaces per-test overrides, so a slow
    // host or a coverage run is not a red build; a genuine hang still fails,
    // just later.
    "testTimeout": 180000,
  },
})
