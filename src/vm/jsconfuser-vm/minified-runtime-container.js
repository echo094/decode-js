import { deepFreeze } from './container-role-helpers.js'

const scalar = (value) => ({ name: null, value })

export function minifiedRuntimeContainer(observation) {
  return deepFreeze({
    schemaVersion: 'jsconfuser-vm-container.v1',
    encoding: 'numeric-u32',
    roles: {
      pool: { name: null, values: [...observation.pool] },
      words: { name: null, values: [...observation.words] },
      op: { name: null, values: { ...observation.opcodes } },
      sentinels: { name: null, values: { ...observation.sentinels } },
      slots: { name: null, values: { ...observation.slots } },
      scalars: {
        MAIN_START_PC: scalar(observation.root.startPc),
        MAIN_REG_COUNT: scalar(observation.root.regCount),
        ENCODE_BYTECODE: scalar(false),
        TIMING_CHECKS: scalar(false),
        HEADER_SIZE: scalar(observation.frame.headerSize),
        FRAME_START: scalar(observation.frame.frameStart),
      },
      constructors: {
        Upvalue: { name: null },
        Closure: { name: null },
        VM: { name: null },
      },
      methods: {
        upvalue: Object.fromEntries(
          ['read', 'write', 'close'].map((role) => [role, { name: null }]),
        ),
        vm: Object.fromEntries(
          [
            'operand',
            'pushFrame',
            'captureUpvalue',
            'constant',
            'closeUpvalues',
            'run',
          ].map((role) => [role, { name: null }]),
        ),
      },
      roots: {
        globals: { name: null },
        vm: { name: null },
        decoder: { name: null },
        bootMethod: { name: null },
      },
    },
  })
}
