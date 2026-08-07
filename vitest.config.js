import path from 'path'
import { defineConfig } from 'vitest/config'

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
    "passWithNoTests": true,
    // The jsconfuser fixtures run the whole decode pipeline over real encoder
    // output, and the largest are >100KB of obfuscated source - one full decode
    // per test, with v8 coverage instrumenting every visitor it walks. The
    // heaviest sits near 2s on a fast dev machine, which fits vitest's 5s
    // default with too little margin for a shared CI runner: it has already
    // timed out there while passing locally. Raised so a slow host is not a red
    // build; a genuine hang still fails, just later.
    "testTimeout": 30000,
  },
})
