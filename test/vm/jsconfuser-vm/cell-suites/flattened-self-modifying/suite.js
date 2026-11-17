export default {
  name: 'flattened-self-modifying',
  protects:
    "A finalizer's flattened tail stays code. Proved: outerScanReaches in analyze-self-modifying-regions.",
  files: {
    cells: [
      {
        sources: ['finally-tail', 'composition-finally-abrupt-return'],
        profile: 'controlFlowFlattening+selfModifying',
        seeds: [251],
      },
    ],
  },
  proofs: [
    {
      claim: 'flattened-self-modifying',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-self-modifying-regions.js',
      find: 'if (!outerScanReaches(code, index, visible, PATCH_OPENS)) continue',
      replace: '',
    },
  ],
}
