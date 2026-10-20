import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sources, baselineOptions } from './config.mjs'
import { runWorker } from './qualify.mjs'
import { snapshot, PIN } from './audit.mjs'
import { exactEqual, stringifyRecord, parseRecord } from './codec.mjs'
import { patchAddedOpcodeCensus } from './patch.mjs'
import {
  timingSourceRoles,
  observeTimingKnown,
  runTimingNative,
} from './timing-observation.mjs'

export const timingSources = {
  arithmetic: sources.arithmetic,
  finalizers:
    'function work() { let value = 7; window.SAVED = () => value; window.pauseGate(); return value; } function parent() { try { try { return work(); } catch (error) { return -1; } } finally { window.CLEANED = true; } } window.TEST_OUTPUT = [parent(), window.CLEANED, window.SAVED()];',
}
const patch = {
  selfModifying: true,
  aliasedOpcodes: true,
  macroOpcodes: true,
  specializedOpcodes: true,
  antiInstrumentation: true,
}
export const timingProfiles = [
  { name: 'baseline', options: {} },
  { name: 'timing', options: { timingChecks: 100 } },
  { name: 'patch', options: patch },
  { name: 'timingPatch', options: { ...patch, timingChecks: 100 } },
  { name: 'encoded', options: { encodeBytecode: true } },
  {
    name: 'timingEncoded',
    options: { encodeBytecode: true, timingChecks: 100 },
  },
  { name: 'table', options: { handlerTable: true } },
  { name: 'timingTable', options: { handlerTable: true, timingChecks: 100 } },
]
export const timingSeeds = [231, 232, 233]
// A record keeps each process's metadata; the worker's parsed result is already in the record, and
// its raw stdout would repeat it many times over.
const withoutStreams = (process) =>
  Object.fromEntries(
    Object.entries(process).filter(
      ([key]) => !['stdout', 'stderr'].includes(key),
    ),
  )
export function assertTimingBehavior(actual, expected) {
  if (!exactEqual(actual, expected))
    throw new Error('Timing behavior differs from the independent oracle')
}
export async function main(args = process.argv.slice(2)) {
  const output = args[0]
  const smoke = args[1] === '--smoke'
  if (
    !output ||
    (args.length !== 1 && !(args.length === 2 && smoke)) ||
    fs.existsSync(output)
  )
    throw new Error('Use timing.mjs NEW_OUTPUT [--smoke]')
  const selectedSources = smoke
    ? { finalizers: timingSources.finalizers }
    : timingSources
  const seeds = smoke ? [timingSeeds[0]] : timingSeeds
  const profiles = smoke ? timingProfiles.slice(0, 2) : timingProfiles
  const before = snapshot({ generation: true })
  fs.mkdirSync(output, { recursive: true })
  const protocol = {
    pin: PIN,
    seeds,
    sources: selectedSources,
    profiles,
    boundary:
      'Known-source nonminified canonical numeric runtime, numeric/base64 payloads and switch/table dispatch; all other representation options false',
    clocks: {
      equalStepMs: 100,
      greaterStepMs: 101,
      realSlowMs: 250,
      realPauseMs: 250,
      pause: 'worker SIGSTOP, parent SIGCONT',
    },
    limitsMs: {
      generation: 65000,
      inspect: 20000,
      nativeVM: 10000,
      nativeParent: 12000,
    },
    inputs: before,
  }
  fs.writeFileSync(
    path.join(output, 'protocol.json'),
    stringifyRecord(protocol),
  )
  const records = []
  const worker = async (request, limit) => {
    const result = await runWorker(request, limit)
    if (
      !result.ok ||
      result.process.exitCode !== 0 ||
      result.process.signal ||
      result.process.timedOut
    )
      throw new Error('Timing qualification worker failed')
    return result
  }
  for (const [caseName, source] of Object.entries(selectedSources))
    for (const seed of seeds)
      for (const profile of profiles) {
        const name = `${caseName}--${profile.name}--${seed}`,
          directory = path.join(output, name)
        fs.mkdirSync(directory)
        fs.writeFileSync(path.join(directory, 'source.js'), source)
        const options = { ...baselineOptions, ...profile.options }
        fs.writeFileSync(
          path.join(directory, 'options.json'),
          stringifyRecord(options),
        )
        const journalPath = path.join(directory, 'generation.ndjson')
        fs.writeFileSync(journalPath, '')
        const generation = await worker(
          {
            action: 'generate',
            source,
            options,
            seed,
            journalPath,
            identities: { java: before.java, jar: before.jar },
          },
          65000,
        )
        const encoded = generation.result.raw.replace(
          /^(?:\/\/[^\n]*\r?\n)+/,
          '',
        )
        fs.writeFileSync(path.join(directory, 'encoded.js'), encoded)
        const roles = timingSourceRoles(encoded),
          active = roles.value === 100
        if (
          active !== Boolean(profile.options.timingChecks) ||
          roles.emitted.numericTransport !==
            Boolean(profile.options.encodeBytecode) ||
          roles.emitted.handlerTable !== Boolean(profile.options.handlerTable)
        )
          throw new Error(
            `Requested timing/representation effect is absent: ${name}`,
          )
        const inspection = await worker(
            { action: 'inspect', source: encoded },
            20000,
          ),
          current = inspection.result
        // Timing checks live in the interpreter only, so every row recovers.
        if (
          !current.publicRecord.ok ||
          !current.checks.ok ||
          !current.inputState
        )
          throw new Error(`Recovery failed: ${name}`)
        const normalSource = observeTimingKnown(source, { clock: () => 0 })
        assertTimingBehavior(normalSource.behavior, {
          kind: 'value',
          value: caseName === 'finalizers' ? [7, true, 7] : 0,
        })
        const equal = observeTimingKnown(encoded, {
          vmName: roles.vmName,
          clock: (index) => index * 100,
        })
        assertTimingBehavior(equal.behavior, normalSource.behavior)
        const greater = observeTimingKnown(encoded, {
          vmName: roles.vmName,
          clock: (index) => (index === 0 ? 0 : 101),
        })
        if (
          active &&
          (greater.behavior.kind !== 'error' ||
            !greater.state.wordsZero ||
            !greater.state.currentFramePayloadCleared)
        )
          throw new Error('Greater-than poisoning oracle did not fire')
        if (!active)
          assertTimingBehavior(greater.behavior, normalSource.behavior)
        const observations = { equal, greater }
        const processes = [generation.process, inspection.process]
        for (const mode of caseName === 'finalizers'
          ? ['fast', 'slow', 'paused']
          : ['fast']) {
          const sourceRun = await runTimingNative({ source, mode })
          const encodedRun = await runTimingNative({
            source: encoded,
            mode,
            vmName: roles.vmName,
          })
          processes.push(sourceRun.process, encodedRun.process)
          const decodedRun = await runTimingNative({
            source: current.publicRecord.output,
            mode,
          })
          processes.push(decodedRun.process)
          assertTimingBehavior(
            decodedRun.result.behavior,
            sourceRun.result.behavior,
          )
          if (active && mode !== 'fast') {
            const result = encodedRun.result
            if (
              result.behavior.kind !== 'error' ||
              !result.state.wordsZero ||
              result.state.cleaned !== undefined ||
              !result.state.captures.some(
                (capture) => !capture.closed && capture.backing === undefined,
              ) ||
              result.blockedMs <= 100
            )
              throw new Error(
                `Active timing cleanup/state oracle failed: ${name}/${mode}`,
              )
          } else
            assertTimingBehavior(
              encodedRun.result.behavior,
              sourceRun.result.behavior,
            )
          if (
            mode === 'paused' &&
            [sourceRun, encodedRun, decodedRun].some(
              (run) => run.process.pause?.resumeSignal !== 'SIGCONT',
            )
          )
            throw new Error('Pause completion is missing')
          observations[mode] = {
            source: sourceRun.result,
            encoded: encodedRun.result,
            decoded: decodedRun.result,
          }
        }
        fs.writeFileSync(
          path.join(directory, 'decoded.js'),
          current.publicRecord.output,
        )
        const record = {
          name,
          caseName,
          seed,
          profile,
          timing: roles.value,
          emitted: roles.emitted,
          active,
          publicDiagnostic: current.publicRecord.diagnostic,
          firstDiagnostic: current.A.diagnostic,
          recoveryQualified: true,
          inputState: current.inputState,
          checks: current.checks,
          census: patchAddedOpcodeCensus(roles.disabled),
          observations,
          processes: processes.map(withoutStreams),
        }
        fs.writeFileSync(
          path.join(directory, 'record.json'),
          stringifyRecord(record),
        )
        records.push(record)
        process.stdout.write(
          `${name}: recovered${active ? '; trigger observed' : ''}\n`,
        )
      }
  if (!exactEqual(before, snapshot({ generation: true })))
    throw new Error('Execution inputs changed during timing qualification')
  // Read the bytes back before publication; stdout alone cannot qualify a run.
  for (const record of records) {
    const reread = parseRecord(
      fs.readFileSync(path.join(output, record.name, 'record.json'), 'utf8'),
    )
    if (!exactEqual(reread, record))
      throw new Error('Timing cell readback changed')
  }
  fs.writeFileSync(
    path.join(output, 'summary.json'),
    stringifyRecord({
      protocol,
      records,
      inputsUnchanged: true,
      readback: true,
    }),
  )
  if (
    !exactEqual(
      parseRecord(fs.readFileSync(path.join(output, 'summary.json'), 'utf8'))
        .records,
      records,
    )
  )
    throw new Error('Timing publication readback changed')
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    process.stderr.write(`${error.stack}\n`)
    process.exitCode = 1
  })
