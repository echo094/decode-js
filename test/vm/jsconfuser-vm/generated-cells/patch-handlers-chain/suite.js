// The PATCH handler lifted and renamed. Proved: the old-test substitutes in proofs.
export default {
  name: 'patch-handlers-chain',
  protects:
    'The PATCH handler lifted and renamed. Proved: the old-test substitutes in proofs.',
  files: {
    cells: [
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
        profile: 'randomizeOpcodes+selfModifying+handlerTable+classObfuscation',
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        'Handlers are found through a handler table as well as a switch (old handler-table-combinations, class-runtime-combinations).',
      file: 'src/vm/jsconfuser-vm/locate-handlers.js',
      code: '(switches[0] ?? tableCalls[0]).node',
    },
  ],
}
