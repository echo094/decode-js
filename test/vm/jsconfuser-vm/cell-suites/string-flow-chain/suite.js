export default {
  name: 'string-flow-chain',
  protects:
    'Each later pass treats the string helpers as ordinary code. Proved: the finally continuation remap in normalize-string-concealing.',
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
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher',
        seeds: [251],
      },
    ],
  },
  proofs: [
    {
      claim:
        'Stacked string helpers are restored under flattening and the dispatcher.',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-string-concealing.js',
      find: 'const poolIndex = this.pool.length + this.replacements.size',
      replace: 'const poolIndex = this.pool.length',
    },
    {
      claim:
        "A finally continuation's target is remapped when the string helpers are removed.",
      file: 'src/vm/jsconfuser-vm/normalize/normalize-string-concealing.js',
      find: 'if (continuationLoads.has(part.pc)) raw[2] = remap(raw[2], part)',
      replace: '',
    },
  ],
}
