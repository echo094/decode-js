import { runInNewContext } from 'node:vm'
import { performance } from 'node:perf_hooks'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as t from '@babel/types'
import { diagnoseContainer } from '../../src/vm/jsconfuser-vm/extract-container.js'
import { materializeHandlerTable } from '../../src/vm/jsconfuser-vm/materialize-handler-table.js'
import { scalarTimingValue } from '../../src/vm/jsconfuser-vm/runtime-finalizers.js'
import { parseRecord, stringifyRecord } from './codec.mjs'

// Only the numeric, nonminified, known-source population uses this observer.
// Locate the scalar from both uses, then prove its connected shell on a private
// disabled clone. The clone is an observation aid, never decoded-output credit.
export function timingSourceRoles(source) {
  const ast = parse(source)
  const candidates = []
  traverse(ast, {
    VariableDeclarator(path) {
      if (
        !path.get('id').isIdentifier() ||
        !path.parentPath.parentPath.isProgram()
      )
        return
      const binding = path.scope.getBinding(path.node.id.name)
      if (binding?.referencePaths.length !== 2) return
      const uses = binding.referencePaths
      if (
        !uses.some(
          (use) => use.parentPath.isIfStatement() && use.key === 'test',
        ) ||
        !uses.some(
          (use) =>
            use.parentPath.isBinaryExpression({ operator: '>' }) &&
            use.key === 'right',
        )
      )
        return
      candidates.push({ path, value: scalarTimingValue(path.node.init) })
    },
  })
  if (candidates.length !== 1)
    throw new Error('Timing scalar is missing or ambiguous')
  const candidate = candidates[0]
  const name = candidate.path.node.id.name
  candidate.path.get('init').replaceWith(t.booleanLiteral(false))
  const disabled = generate(ast).code
  const diagnosis = diagnoseContainer(disabled)
  if (!diagnosis.ok)
    throw new Error(`Timing shell is not proved: ${diagnosis.diagnostic.code}`)
  const roles = diagnosis.result.roles
  const emitted = { numericTransport: false, handlerTable: false }
  try {
    emitted.handlerTable = Boolean(materializeHandlerTable(ast))
  } catch (error) {
    if (!error.code) throw error
  }
  for (const statement of ast.program.body) {
    if (statement.type === 'VariableDeclaration')
      for (const declaration of statement.declarations)
        if (
          declaration.id.name === roles.scalars.ENCODE_BYTECODE.name &&
          declaration.init?.type === 'BooleanLiteral'
        )
          emitted.numericTransport = declaration.init.value
  }
  return {
    value: candidate.value,
    name,
    vmName: diagnosis.result.roles.roots.vm.name,
    disabled,
    container: diagnosis.result,
    emitted,
  }
}

export function observeTimingKnown(
  source,
  {
    mode = 'fast',
    vmName = null,
    clock = null,
    stop = null,
    vmTimeoutMs = 10000,
  } = {},
) {
  let reads = 0,
    blockedMs = 0
  const context = {
    TEST_OUTPUT: undefined,
    performance: {
      now: () => {
        const value = clock ? clock(reads) : performance.now()
        reads++
        return value
      },
    },
    atob,
    btoa,
    pauseGate: () => {
      const start = performance.now()
      if (mode === 'slow')
        while (performance.now() - start < 250) {
          /* synchronous host work */
        }
      if (mode === 'paused') {
        if (!stop)
          throw new Error('Paused observation needs a supervised process stop')
        stop()
      }
      blockedMs += performance.now() - start
    },
  }
  context.window = context
  context.self = context
  let behavior
  try {
    runInNewContext(source, context, { timeout: vmTimeoutMs })
    behavior = { kind: 'value', value: context.TEST_OUTPUT }
  } catch (error) {
    behavior = {
      kind: error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'timeout' : 'error',
      name: error.name,
      message: error.message,
    }
  }
  const machine = vmName && context[vmName]
  const captureValue = (value) =>
    value !== null &&
    ['object', 'function', 'symbol', 'bigint'].includes(typeof value)
      ? { runtimeType: typeof value }
      : value
  const state = machine
    ? {
        wordsZero: machine.bytecode.every((value) => value === 0),
        frame: machine._f,
        top: machine._regsTop,
        currentFramePayloadCleared: machine._regs
          .slice(machine._regsTop + 1)
          .every((value) => value === undefined),
        captures: Object.values(machine._openUpvalues ?? {})
          .filter(Boolean)
          .map((value) => ({
            closed: value._closed,
            value: captureValue(value._value),
            backing: captureValue(value._regs[value._absSlot]),
          })),
        cleaned: context.CLEANED,
      }
    : null
  return { behavior, state, clockReads: reads, blockedMs }
}

export function runTimingNative(request) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString()
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./timing-observation.mjs', import.meta.url)),
        '--worker',
      ],
      { detached: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] },
    )
    let stdout = '',
      stderr = '',
      timedOut = false,
      pause = null,
      resumeTimer
    child.stdout.on('data', (bytes) => (stdout += bytes))
    child.stderr.on('data', (bytes) => (stderr += bytes))
    child.stdin.on('error', () => {})
    child.stdin.end(stringifyRecord(request))
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* The bounded child may already have completed. */
      }
    }, 12000)
    child.on('message', (message) => {
      if (message !== 'pause-ready' || pause) return
      pause = {
        observedReadyAt: new Date().toISOString(),
        requestedMs: 250,
        signal: 'SIGSTOP',
      }
      resumeTimer = setTimeout(() => {
        try {
          process.kill(child.pid, 'SIGCONT')
          pause.resumedAt = new Date().toISOString()
          pause.resumeSignal = 'SIGCONT'
        } catch (error) {
          pause.error = error.message
        }
      }, 250)
    })
    child.on('error', reject)
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      clearTimeout(resumeTimer)
      const processRecord = {
        startedAt,
        completedAt: new Date().toISOString(),
        timeoutMs: 12000,
        exitCode,
        signal,
        timedOut,
        pause,
        stderr,
      }
      if (exitCode !== 0 || signal || timedOut)
        return reject(
          new Error(
            `Native timing process failed: ${JSON.stringify(processRecord)}`,
          ),
        )
      try {
        resolve({ result: parseRecord(stdout), process: processRecord })
      } catch (error) {
        reject(error)
      }
    })
  })
}

if (process.argv[2] === '--worker') {
  const request = parseRecord(fs.readFileSync(0, 'utf8'))
  const result = observeTimingKnown(request.source, {
    ...request,
    stop: () => {
      process.send('pause-ready')
      process.kill(process.pid, 'SIGSTOP')
    },
  })
  process.stdout.write(stringifyRecord(result))
  if (process.connected) process.disconnect()
}
