import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const script = path.join(repository, 'scripts/render-vm-switch.mjs')
const fixture = fileURLToPath(
  new URL(
    '../vm/jsconfuser-vm/fixtures/readability/arithmetic/encoded.js',
    import.meta.url,
  ),
)

function run(...args) {
  return spawnSync(process.execPath, args, {
    cwd: repository,
    encoding: 'utf8',
  })
}

function execute(source) {
  const context = { window: {}, performance: { now: () => 0 } }
  runInNewContext(source, context, { timeout: 5000 })
  return context.window
}

test('step-one switch output preserves the encoded fixture behavior', () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'decode-js-switch-review-'),
  )
  try {
    const sourceOutput = path.join(directory, 'source')
    const sourceRun = run(
      script,
      '--source',
      fixture,
      '--output-dir',
      sourceOutput,
    )
    expect(sourceRun.status, sourceRun.stderr).toBe(0)

    const sourcePath = path.join(sourceOutput, 'switch-case.js')
    const code = readFileSync(sourcePath, 'utf8')
    expect(existsSync(path.join(sourceOutput, 'switch-model.json'))).toBe(false)
    expect(code).toContain('switch (__recovered_pc)')
    expect(code).toContain('case 17:')
    expect(code).not.toContain('catch (__recovered_error)')
    expect(code).not.toContain('__recovered_handlers')
    expect(code).not.toContain('console.log')
    expect(code).not.toContain('globalThis.window =')
    const encodedWindow = execute(readFileSync(fixture, 'utf8'))
    const decodedWindow = execute(code)
    expect(decodedWindow).toEqual(encodedWindow)
    expect(decodedWindow.TEST_OUTPUT).toBe(7)

    const savedOutput = path.join(directory, 'saved')
    const savedRun = run(
      script,
      '--source',
      fixture,
      '--output-dir',
      savedOutput,
      '--emit-model',
    )
    expect(savedRun.status, savedRun.stderr).toBe(0)
    const modelPath = path.join(savedOutput, 'switch-model.json')
    const model = JSON.parse(readFileSync(modelPath, 'utf8'))
    expect(model.schemaVersion).toBe('decode-js-vm-switch.v1')
    expect(model.instructionsByFunction.$type).toBe('Map')
    expect(readFileSync(path.join(savedOutput, 'switch-case.js'), 'utf8')).toBe(
      code,
    )

    const modelOutput = path.join(directory, 'model')
    const modelRun = run(
      script,
      '--model',
      modelPath,
      '--output-dir',
      modelOutput,
    )
    expect(modelRun.status, modelRun.stderr).toBe(0)
    expect(readFileSync(path.join(modelOutput, 'switch-case.js'), 'utf8')).toBe(
      code,
    )
    expect(
      execute(readFileSync(path.join(modelOutput, 'switch-case.js'), 'utf8')),
    ).toEqual(encodedWindow)

    const overwrite = run(
      script,
      '--model',
      modelPath,
      '--output-dir',
      modelOutput,
    )
    expect(overwrite.status).not.toBe(0)
    expect(overwrite.stderr).toContain('Review output already exists')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
