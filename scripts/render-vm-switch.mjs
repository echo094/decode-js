import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { diagnoseStandaloneInput } from '../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { numericToVmSwitch } from '../src/vm/jsconfuser-vm/numeric-to-vm-switch.js'
import { validateVmSwitchModel } from '../src/vm/switch/vm-switch-model.js'
import { emitVmSwitchProgram } from '../src/vm/switch/vm-switch-to-source.js'

const usage = `Usage:
  node scripts/render-vm-switch.mjs --source encoded.js --output-dir directory [--emit-model]
  node scripts/render-vm-switch.mjs --model switch-model.json --output-dir directory

Both modes write only switch-case.js by default. --emit-model also writes switch-model.json
when reading source. The JavaScript is the step-one decoded program, without a demo host
shim or output logger; execute it under the same host conditions as the encoded input.
The output directory may exist, but the tool refuses to overwrite an existing artifact.
The tool renders code; it does not execute the encoded input or generated output.`

function portable(value) {
  if (value === undefined) return { $type: 'Undefined' }
  if (typeof value === 'bigint')
    return { $type: 'BigInt', value: value.toString() }
  if (typeof value === 'number' && !Number.isFinite(value))
    return { $type: 'Number', value: String(value) }
  if (typeof value === 'number' && Object.is(value, -0))
    return { $type: 'Number', value: '-0' }
  if (value instanceof Map)
    return {
      $type: 'Map',
      entries: [...value].map(([key, entry]) => [
        portable(key),
        portable(entry),
      ]),
    }
  if (value instanceof Set)
    return { $type: 'Set', values: [...value].map(portable) }
  if (Array.isArray(value)) return value.map(portable)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, portable(entry)]),
    )
  return value
}

function revive(value) {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object') {
    if (value.$type === 'Undefined') return undefined
    if (value.$type === 'BigInt') return BigInt(value.value)
    if (value.$type === 'Number') return Number(value.value)
    if (value.$type === 'Map')
      return new Map(
        value.entries.map(([key, entry]) => [revive(key), revive(entry)]),
      )
    if (value.$type === 'Set') return new Set(value.values.map(revive))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, revive(entry)]),
    )
  }
  return value
}

function reviewModel(model) {
  return {
    ...model,
    controlByFunction: new Map(
      model.functions.functions.map(({ id }) => [
        id,
        { mode: 'state-machine' },
      ]),
    ),
    structuredControl: { edges: [] },
  }
}

function render(model) {
  const explicit = reviewModel(model)
  validateVmSwitchModel(explicit)
  return `${emitVmSwitchProgram(explicit).output}\n`
}

function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      model: { type: 'string' },
      'output-dir': { type: 'string' },
      'emit-model': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(`${usage}\n`)
    return
  }
  if (Boolean(values.source) === Boolean(values.model) || !values['output-dir'])
    throw new Error(usage)
  if (values.model && values['emit-model'])
    throw new Error('--emit-model requires --source')

  let model
  if (values.source) {
    const diagnosis = diagnoseStandaloneInput(
      fs.readFileSync(values.source, 'utf8'),
    )
    if (!diagnosis.ok)
      throw new Error(
        `Numeric VM diagnosis declined: ${diagnosis.diagnostic.code}: ${diagnosis.diagnostic.message}`,
      )
    model = numericToVmSwitch(diagnosis.model)
    validateVmSwitchModel(model)
  } else {
    model = revive(JSON.parse(fs.readFileSync(values.model, 'utf8')))
  }
  const output = render(model)
  const directory = path.resolve(values['output-dir'])
  const jsPath = path.join(directory, 'switch-case.js')
  const modelPath = path.join(directory, 'switch-model.json')
  if (
    fs.existsSync(jsPath) ||
    (values['emit-model'] && fs.existsSync(modelPath))
  )
    throw new Error(
      'Review output already exists; choose a fresh output directory',
    )
  fs.mkdirSync(directory, { recursive: true })
  if (values['emit-model'])
    fs.writeFileSync(
      modelPath,
      `${JSON.stringify(portable(model), null, 2)}\n`,
      {
        flag: 'wx',
      },
    )
  fs.writeFileSync(jsPath, output, { flag: 'wx' })
  if (values['emit-model']) process.stdout.write(`${modelPath}\n`)
  process.stdout.write(`${jsPath}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
}
