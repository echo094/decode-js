export default {
  name: 'try-routed-ends',
  protects:
    'A finally ends where its routed exit lands, past the try, with no label. Proved: the routed tails in vm-switch-statements.',
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
      file: 'src/vm/switch/vm-switch-statements.js',
      code: 'tails = routedEnds(item.head).filter((id) => !enclosing.has(id))',
    },
  ],
}
