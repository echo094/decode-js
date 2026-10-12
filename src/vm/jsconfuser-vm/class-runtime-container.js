import {
  EXPECTED_OPCODES,
  EXPECTED_SENTINELS,
  EXPECTED_SLOTS,
  decline,
  deepFreeze,
} from './container-role-helpers.js'

import { projectWords } from './materialize-randomized-runtime.js'

function scalar(value) {
  return { name: null, value }
}

export function classRuntimeContainer(observation) {
  let words = [...observation.words.values]
  if (observation.layout) {
    try {
      words = projectWords(
        words,
        observation.layout.opcodes,
        observation.layout.sentinel,
      )
    } catch (error) {
      if (error.code === 'randomized-runtime')
        decline('randomized-class-wordcode', error.message)
      throw error
    }
  }
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-container.v1',
    encoding: 'numeric-u32',
    roles: {
      pool: {
        name: observation.pool.name,
        values: [...observation.pool.values],
      },
      words: {
        name: observation.words.name,
        values: words,
      },
      op: { name: null, values: { ...EXPECTED_OPCODES } },
      sentinels: { name: null, values: { ...EXPECTED_SENTINELS } },
      slots: {
        name: null,
        values: {
          ...(observation.layout ? EXPECTED_SLOTS : observation.slots.values),
        },
      },
      scalars: {
        MAIN_START_PC: scalar(observation.frame.start.value),
        MAIN_REG_COUNT: scalar(observation.frame.regCount.value),
        ENCODE_BYTECODE: scalar(false),
        TIMING_CHECKS: scalar(observation.timingChecks),
        HEADER_SIZE: scalar(
          observation.layout ? 8 : observation.frame.headerSize,
        ),
        FRAME_START: scalar(
          observation.layout ? 1 : observation.slots.frameStart,
        ),
      },
      constructors: {
        Upvalue: { name: observation.methods.upvalue.constructor },
        Closure: { name: observation.root.closureConstructor },
        VM: { name: observation.vm.constructor },
      },
      methods: {
        upvalue: Object.fromEntries(
          ['read', 'write', 'close'].map((role) => [
            role,
            { name: observation.methods.upvalue[role] },
          ]),
        ),
        vm: Object.fromEntries(
          Object.entries(observation.methods.vm).map(([role, name]) => [
            role,
            { name },
          ]),
        ),
      },
      roots: {
        globals: { name: observation.globals.name },
        vm: { name: observation.vm.instance },
        decoder: { name: observation.decoder.name },
        bootMethod: { name: observation.root.method },
      },
    },
  })
}
