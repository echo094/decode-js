export default {
  name: 'try-routed-ends',
  protects:
    'A finally ends where its routed exit lands, past the try, with no label. Proved: the routed tails in try-ends.',
  files: {
    cells: [
      {
        sources: ['try-routed-ends'],
        profile: 'baseline',
        seeds: [1],
      },
    ],
  },
  proofs: [
    {
      claim: 'try-routed-ends',
      file: 'src/vm/switch/statements/try-ends.js',
      find: 'tails = this.routedEnds(head).filter((id) => !enclosing.has(id))',
      replace: '',
    },
  ],
}
