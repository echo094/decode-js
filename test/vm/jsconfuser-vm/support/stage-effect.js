import { beforeAll, expect, test } from 'vitest'
import { diagnoseContainer } from '../../../../src/vm/jsconfuser-vm/extract-container.js'
import { expandCells, generateMissing, plainCell, readCell } from './cells.js'

// A stage cell proves something only if its stage changed the program (M4). Each stage suite runs
// this check from its own file under stage-effect/, so Vitest spreads the suites over its workers
// and no one test carries every stage cell. Nothing here decodes.
export const isStageSuite = (suite) =>
  suite === 'single-payload-stage' ||
  (suite.endsWith('-chain') &&
    !suite.startsWith('runtime-') &&
    !suite.startsWith('timing-'))

// The program the stage acts on: the container's words and constant pool.
export const payload = (cell) => {
  const { result } = diagnoseContainer(readCell(cell).encoded)
  return JSON.stringify(
    result && [
      result.roles.words.values,
      result.roles.pool.values.map((value) => value ?? null),
    ],
  )
}

export function defineStageEffectTests(suite) {
  const cells = expandCells().filter((cell) => cell.suite === suite.name)

  beforeAll(async () => {
    await generateMissing([...cells, ...cells.map(plainCell)])
  }, 3600000)

  test(`${suite.name}: a stage changes the program it is tested on`, () => {
    expect(cells.length).toBeGreaterThan(0)
    const unchanged = cells
      .filter((cell) => payload(cell) === payload(plainCell(cell)))
      .map(({ id }) => id)
    expect(unchanged).toEqual([])
  })
}
