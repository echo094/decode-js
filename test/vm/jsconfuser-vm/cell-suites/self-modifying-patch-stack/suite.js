export default {
  name: 'self-modifying-patch-stack',
  protects:
    'Under every added-opcode stage, a PATCH header whose region does not decrypt to whole instructions ends the code scan as storage instead of declining. Proved: the patch-ciphertext storage end in analyze-self-modifying-regions.',
  files: {
    cells: [
      {
        sources: ['finalizer-saved-closure'],
        profile:
          'selfModifying+aliasedOpcodes+macroOpcodes+specializedOpcodes+antiInstrumentation',
        seeds: [232],
      },
    ],
  },
  proofs: [
    {
      claim: 'self-modifying-patch-stack',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-self-modifying-regions.js',
      find: "if (!step.ok) return { unparsed: 'patch-ciphertext' }",
      replace: '',
    },
  ],
}
