export default {
  name: 'flattened-self-modifying',
  protects:
    "A finalizer's flattened tail stays code. Proved: outerScanReaches in observe-self-modifying.",
  files: {
    cells: [
      {
        sources: ['finally-tail', 'composition-finally-abrupt-return'],
        profile: 'controlFlowFlattening+selfModifying',
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim: 'flattened-self-modifying',
      file: 'src/vm/jsconfuser-vm/observe-self-modifying.js',
      code: 'if (!outerScanReaches(code, index, opensBody)) continue',
    },
  ],
}
