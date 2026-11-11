// Timing poisoning through the rewritten runtime. Proved: the old-test substitutes in proofs.
export default {
  name: 'timing-runtime-chain',
  protects:
    'Timing poisoning through the rewritten runtime. Proved: the old-test substitutes in proofs.',
  files: {
    cells: [
      {
        sources: ['composition-finally-abrupt-return'],
        profile:
          'randomizeOpcodes+timingChecks+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        'Finalizer throw pads under timing, patch, encoded and table runtimes (old runtime-finalizers.behavior).',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      code: 'throwPad: target(o[3]),',
    },
  ],
}
