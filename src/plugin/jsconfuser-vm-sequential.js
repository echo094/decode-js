import { parse } from '@babel/parser'
import generator from '@babel/generator'
import traverse from '@babel/traverse'
import calculateConstantExp from '../visitor/calculate-constant-exp.js'
import pruneIfBranch from '../visitor/prune-if-branch.js'
import PluginJsconfuser from './jsconfuser.js'
import PluginJsconfuserVm from './jsconfuser-vm.js'
import { deepFreeze } from '../vm/decline.js'

const COORDINATOR_SCHEMA = 'jsconfuser-vm-sequential.v1'

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

/**
 * The post-stage: shared Babel visitors over the VM decoder's output, imported unchanged. It reads
 * only the code it is handed, so it folds literal expressions and prunes branches on a literal
 * test; register copies stay with the VM backend, which holds the facts they need.
 */
function postStage(code) {
  const ast = parse(code, { sourceType: 'script' })
  traverse(ast, calculateConstantExp)
  traverse(ast, pruneIfBranch)
  return generator(ast).code
}

/**
 * Outer decoder, then VM decoder, then the post-stage unless `postStage` is false. The `vm`
 * stage and `result` keep the VM decoder's own output; `output` is the published program and
 * `postStage` says whether it went through the post-stage.
 */
export function decodeJsconfuserVmSequential(
  source,
  { postStage: runPostStage = true } = {},
) {
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
    output: runPostStage ? postStage(vmRecord.output) : vmRecord.output,
    postStage: runPostStage,
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
