export default {
  name: 'single-payload-stage',
  protects:
    "One stage's decoder removes that stage from a program; sources are the fewest that reach all its code (audit/source-cover.mjs). Proved: the old-test substitutes in proofs.",
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
        seeds: [251, 252, 253],
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
        seeds: [251, 252, 253],
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
        seeds: [251, 252, 253],
      },
    ],
    'conceal-constants': [
      {
        sources: ['focused-store-global-assignment', 'no-string-pool'],
        profile: 'randomizeOpcodes+concealConstants',
        seeds: [251, 252, 253],
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
        seeds: [251, 252, 253],
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
        seeds: [251, 252, 253],
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
        seeds: [251, 252, 253],
      },
    ],
    'aliased-opcodes': [
      {
        sources: ['program-sha256', 'composition-finally-abrupt-return'],
        profile: 'randomizeOpcodes+aliasedOpcodes',
        seeds: [251, 252, 253],
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
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        'The real step of each anti synthetic case, MOD included (old analyze-anti-register-flow, normalize-anti-wordcode).',
      file: 'src/vm/jsconfuser-vm/analyze-anti-register-flow.js',
      code: '  MOD: 3,\n',
    },
    {
      claim:
        'The stored permutation of synthetic operands (old analyze-anti-runtime, normalize-anti-routing-combinations).',
      file: 'src/vm/jsconfuser-vm/analyze-anti-runtime.js',
      code: 'const canonicalToStored = found.steps.flatMap((step) => step.reads)',
    },
    {
      claim:
        'Each synthetic step owns its own operand span (old analyze-anti-runtime).',
      file: 'src/vm/jsconfuser-vm/analyze-anti-runtime.js',
      code: '      operandStart += step.reads.length',
    },
    {
      claim:
        "Only the flattener's own fake blocks are removed (old normalize-cff-wordcode).",
      file: 'src/vm/jsconfuser-vm/normalize-cff-wordcode.js',
      code: '      fakeForms.add(start)',
    },
    {
      claim:
        'Each concealed constant use keeps its own key and site (old normalize-concealed-constants, normalize-anti-concealed-constants).',
      file: 'src/vm/jsconfuser-vm/normalize-concealed-constants.js',
      code: '      keys.set(index, key)\n      pairs.push({ index, key, keyPc: instruction.pc + offset })',
    },
    {
      claim:
        'Dispatcher routes are observed in every function (old normalize-dispatcher-wordcode).',
      file: 'src/vm/jsconfuser-vm/observe-dispatcher-wordcode.js',
      code: '  for (const owner of functions.functions) {',
    },
    {
      claim:
        'A macro step that jumps ends its macro (old normalize-macro-wordcode, normalize-macro-combinations).',
      file: 'src/vm/jsconfuser-vm/observe-macro-runtime.js',
      code: '(NONTERMINAL_EXCLUDED.has(step.name) && index !== steps.length - 1)',
    },
    {
      claim:
        'A macro is canonical handlers in sequence with operands read in order (old identify-handlers).',
      file: 'src/vm/jsconfuser-vm/identify-handlers.js',
      code: 'if (ways.length !== 1 || ways[0].length < 2) return null',
    },
    {
      claim:
        "Specialized operands become the expanded instruction's words (old normalize-specialized-wordcode).",
      file: 'src/vm/jsconfuser-vm/observe-specialized-runtime.js',
      code: '      operands: found.operands,',
    },
    {
      claim:
        'A decoy PATCH header is skipped and does not end the code scan (old self-modifying-observation).',
      file: 'src/vm/jsconfuser-vm/observe-self-modifying.js',
      code: 'storageStart = Math.min(storageStart, destPc, sourceStart)',
    },
  ],
}
