export default {
  name: 'keys-patch-chain',
  protects:
    'Encryption over the final pool keys, with a minified key reader. Not proved by a break: stack only.',
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
        profile: 'randomizeOpcodes+concealConstants+selfModifying+minify',
        seeds: [251, 252, 253],
      },
    ],
  },
}
