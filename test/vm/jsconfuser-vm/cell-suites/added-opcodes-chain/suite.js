export default {
  name: 'added-opcodes-chain',
  protects:
    'Anti, specialized, macro and alias each read the previous output. Proved: alias macro tail in normalize-aliased-wordcode.',
  files: {
    cells: [
      {
        sources: [
          'composition-loop-dependent-calls',
          'f-switch-flow',
          'f-labeled-control',
          'f-finally-abrupt',
          'f-for-in-enumeration',
          'operators',
          'f-short-circuit',
          'f-expression-mutation',
          'f-this-receiver',
          'f-arrow-lexical-state',
          'f-accessors-and-methods',
          'f-literals-order',
          'f-debugger-order',
        ],
        profile:
          'randomizeOpcodes+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes',
        seeds: [251],
      },
    ],
  },
  proofs: [
    {
      claim:
        'Alias operands restored to canonical order, alone and after macro.',
      file: 'src/vm/jsconfuser-vm/wordcode/wordcode-instructions.js',
      find: 'const canonical = definition.canonicalToStored.map((index) => stored[index])',
      replace: 'const canonical = stored',
    },
    {
      claim:
        'Only alias handlers count as aliases, so the added opcode kinds stay apart.',
      file: 'src/vm/jsconfuser-vm/observe/observe-aliased-runtime.js',
      find: "    if (found?.kind !== 'alias') continue",
      replace: '',
    },
    {
      claim: 'added-opcodes-chain',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-aliased-wordcode.js',
      find: 'allowMacroTail: true,',
      replace: '',
    },
  ],
}
