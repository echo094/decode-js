import { diagnoseStandalone } from '../vm/jsconfuser-vm/decode-standalone.js'

const ADAPTER_SCHEMA = 'jsconfuser-vm-adapter.v1'

/**
 * Recover js-confuser VM source and retain the standalone diagnosis for the caller.
 *
 * The adapter deliberately returns one result-aware record rather than projecting the
 * standalone result to a string. A caller can write `output` and the accompanying
 * `result`/`diagnostic` without diagnosing the source again. Declines are atomic: their
 * output is the exact input source, not a partially emitted program.
 */
export function decodeJsconfuserVm(source) {
  const diagnosis = diagnoseStandalone(source)
  const success = diagnosis.ok
  return Object.freeze({
    schemaVersion: ADAPTER_SCHEMA,
    ok: success,
    status: success ? 'success' : 'declined',
    input: source,
    output: success ? diagnosis.result.output : source,
    result: success ? diagnosis.result : null,
    diagnostic: success ? null : diagnosis.diagnostic,
  })
}

export default decodeJsconfuserVm
