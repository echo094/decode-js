export default {
  name: 'try-do-while-continue',
  protects:
    "A continue through a finally in a do-while enters the loop's bottom test, which reads as do { } while (test). Proved: the bottom test in vm-switch-statements.",
  files: {
    cells: [
      {
        sources: ['try-do-while-continue'],
        profile: 'baseline',
        seeds: [1],
      },
    ],
  },
  proofs: [
    {
      claim: 'try-do-while-continue',
      file: 'src/vm/switch/vm-switch-statements.js',
      code: 'if (end) bottomTests.set(head, before[0])',
    },
  ],
}
