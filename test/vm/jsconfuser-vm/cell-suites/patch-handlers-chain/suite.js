// The PATCH handler lifted and renamed. Proved: the breaks in proofs.
export default {
  name: 'patch-handlers-chain',
  protects:
    'The PATCH handler lifted and renamed. Proved: the breaks in proofs.',
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
        seeds: [251],
      },
    ],
  },
  proofs: [
    {
      claim: 'Handlers are found through a handler table as well as a switch.',
      file: 'src/vm/jsconfuser-vm/handlers/locate-handlers.js',
      find: 'this.dispatch = (switches[0] ?? tableCalls[0]).node',
      replace: 'this.dispatch = switches[0].node',
    },
  ],
}
