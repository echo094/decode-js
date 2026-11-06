export default {
  name: 'dispatcher-specialized-chain',
  protects:
    'Dispatcher addresses stay correct after specialized expansion with no anti, a route all-stages-together does not take. Proved: decodedTargetMap in normalize-specialized-wordcode.',
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
          'f-loop-forms',
        ],
        profile: 'randomizeOpcodes+dispatcher+specializedOpcodes',
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim: 'dispatcher-specialized-chain',
      file: 'src/vm/jsconfuser-vm/normalize-specialized-wordcode.js',
      code: 'decodedTargetMap: pcMap,',
    },
  ],
}
