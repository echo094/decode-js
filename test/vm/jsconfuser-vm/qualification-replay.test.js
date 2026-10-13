// Native replay of retained programs against their recorded observations. Git
// already fixes the bytes, so this detects a host change (a Node upgrade, say)
// altering what a frozen program does. Heavy: excluded from the light run.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { expect, test } from 'vitest'
import {
  focusedOracles,
  readCell,
  readOracle,
  records,
} from './qualification-records.js'

function observe(source) {
  const context = {
    TEST_OUTPUT: null,
    performance: { now: () => 0 },
    atob,
    btoa,
  }
  context.window = context
  vm.runInNewContext(source, context, { timeout: 30000 })
  return {
    kind: 'value',
    value: JSON.parse(JSON.stringify(context.TEST_OUTPUT)),
  }
}

test.each(records())(
  'retained cell %s still produces its recorded observations',
  (filename) => {
    const { record, sourcePath, encodedPath } = readCell(filename)
    expect(observe(fs.readFileSync(sourcePath, 'utf8'))).toEqual(
      record.sourceObservation,
    )
    expect(observe(fs.readFileSync(encodedPath, 'utf8'))).toEqual(
      record.encodedObservation,
    )
  },
)

test.each(focusedOracles)(
  'focused oracle %s matches its source/encoded behavior',
  (name) => {
    const { oracle, directory } = readOracle(name)
    for (const kind of ['source', 'encoded']) {
      const source = fs.readFileSync(path.join(directory, `${kind}.js`), 'utf8')
      expect(observe(source)).toEqual({ kind: 'value', value: oracle.expected })
    }
  },
)
