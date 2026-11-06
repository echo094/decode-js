export default {
  name: 'dispatcher-keys-anti',
  protects:
    'Concealed constant keys inside anti synthetic cases are restored before the dispatcher and the outer stages read them. Proved: the concealKey test in normalize-anti-wordcode.',
  files: {
    cells: [
      {
        sources: ['checked-throw-finally'],
        profile:
          'stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation',
        seeds: [84],
      },
    ],
  },
  proofs: [
    {
      claim: 'dispatcher-keys-anti',
      file: 'src/vm/jsconfuser-vm/normalize-anti-wordcode.js',
      code: 'operand.concealKey !== 0',
    },
  ],
}
