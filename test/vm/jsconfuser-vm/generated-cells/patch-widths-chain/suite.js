// PATCH regions over width-changing passes. Proved: the old-test substitutes in proofs.
export default {
  name: 'patch-widths-chain',
  protects:
    'PATCH regions over width-changing passes. Proved: the old-test substitutes in proofs.',
  files: {
    cells: [
      {
        sources: [
          'composition-loop-dependent-calls',
          'f-switch-flow',
          'f-labeled-control',
          'f-finally-abrupt',
          'f-for-in-enumeration',
          'operators',
          'f-short-circuit',
          'f-expression-mutation',
          'f-this-receiver',
          'f-arrow-lexical-state',
          'f-accessors-and-methods',
          'f-literals-order',
          'f-debugger-order',
        ],
        profile:
          'randomizeOpcodes+selfModifying+specializedOpcodes+macroOpcodes+aliasedOpcodes',
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        'A PATCH region holding added opcodes is read with their widths (old patch-added-opcodes).',
      file: 'src/vm/jsconfuser-vm/observe-self-modifying.js',
      code: "            addedOpcodes,\n          )\n          if (!step.ok) unparsed = 'patch-ciphertext'",
    },
  ],
}
