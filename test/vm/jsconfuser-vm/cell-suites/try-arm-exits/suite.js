export default {
  name: 'try-arm-exits',
  protects:
    "A try that never completes normally inside a conditional arm leaves through the arm with no label. Proved: the try end in a conditional's arm in conditionals.",
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
      file: 'src/vm/switch/statements/conditionals.js',
      find: 'fallthrough.ends.has(tryEnd) &&',
      replace: '',
    },
  ],
}
