import PluginJsconfuser from './jsconfuser.js'
import PluginJsconfuserVm from './jsconfuser-vm.js'

const COORDINATOR_SCHEMA = 'jsconfuser-vm-sequential.v1'

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

function declined(input, stages, failedStage, code, message) {
  return deepFreeze({
    schemaVersion: COORDINATOR_SCHEMA,
    ok: false,
    status: 'declined',
    input,
    output: input,
    result: null,
    diagnostic: { stage: failedStage, code, message },
    failedStage,
    stages,
  })
}

export function decodeJsconfuserVmSequential(source) {
  const outerSource = PluginJsconfuser(source)
  if (outerSource === null)
    return declined(
      source,
      { outer: { status: 'declined', ok: false }, vm: { status: 'pending' } },
      'outer',
      'outer-declined',
      'Outer decoder declined the input',
    )

  const vmRecord = PluginJsconfuserVm(outerSource)
  const outer = { status: 'success', ok: true, output: outerSource }
  if (!vmRecord.ok)
    return declined(
      source,
      {
        outer,
        vm: { status: 'declined', ok: false, diagnostic: vmRecord.diagnostic },
      },
      'vm',
      vmRecord.diagnostic.code,
      vmRecord.diagnostic.message,
    )

  return deepFreeze({
    schemaVersion: COORDINATOR_SCHEMA,
    ok: true,
    status: 'success',
    input: source,
    output: vmRecord.output,
    result: vmRecord.result,
    diagnostic: null,
    failedStage: null,
    stages: {
      outer,
      vm: { status: 'success', ok: true, output: vmRecord.output },
    },
  })
}

export default decodeJsconfuserVmSequential
