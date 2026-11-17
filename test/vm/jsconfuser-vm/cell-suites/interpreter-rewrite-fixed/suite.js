export default {
  name: 'interpreter-rewrite-fixed',
  protects:
    'The payload and handlers are found under a rewrite with one interpreter form, and the decode equals the plain decode. Not proved by a break: coverage only.',
  files: {
    cells: [
      {
        sources: ['composition-finally-abrupt-return'],
        profile: 'randomizeOpcodes+minify',
        seeds: [251],
      },
      {
        sources: ['composition-finally-abrupt-return'],
        profile: 'randomizeOpcodes+handlerTable',
        seeds: [251],
      },
      {
        sources: ['composition-finally-abrupt-return'],
        profile: 'randomizeOpcodes+timingChecks',
        seeds: [251],
      },
      {
        sources: ['composition-finally-abrupt-return'],
        profile: 'randomizeOpcodes+encodeBytecode',
        seeds: [251],
      },
    ],
  },
}
