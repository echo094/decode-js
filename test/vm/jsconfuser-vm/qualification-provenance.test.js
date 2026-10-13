// Record consistency only: nothing here executes a retained program. The native
// replay of each record's observations is qualification-replay.test.js.
import fs from 'node:fs'
import { expect, test } from 'vitest'
import {
  focusedOracles,
  readCell,
  readOracle,
  records,
} from './qualification-records.js'

test.each(records())(
  'retained cell %s has a consistent record',
  (filename) => {
    const { record, sourcePath, encodedPath } = readCell(filename)
    expect(fs.existsSync(sourcePath)).toBe(true)
    expect(fs.existsSync(encodedPath)).toBe(true)
    expect(record.sourceObservation).toEqual(record.encodedObservation)
    expect(record.id).toBe(`${record.case}--${record.profile}--${record.seed}`)
    expect(
      Number.isInteger(record.seed) &&
        record.seed >= 0 &&
        record.seed <= 0xffffffff,
    ).toBe(true)
    expect(record.options.target).toBe('browser')
    if (record.status === 'accepted') {
      expect(record.decodedObservation).toEqual(record.sourceObservation)
      expect(record.diagnostic).toBeNull()
    } else {
      expect(record.status).toBe('declined')
      expect(record.decodedObservation).toBeNull()
      expect(record.diagnostic.code).toBeTypeOf('string')
    }
    const components = record.effectObservation.components
    if (components) {
      for (const option of Object.keys(components))
        expect(record.options[option]).toBe(true)
      const expected = Object.values(components).includes(false)
        ? false
        : Object.values(components).includes(null)
          ? null
          : true
      expect(record.effectObservation.observed).toBe(expected)
    }
    expect(record.provenance.generation.encoderCommit).toBe(
      record.encoderCommit ?? null,
    )
    expect(record.provenance.completeEffectControlsRetained).toBe(false)
    expect(record.provenance.decodedBytesRetained).toBe(false)
  },
)

test.each(focusedOracles)('focused oracle %s names its cell', (name) => {
  expect(readOracle(name).oracle.cellId).toBe(name)
})
