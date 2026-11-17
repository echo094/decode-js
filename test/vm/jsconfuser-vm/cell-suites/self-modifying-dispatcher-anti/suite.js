export default {
  name: 'self-modifying-dispatcher-anti',
  protects:
    "Anti decoys inside self-modifying code behind a dispatcher are removed with no address, and the dispatcher's hidden labels settle. Proved: decoy removal in normalize-anti-wordcode and settle in diagnose-standalone.",
  files: {
    cells: [
      {
        sources: ['loop-sum'],
        profile:
          'selfModifying+dispatcher+stringConcealing+antiInstrumentation',
        seeds: [2, 7],
      },
    ],
  },
  proofs: [
    {
      claim: 'self-modifying-dispatcher-anti',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-anti-wordcode.js',
      find: '    if (decoys.has(instruction.pc)) continue\n',
      replace: '',
    },
    {
      claim: 'self-modifying-dispatcher-anti',
      file: 'src/vm/jsconfuser-vm/diagnose-standalone.js',
      find: 'this.adoptRoute(normalized.result)\n      this.settle()',
      replace: '',
    },
  ],
}
