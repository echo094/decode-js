export default {
  name: 'labeled-exit-forms',
  protects:
    "Labeled exits past a loop's own exit get a statement label only where nothing else holds them: several such ends, a tail that is itself a loop, a for-in. Proved: the loop's blockEnds in closeLaterExits, vm-switch-statements.",
  files: {
    cells: [
      {
        sources: ['labeled-exit-forms'],
        profile: 'baseline',
        seeds: [1],
      },
    ],
  },
  proofs: [
    {
      claim: 'labeled-exit-forms',
      file: 'src/vm/switch/vm-switch-statements.js',
      code: '      : { end, blockEnds: ends }',
    },
  ],
}
