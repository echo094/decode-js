export default {
  name: 'transport-patch-chain',
  protects:
    'Encoded transport over encrypted regions, with a minified key reader. Proved: the old-test substitutes in proofs.',
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
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        'The encoded transport is read as little-endian words (old encoded-bytecode-combinations, minified-self-modifying-encoded, diagnose-standalone).',
      file: 'src/vm/jsconfuser-vm/materialize-encoded-bytecode.js',
      code: 'bytes.readUInt32LE(index * 4),',
    },
    {
      claim:
        'The payload is reached by structure through renamed bindings (old extract-container, runtime-binding-identities).',
      file: 'src/vm/jsconfuser-vm/locate-boot-payload.js',
      code: '      if (seen.has(node.name)) return found',
    },
  ],
}
