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
      file: 'src/vm/jsconfuser-vm/normalize-anti-wordcode.js',
      code: '    if (decoys.has(instruction.pc)) continue\n',
    },
    {
      claim: 'self-modifying-dispatcher-anti',
      file: 'src/vm/jsconfuser-vm/diagnose-standalone.js',
      code: 'if (settle()) records = {}',
    },
  ],
}
