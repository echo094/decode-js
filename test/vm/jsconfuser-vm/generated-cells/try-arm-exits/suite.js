export default {
  name: 'try-arm-exits',
  protects:
    "A try that never completes normally inside a conditional arm leaves through the arm with no label. Proved: the try end in a conditional's arm in vm-switch-statements.",
  files: {
    cells: [
      {
        sources: ['try-arm-exits'],
        profile: 'baseline',
        seeds: [1],
      },
    ],
  },
  proofs: [
    {
      claim: 'try-arm-exits',
      file: 'src/vm/switch/vm-switch-statements.js',
      code: 'reached.get(fallthroughId).has(tryEnd) &&',
    },
  ],
}
