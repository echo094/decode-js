export default {
  name: 'string-flow-chain',
  protects:
    'Each later pass treats the string helpers as ordinary code. Proved: restoring the finally continuation remap and reach in normalize-string-concealing.',
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
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        'Stacked string helpers are restored under flattening and the dispatcher (old normalize-string-concealing, normalize-string-concealing-combinations).',
      file: 'src/vm/jsconfuser-vm/normalize-string-concealing.js',
      code: '        const poolIndex = pool.length + replacements.size',
    },
    {
      claim: 'string-flow-chain',
      file: 'src/vm/jsconfuser-vm/normalize-string-concealing.js',
      code: 'if (continuationLoads.has(part.pc)) raw[2] = remap(raw[2], part)',
    },
    {
      claim: 'string-flow-chain',
      file: 'src/vm/jsconfuser-vm/normalize-string-concealing.js',
      code: 'if (continuationLoads.has(item.pc)) pending.push(item.words[2])',
    },
  ],
}
