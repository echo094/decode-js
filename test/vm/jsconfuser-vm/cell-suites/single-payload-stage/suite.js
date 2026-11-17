export default {
  name: 'single-payload-stage',
  protects:
    "One stage's decoder removes that stage from a program; sources are the fewest that reach all its code (audit/source-cover.mjs). Proved: the breaks in proofs.",
  files: {
    'string-concealing': [
      {
        sources: [
          'program-sha256',
          'composition-finally-abrupt-return',
          'f-expression-values',
          'focused-unary-positive-coercion',
        ],
        profile: 'randomizeOpcodes+stringConcealing',
        seeds: [251],
      },
    ],
    'control-flow-flattening': [
      {
        sources: [
          'composition-finally-abrupt-return',
          'program-sha256',
          'syntax-forms',
          'finally-tail',
        ],
        profile: 'randomizeOpcodes+controlFlowFlattening',
        seeds: [251],
      },
    ],
    dispatcher: [
      {
        sources: [
          'program-sha256',
          'composition-finally-abrupt-return',
          'syntax-forms',
          'f-for-in-enumeration',
          'f-throw-catch',
        ],
        profile: 'randomizeOpcodes+dispatcher',
        seeds: [251],
      },
    ],
    'conceal-constants': [
      {
        sources: ['focused-store-global-assignment', 'no-string-pool'],
        profile: 'randomizeOpcodes+concealConstants',
        seeds: [251],
      },
    ],
    'anti-instrumentation': [
      {
        sources: [
          'program-sha256',
          'finally-tail',
          'focused-unary-positive-coercion',
          'f-for-in-enumeration',
          'composition-accessor-evaluation-order',
        ],
        profile: 'randomizeOpcodes+antiInstrumentation',
        seeds: [251],
      },
    ],
    'specialized-opcodes': [
      {
        sources: [
          'composition-finally-abrupt-return',
          'program-sha256',
          'f-debugger-order',
        ],
        profile: 'randomizeOpcodes+specializedOpcodes',
        seeds: [251],
      },
    ],
    'macro-opcodes': [
      {
        sources: [
          'composition-finally-abrupt-return',
          'program-sha256',
          'f-expression-values',
          'f-for-in-enumeration',
        ],
        profile: 'randomizeOpcodes+macroOpcodes',
        seeds: [251],
      },
    ],
    'aliased-opcodes': [
      {
        sources: ['program-sha256', 'composition-finally-abrupt-return'],
        profile: 'randomizeOpcodes+aliasedOpcodes',
        seeds: [251],
      },
    ],
    'self-modifying': [
      {
        sources: [
          'finally-tail',
          'program-sha256',
          'composition-accessor-evaluation-order',
          'composition-finally-abrupt-return',
          'f-throw-catch',
        ],
        profile: 'randomizeOpcodes+selfModifying',
        seeds: [251],
      },
    ],
  },
  proofs: [
    {
      claim: 'The real step of each anti synthetic case, MOD included.',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-anti-register-flow.js',
      find: '  MOD: 3,\n',
      replace: '',
    },
    {
      claim: 'The stored permutation of synthetic operands.',
      file: 'src/vm/jsconfuser-vm/observe/observe-anti-runtime.js',
      find: 'const canonicalToStored = found.steps.flatMap((step) => step.reads)',
      replace:
        'const canonicalToStored = found.steps.flatMap((step) => step.reads).sort((a, b) => a - b)',
    },
    {
      claim: 'Each synthetic step owns its own operand span.',
      file: 'src/vm/jsconfuser-vm/observe/observe-anti-runtime.js',
      find: '      operandStart += step.reads.length',
      replace: '',
    },
    {
      claim: "Only the flattener's own fake blocks are removed.",
      file: 'src/vm/jsconfuser-vm/normalize/cff-state-loop.js',
      find: 'if (currentState !== undefined && this.fakeForm(segment, currentState))\n      this.fakeForms.add(start)',
      replace:
        'if (currentState !== undefined)\n      this.fakeForms.add(start)',
    },
    {
      claim: 'Each concealed constant use keeps its own key and site.',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-concealed-constants.js',
      find: '      keys.set(index, key)\n      pairs.push({ index, key, keyPc: instruction.pc + offset })',
      replace: '',
    },
    {
      claim: 'Dispatcher routes are observed in every function.',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-dispatcher-wordcode.js',
      find: '  for (const owner of functions.functions) {\n    const plan = observeOwner(owner, context)',
      replace:
        '  for (const owner of functions.functions.slice(0, 1)) {\n    const plan = observeOwner(owner, context)',
    },
    {
      claim: "Specialized operands become the expanded instruction's words.",
      file: 'src/vm/jsconfuser-vm/observe/observe-specialized-runtime.js',
      find: '      operands: found.operands,\n    })',
      replace: '      operands: found.operands.map(() => 0),\n    })',
    },
    {
      claim: 'A decoy PATCH header is skipped and does not end the code scan.',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-self-modifying-regions.js',
      find: "    this.instructions.push({ pc, name: 'DECOY', nextPc: pc + 5, width: 5 })\n    return pc + 5",
      replace: '    return null',
    },
  ],
}
