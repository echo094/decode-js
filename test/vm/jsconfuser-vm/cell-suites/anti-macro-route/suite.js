export default {
  name: 'anti-macro-route',
  protects:
    'Macro expansion reads its words through the anti route when anti instrumentation runs beside it. Proved: the anti branch in normalize-macro-wordcode.',
  files: {
    cells: [
      {
        sources: ['caught-return-through-finally'],
        profile: 'macroOpcodes+antiInstrumentation',
        seeds: [98],
      },
    ],
  },
  proofs: [
    {
      claim: 'anti-macro-route',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-macro-wordcode.js',
      find: '  if (anti) {\n    output = unwrapExpansion(',
      replace: '  if (false) {\n    output = unwrapExpansion(',
    },
  ],
}
