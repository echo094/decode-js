export default {
  name: 'compiled-forms',
  protects:
    'The backend recovers each JavaScript form from plain compiled code. Proved: the breaks in proofs.',
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
        sources: ['f-short-circuit', 'numeric-edges'],
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
        sources: ['f-literals-order', 'f-template-literals'],
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
  // Copy coalescing leaves no producer-and-move pair the source does not have; an object literal is
  // written as one literal, its accessors native.
  indicators: {
    'compound-arith': ['copies'],
    'compound-bitwise': ['copies'],
    operators: ['copies'],
    'f-branching': ['copies'],
    'f-accessors-and-methods': ['copies', 'objectProperties', 'accessors'],
    'composition-accessor-evaluation-order': ['objectProperties', 'accessors'],
    'computed-accessors': ['copies', 'objectProperties', 'accessors'],
    'f-literals-order': ['copies', 'objectProperties'],
    // A for-in step writes the source's key variable, which its body reads; the loop is a native
    // for-in, with no enumeration helper.
    'f-for-in-enumeration': ['copies', 'forIns', 'scaffolding'],
    // A conditional value in a literal is written in its slot; a logical value in its use.
    'f-short-circuit': ['objectProperties', 'conditionals', 'logicals'],
    // A method call, a member write and a global read are written natively, as the source has them
    // (f-this-receiver's `.call({ value: 9 })`: the literal folds into its argument, so the callee
    // read folds too).
    'f-this-receiver': [
      'methodCalls',
      'memberAssignments',
      'globalThisReferences',
    ],
    'composition-receiver-mutation': [
      'methodCalls',
      'memberAssignments',
      'globalThisReferences',
    ],
  },
  proofs: [
    {
      claim:
        'A producer and its private move read as one statement, as in the source.',
      file: 'src/vm/switch/values/copy-simplification.js',
      find: '    if (this.plan.has(producer.pc) || this.coalescedMovePcs.has(move.pc))',
      replace: '',
    },
    {
      claim:
        'Natural loops become structured loops, with protected throws, returns through finalizers and compound tests.',
      file: 'src/vm/switch/statements/statement-regions.js',
      find: "entries.push({ kind: 'loop', head: target })",
      replace: '',
    },
    {
      claim: 'Catch setups are read as protected regions.',
      file: 'src/vm/switch/model/control.js',
      find: "if (operation.kind === 'catch-setup')",
      replace: 'if (false)',
    },
    {
      claim: "A finally's throw pad is its own operand.",
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: 'throwPad: target(o[3]),',
      replace: '',
    },
    {
      claim: 'The spread sentinel comes from the container.',
      file: 'src/vm/jsconfuser-vm/wordcode/read-wordcode.js',
      find: 'names.sentinel = container.roles.sentinels.values.CALL_SPREAD',
      replace: '',
    },
    {
      claim:
        'A copy coalesces only with a producer it alone uses, so effectful producers stay.',
      file: 'src/vm/switch/values/copy-simplification.js',
      find: '    if (sites.length !== 1 || sites[0].pc !== move.pc) return',
      replace: '',
    },
    {
      claim:
        'A call whose callee is a read of its receiver is written as a method call.',
      file: 'src/vm/switch/emit/render.js',
      find: "    operation.receiver.kind === 'register' &&\n",
      replace: '    false &&\n',
    },
    {
      claim: "An exit from a try arm past the statement's end keeps its place.",
      file: 'src/vm/switch/statements/conditionals.js',
      find: 'fallthrough.ends.has(tryEnd) &&',
      replace: '',
    },
    {
      claim: 'ADD is written as +.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  ADD: '+',",
      replace: "\n  ADD: '-',",
    },
    {
      claim: 'SUB is written as -.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  SUB: '-',",
      replace: "\n  SUB: '+',",
    },
    {
      claim: 'MUL is written as *.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  MUL: '*',",
      replace: "\n  MUL: '/',",
    },
    {
      claim: 'DIV is written as /.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  DIV: '/',",
      replace: "\n  DIV: '*',",
    },
    {
      claim: 'MOD is written as %.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  MOD: '%',",
      replace: "\n  MOD: '*',",
    },
    {
      claim: 'EXP is written as **.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  EXP: '**',",
      replace: "\n  EXP: '*',",
    },
    {
      claim: 'BAND is written as &.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  BAND: '&',",
      replace: "\n  BAND: '|',",
    },
    {
      claim: 'BOR is written as |.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  BOR: '|',",
      replace: "\n  BOR: '&',",
    },
    {
      claim: 'BXOR is written as ^.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  BXOR: '^',",
      replace: "\n  BXOR: '|',",
    },
    {
      claim: 'SHL is written as <<.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  SHL: '<<',",
      replace: "\n  SHL: '>>',",
    },
    {
      claim: 'SHR is written as >>.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  SHR: '>>',",
      replace: "\n  SHR: '<<',",
    },
    {
      claim: 'USHR is written as >>>.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  USHR: '>>>',",
      replace: "\n  USHR: '>>',",
    },
    {
      claim: 'LT is written as <.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  LT: '<',",
      replace: "\n  LT: '>',",
    },
    {
      claim: 'GT is written as >.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  GT: '>',",
      replace: "\n  GT: '<',",
    },
    {
      claim: 'LTE is written as <=.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  LTE: '<=',",
      replace: "\n  LTE: '<',",
    },
    {
      claim: 'GTE is written as >=.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  GTE: '>=',",
      replace: "\n  GTE: '>',",
    },
    {
      claim: 'EQ is written as ===.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  EQ: '===',",
      replace: "\n  EQ: '!==',",
    },
    {
      claim: 'NEQ is written as !==.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  NEQ: '!==',",
      replace: "\n  NEQ: '===',",
    },
    {
      claim: 'LOOSE_EQ is written as ==.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  LOOSE_EQ: '==',",
      replace: "\n  LOOSE_EQ: '!=',",
    },
    {
      claim: 'LOOSE_NEQ is written as !=.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  LOOSE_NEQ: '!=',",
      replace: "\n  LOOSE_NEQ: '==',",
    },
    {
      claim: 'IN is written as in.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  IN: 'in',",
      replace: "\n  IN: '==',",
    },
    {
      claim: 'INSTANCEOF is written as instanceof.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  INSTANCEOF: 'instanceof',",
      replace: "\n  INSTANCEOF: '==',",
    },
    {
      claim: 'UNARY_NEG is written as -.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  UNARY_NEG: '-',",
      replace: "\n  UNARY_NEG: '+',",
    },
    {
      claim: 'UNARY_POS is written as +.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  UNARY_POS: '+',",
      replace: "\n  UNARY_POS: '-',",
    },
    {
      claim: 'UNARY_NOT is written as !.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  UNARY_NOT: '!',",
      replace: "\n  UNARY_NOT: '~',",
    },
    {
      claim: 'UNARY_BITNOT is written as ~.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "\n  UNARY_BITNOT: '~',",
      replace: "\n  UNARY_BITNOT: '!',",
    },
    {
      claim: 'An undefined constant is written as void 0.',
      file: 'src/vm/switch/model/operations.js',
      find: "if (value === undefined) return t.unaryExpression('void', t.numericLiteral(0))",
      replace: 'if (value === undefined) return t.nullLiteral()',
    },
    {
      claim: 'A debugger statement is written as one.',
      file: 'src/vm/jsconfuser-vm/numeric-to-vm-switch.js',
      find: "DEBUGGER: () => ({ kind: 'debugger' }),",
      replace: "DEBUGGER: () => ({ kind: 'debugger-unknown' }),",
    },
  ],
}
