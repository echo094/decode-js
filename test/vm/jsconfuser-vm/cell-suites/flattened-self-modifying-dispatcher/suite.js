export default {
  name: 'flattened-self-modifying-dispatcher',
  protects:
    "The same tail under a dispatcher's hidden labels. Proved: settle's anchor test in normalize-self-modifying-wordcode.",
  files: {
    cells: [
      {
        sources: ['finally-tail', 'composition-finally-abrupt-return'],
        profile: 'controlFlowFlattening+selfModifying+dispatcher',
        seeds: [251],
      },
    ],
  },
  proofs: [
    {
      claim:
        'PATCH regions are materialized under dispatcher layers and finalizers.',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-self-modifying-regions.js',
      find: '    this.words.splice(destPc, width, ...clear)',
      replace: '',
    },
    {
      claim: 'flattened-self-modifying-dispatcher',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-self-modifying-wordcode.js',
      find: 'anchor !== undefined && !outerScanReaches(instructions, anchor, labels)',
      replace: 'anchor !== undefined',
    },
  ],
}
