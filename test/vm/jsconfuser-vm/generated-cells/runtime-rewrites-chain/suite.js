// Lifting and class rewrites over shuffled handlers. Proved: the old-test substitutes in proofs.
export default {
  name: 'runtime-rewrites-chain',
  protects:
    'Lifting and class rewrites over shuffled handlers. Proved: the old-test substitutes in proofs.',
  files: {
    cells: [
      {
        sources: ['composition-finally-abrupt-return'],
        profile:
          'randomizeOpcodes+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        "The payload is the boot call's single word stream and pool under minified and class runtimes (old extract-container, minified-class-*, minified-runtime, randomized-minified-class).",
      file: 'src/vm/jsconfuser-vm/locate-boot-payload.js',
      code: 'if (found.words.length === 1 && found.pools.length === 1)',
    },
  ],
}
