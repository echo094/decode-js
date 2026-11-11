import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { diagnoseStandaloneInput } from '../src/vm/jsconfuser-vm/diagnose-standalone.js'
import { numericToVmSwitch } from '../src/vm/jsconfuser-vm/numeric-to-vm-switch.js'
import { emitVmSwitchProgram } from '../src/vm/switch/vm-switch-to-source.js'

const usage = `Usage:
  node scripts/render-vm-switch.mjs --source encoded.js --output-dir directory

Writes switch-case.js: the step-one decoded program, without a demo host shim or output logger;
execute it under the same host conditions as the encoded input. The output directory may exist,
but the tool refuses to overwrite an existing artifact. The tool renders code; it does not execute
the encoded input or generated output.`

function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      'output-dir': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(`${usage}\n`)
    return
  }
  if (!values.source || !values['output-dir']) throw new Error(usage)

  const diagnosis = diagnoseStandaloneInput(
    fs.readFileSync(values.source, 'utf8'),
  )
  if (!diagnosis.ok)
    throw new Error(
      `Numeric VM diagnosis declined: ${diagnosis.diagnostic.code}: ${diagnosis.diagnostic.message}`,
    )
  const model = numericToVmSwitch(diagnosis.model)
  const output = `${emitVmSwitchProgram(model, { dispatch: true }).output}\n`
  const directory = path.resolve(values['output-dir'])
  const jsPath = path.join(directory, 'switch-case.js')
  if (fs.existsSync(jsPath))
    throw new Error(
      'Review output already exists; choose a fresh output directory',
    )
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(jsPath, output, { flag: 'wx' })
  process.stdout.write(`${jsPath}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
}
