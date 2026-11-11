export default {
  name: 'anti-alias-route',
  protects:
    'Alias projection reads the word stream through the anti observation, so anti classification stops before a one-step alias handler. Proved: the anti word stream in normalize-aliased-wordcode.',
  files: {
    cells: [
      {
        sources: ['checked-throw-finally'],
        profile: 'aliasedOpcodes+antiInstrumentation',
        seeds: [113],
      },
    ],
  },
  proofs: [
    {
      claim: 'anti-alias-route',
      file: 'src/vm/jsconfuser-vm/normalize-aliased-wordcode.js',
      code: ': diagnoseAntiWordStream(normalized, anti),',
    },
  ],
}
