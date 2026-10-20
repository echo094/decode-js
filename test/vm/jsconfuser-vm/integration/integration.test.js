import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'
import { diagnoseStandalone } from '../../../../src/vm/jsconfuser-vm/decode-standalone.js'
import { assertNoVmResidue, parseSuccessfulOutput } from './harness.js'

const packageRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const fixtureRoot = new URL(
  '../fixtures/corpus/raw/f-branching/',
  import.meta.url,
)

test('registered CLI preserves a structured branch and matches direct diagnosis', () => {
  const inputPath = fileURLToPath(new URL('encoded.js', fixtureRoot))
  const input = fs.readFileSync(inputPath, 'utf8')
  const expected = JSON.parse(
    fs.readFileSync(new URL('oracle.json', fixtureRoot), 'utf8'),
  ).expected
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'jsconfuser-vm-branch-'))
  try {
    const outputPath = path.join(directory, 'decoded.js')
    const resultPath = path.join(directory, 'result.json')
    const completed = spawnSync(
      process.execPath,
      [
        'src/main.js',
        '-t',
        'jsconfuser-vm',
        '-i',
        inputPath,
        '-o',
        outputPath,
        '--result',
        resultPath,
      ],
      { cwd: packageRoot, encoding: 'utf8', timeout: 30000 },
    )
    expect(completed.error).toBeUndefined()
    expect(completed.status).toBe(0)

    const output = fs.readFileSync(outputPath, 'utf8')
    const record = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    const direct = diagnoseStandalone(input)
    expect(direct.ok).toBe(true)
    expect(record.result).toEqual(direct.result)
    expect(record.output).toBe(output)
    expect(output).toContain('if (')
    expect(output).not.toContain('__recovered_dispatch')
    expect(assertNoVmResidue(parseSuccessfulOutput(output)).ok).toBe(true)

    const context = { TEST_OUTPUT: null }
    context.window = context
    runInNewContext(output, context, { timeout: 2000 })
    expect(context.TEST_OUTPUT).toEqual(expected)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
