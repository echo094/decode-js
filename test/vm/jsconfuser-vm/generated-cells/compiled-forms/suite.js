export default {
  name: 'compiled-forms',
  protects:
    'The backend recovers each JavaScript form from plain compiled code. Proved: the old-test substitutes in proofs.',
  files: {
    'control-branch': [
      {
        sources: [
          'f-branching',
          'f-loop-forms',
          'f-loop-abrupt',
          'composition-loop-dependent-calls',
          'loop-sharing-cff-prefix',
        ],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'control-switch': [
      {
        sources: [
          'f-switch-flow',
          'terminal-switch-arms',
          'switch-no-default',
          'try-in-switch-catch-break',
          'try-in-switch-both-break',
          'switch-catch-break-falling-tail',
        ],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'control-label': [
      {
        sources: [
          'f-labeled-control',
          'label-switch',
          'label-while',
          'label-do-while',
          'label-for-in',
          'nested-exit-past-tail',
          'try-exit-past-tail',
          'try-exits-two-ends',
          'catch-exit-past-tail',
          'catch-else-exit-past-tail',
          'exit-before-and-from-try',
          'catch-exit-before-and-from-try',
          'loop-exit-to-try-end',
          'loop-exit-to-completing-try-end',
          'catch-exit-past-throwing-try',
          'switch-exit-past-tail',
          'conditional-exits-two-ends',
          'inner-exit-past-merge',
        ],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'control-try': [
      {
        sources: [
          'f-throw-catch',
          'f-finally-abrupt',
          'composition-finally-abrupt-return',
          'return-through-finally',
          'caught-return-through-finally',
          'protected-conditional-catch',
          'f-instanceof-errors',
          'dead-code',
          'top-level-finally',
          'abrupt-finally-return',
        ],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'control-forin': [
      {
        sources: ['f-for-in-enumeration'],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'expr-operators': [
      {
        sources: [
          'operators',
          'f-expression-values',
          'focused-unary-positive-coercion',
          'negation-compare',
        ],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'expr-compare': [
      {
        sources: ['f-short-circuit'],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'expr-assign': [
      {
        sources: [
          'f-expression-mutation',
          'focused-store-global-assignment',
          'compound-arith',
          'compound-bitwise',
          'update-prefix',
          'delete-primitive-target',
        ],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'expr-call': [
      {
        sources: [
          'f-functions-call-return',
          'f-spread-order',
          'focused-call-method-spread',
          'focused-new-spread',
          'f-this-explicit',
          'f-this-receiver',
          'composition-receiver-mutation',
        ],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'fn-closure': [
      {
        sources: [
          'f-closures-state',
          'composition-closure-upvalue',
          'f-arrow-forms',
          'f-arrow-lexical-state',
          'f-functions-params',
          'f-functions-rest',
        ],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'data-object': [
      {
        sources: [
          'f-accessors-and-methods',
          'composition-accessor-evaluation-order',
          'computed-accessors',
          'array-holes',
        ],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'data-literal': [
      {
        sources: ['f-literals-order', 'f-template-literals', 'f-regexp-state'],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
    'host-effect': [
      {
        sources: ['f-debugger-order', 'f-global-resolution', 'empty-statement'],
        profile: 'randomizeOpcodes',
        seeds: [251],
      },
    ],
  },
  // Copy coalescing leaves no producer-and-move pair the source does not have.
  indicators: {
    'compound-arith': ['copies'],
    'compound-bitwise': ['copies'],
    operators: ['copies'],
    'f-branching': ['copies'],
  },
  proofs: [
    {
      claim:
        'A producer and its private move read as one statement, as in the source (old vm-copy-simplification).',
      file: 'src/vm/switch/vm-switch-copy-planning.js',
      code: '    if (plan.has(producer.pc) || coalescedMovePcs.has(move.pc)) return',
    },
    {
      claim:
        'Natural loops become structured loops, with protected throws, returns through finalizers and compound tests (old decode-standalone, vm-switch-statements).',
      file: 'src/vm/switch/vm-switch-statements.js',
      code: "entries.push({ kind: 'loop', head: target })",
    },
    {
      claim:
        'Catch setups are read as protected regions (old exception-region-parser exceptionRoutes, try-region, control-solver).',
      file: 'src/vm/switch/vm-switch-control.js',
      code: "    if (operation.kind === 'catch-setup')",
    },
    {
      claim:
        "A finally's throw pad is its own operand (old exception-region-parser, runtime-finalizers).",
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      code: 'throwPad: target(o[3]),',
    },
    {
      claim:
        'The spread sentinel comes from the container (old read-wordcode, randomized-class spread).',
      file: 'src/vm/jsconfuser-vm/read-wordcode.js',
      code: 'names.sentinel = container.roles.sentinels.values.CALL_SPREAD',
    },
    {
      claim:
        'A copy coalesces only with a producer it alone uses, so effectful producers stay (old vm-copy-simplification, owned-chain-source).',
      file: 'src/vm/switch/vm-switch-copy-planning.js',
      code: '    if (sites.length !== 1 || sites[0].pc !== move.pc) return',
    },
    {
      claim:
        'A closure creation site enters a child function (old partition-functions, owned-chain-source).',
      file: 'src/vm/jsconfuser-vm/partition-functions.js',
      code: '    if (child.id === parentId)\n',
    },
    {
      claim:
        'A captured register stays within the frame (old validate-references).',
      file: 'src/vm/jsconfuser-vm/validate-references.js',
      code: "if (capture.kind === 'local' && capture.index >= maxRegisterCount) {",
    },
  ],
}
