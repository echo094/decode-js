export default {
  name: 'anti-alias-route',
  protects:
    'Alias projection reads the word stream through the anti observation, so anti classification stops before a one-step alias handler. Proved: the anti word stream in normalize-aliased-wordcode.',
  files: {
    cells: [
      {
        sources: ['caught-return-through-finally'],
        profile: 'aliasedOpcodes+antiInstrumentation',
        seeds: [113],
      },
    ],
  },
  proofs: [
    {
      claim: 'anti-alias-route',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-aliased-wordcode.js',
      find: ': diagnoseAntiWordStream(normalized, anti),',
      replace:
        ': diagnoseSpecializedWordStream(normalized, specialized, anti),',
    },
  ],
}
