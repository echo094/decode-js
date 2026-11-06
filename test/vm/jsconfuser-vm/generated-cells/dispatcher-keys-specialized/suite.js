export default {
  name: 'dispatcher-keys-specialized',
  protects:
    "A specialized instruction's concealed constant key is restored before the dispatcher reads it. Proved: the concealKey test in normalize-specialized-wordcode.",
  files: {
    cells: [
      {
        sources: ['constant-arithmetic'],
        profile:
          'stringConcealing+controlFlowFlattening+dispatcher+concealConstants+specializedOpcodes',
        seeds: [88],
      },
    ],
  },
  proofs: [
    {
      claim: 'dispatcher-keys-specialized',
      file: 'src/vm/jsconfuser-vm/normalize-specialized-wordcode.js',
      code: 'operand.concealKey !== 0',
    },
  ],
}
