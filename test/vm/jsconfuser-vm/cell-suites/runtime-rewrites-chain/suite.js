// Lifting and class rewrites over shuffled handlers. Not proved by a break: stack only.
export default {
  name: 'runtime-rewrites-chain',
  protects:
    'Lifting and class rewrites over shuffled handlers. Not proved by a break: stack only.',
  files: {
    cells: [
      {
        sources: ['composition-finally-abrupt-return'],
        profile:
          'randomizeOpcodes+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251],
      },
    ],
  },
}
