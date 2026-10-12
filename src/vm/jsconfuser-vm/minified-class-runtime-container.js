import {
  EXPECTED_OPCODES,
  EXPECTED_SENTINELS,
  EXPECTED_SLOTS,
} from './container-role-helpers.js'
import { minifiedRuntimeContainer } from './minified-runtime-container.js'

// The complete source observer proves these canonical definitions. Runtime
// declaration names are not consumed by the numeric frontend.
export function minifiedClassRuntimeContainer(observation) {
  const { boot } = observation
  return minifiedRuntimeContainer({
    words: boot.words,
    pool: boot.pool,
    opcodes: EXPECTED_OPCODES,
    sentinels: EXPECTED_SENTINELS,
    slots: EXPECTED_SLOTS,
    root: { startPc: boot.frame.startPc, regCount: boot.root.regCount },
    frame: boot.frame,
  })
}
