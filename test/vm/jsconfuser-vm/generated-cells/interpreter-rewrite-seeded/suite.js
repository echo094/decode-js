export default {
  name: 'interpreter-rewrite-seeded',
  protects:
    "The payload and handlers are found when the interpreter's form changes with the seed, and the decode equals the plain decode. Proved: the old-test substitutes in proofs.",
  files: {
    cells: [
      {
        sources: ['composition-finally-abrupt-return'],
        profile: 'randomizeOpcodes+shuffleOpcodes',
        seeds: [251, 252, 253],
      },
      {
        sources: ['composition-finally-abrupt-return'],
        profile: 'randomizeOpcodes+classObfuscation',
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        'The opcode table is the one matched from the runtime, under randomized and remapped opcodes (old randomized-class).',
      file: 'src/vm/jsconfuser-vm/locate-boot-payload.js',
      code: '    opcodes: meaning\n      ? { ...createOpcodeTable(), ...meaning.opcodes }\n      : createOpcodeTable(),',
    },
  ],
}
