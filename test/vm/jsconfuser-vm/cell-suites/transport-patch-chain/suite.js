export default {
  name: 'transport-patch-chain',
  protects:
    'Encoded transport over encrypted regions, with a minified key reader. Proved: the breaks in proofs.',
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
        profile: 'randomizeOpcodes+encodeBytecode+selfModifying+minify',
        seeds: [251],
      },
    ],
  },
  proofs: [
    {
      claim: 'The encoded transport is read as little-endian words.',
      file: 'src/vm/jsconfuser-vm/source/materialize-encoded-bytecode.js',
      find: 'bytes.readUInt32LE(index * 4),',
      replace: 'bytes.readUInt32BE(index * 4),',
    },
  ],
}
