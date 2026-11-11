export default {
  name: 'compiled-forms-canonical-opcodes',
  protects:
    "The same forms recover with the encoder's original opcode numbers. Not proved by a break: control only.",
  files: {
    representatives: [
      {
        sources: [
          'composition-loop-dependent-calls',
          'f-switch-flow',
          'f-labeled-control',
          'f-finally-abrupt',
          'f-for-in-enumeration',
          'operators',
          'f-short-circuit',
          'f-expression-mutation',
          'f-this-receiver',
          'f-arrow-lexical-state',
          'f-accessors-and-methods',
          'f-literals-order',
          'f-debugger-order',
        ],
        profile: 'baseline',
        seeds: [251],
      },
    ],
  },
}
