// PATCH regions over width-changing passes. Proved: the breaks in proofs.
export default {
  name: 'patch-widths-chain',
  protects:
    'PATCH regions over width-changing passes. Proved: the breaks in proofs.',
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
        seeds: [251],
      },
    ],
  },
  proofs: [
    {
      claim: 'A PATCH region holding added opcodes is read with their widths.',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-self-modifying-regions.js',
      find: '        offset,\n        this.addedOpcodes,\n      )\n      if (!step.ok)',
      replace: '        offset,\n      )\n      if (!step.ok)',
    },
  ],
}
