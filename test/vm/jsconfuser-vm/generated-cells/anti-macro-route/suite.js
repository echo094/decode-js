export default {
  name: 'anti-macro-route',
  protects:
    'Macro expansion reads its words through the anti route when anti instrumentation runs beside it. Proved: the anti branch in normalize-macro-wordcode.',
  files: {
    cells: [
      {
        sources: ['checked-throw-finally'],
        profile: 'macroOpcodes+antiInstrumentation',
        seeds: [98],
      },
    ],
  },
  proofs: [
    {
      claim: 'anti-macro-route',
      file: 'src/vm/jsconfuser-vm/normalize-macro-wordcode.js',
      code: '  if (anti) {\n    output = requireObservation(',
    },
  ],
}
