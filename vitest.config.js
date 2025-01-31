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
    },
    "passWithNoTests": true,
  },
})
