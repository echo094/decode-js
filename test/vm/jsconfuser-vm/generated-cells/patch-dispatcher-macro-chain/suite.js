const macroPatch = 'dispatcher+macroOpcodes+selfModifying'

// PATCH regions behind a dispatcher, under macro opcodes. Proved: the suspect read-past in proofs.
export default {
  name: 'patch-dispatcher-macro-chain',
  protects:
    'PATCH suspects behind a dispatcher are read past by every component until settled, under macro opcodes: a filler LOAD_INT naming a finally continuation register keeps its words. Proved: the suspect read-past in finally-continuations.',
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
          'suspect-continuation-loop-finally',
        ],
        profile: `randomizeOpcodes+${macroPatch}`,
        seeds: [251, 252, 253],
      },
    ],
    // The recorded cells where a filler drew a continuation register (Plan step 3); the third
    // recorded source equals f-finally-abrupt, whose seed 253 cell above is that case.
    'suspect-filler-loads': [
      {
        sources: [
          'suspect-continuation-loop-finally',
          'suspect-continuation-one-finally',
        ],
        profile: `controlFlowFlattening+${macroPatch}`,
        seeds: [253],
      },
      {
        sources: ['suspect-continuation-loop-finally'],
        profile: macroPatch,
        seeds: [253],
      },
      {
        sources: ['suspect-continuation-one-finally'],
        profile: `randomizeOpcodes+controlFlowFlattening+${macroPatch}`,
        seeds: [251],
      },
    ],
  },
  proofs: [
    {
      claim:
        'A PATCH suspect neither names nor loads a finally continuation register (Plan step 3).',
      file: 'src/vm/jsconfuser-vm/finally-continuations.js',
      code: 'const read = items.filter((item) => !suspects.has(item.pc))',
    },
  ],
}
