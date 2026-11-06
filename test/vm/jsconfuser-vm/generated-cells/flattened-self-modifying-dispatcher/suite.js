export default {
  name: 'flattened-self-modifying-dispatcher',
  protects:
    "The same tail under a dispatcher's hidden labels. Proved: settle's anchor test in normalize-self-modifying-wordcode.",
  files: {
    cells: [
      {
        sources: ['finally-tail', 'composition-finally-abrupt-return'],
        profile: 'controlFlowFlattening+selfModifying+dispatcher',
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        'PATCH regions are materialized under dispatcher layers and finalizers (old normalize-self-modifying-wordcode, patch-added-opcodes).',
      file: 'src/vm/jsconfuser-vm/observe-self-modifying.js',
      code: '        words.splice(destPc, width, ...clear)',
    },
    {
      claim: 'flattened-self-modifying-dispatcher',
      file: 'src/vm/jsconfuser-vm/normalize-self-modifying-wordcode.js',
      code: '!outerScanReaches(instructions, anchor, ({ pc }) => labels.has(pc))',
    },
  ],
}
