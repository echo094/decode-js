// Every stage at once. Proved: signed Weyl constant in normalize-string-concealing.
export default {
  name: 'all-stages-together',
  protects:
    'Every stage at once. Proved: signed Weyl constant in normalize-string-concealing.',
  files: {
    'composition-loop-dependent-calls': [
      {
        sources: ['composition-loop-dependent-calls'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-switch-flow': [
      {
        sources: ['f-switch-flow'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-labeled-control': [
      {
        sources: ['f-labeled-control'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-for-in-enumeration': [
      {
        sources: ['f-for-in-enumeration'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    operators: [
      {
        sources: ['operators'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-short-circuit': [
      {
        sources: ['f-short-circuit'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-expression-mutation': [
      {
        sources: ['f-expression-mutation'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-this-receiver': [
      {
        sources: ['f-this-receiver'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-arrow-lexical-state': [
      {
        sources: ['f-arrow-lexical-state'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-accessors-and-methods': [
      {
        sources: ['f-accessors-and-methods'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-literals-order': [
      {
        sources: ['f-literals-order'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
    'f-debugger-order': [
      {
        sources: ['f-debugger-order'],
        profile:
          'randomizeOpcodes+stringConcealing+controlFlowFlattening+dispatcher+concealConstants+antiInstrumentation+specializedOpcodes+macroOpcodes+aliasedOpcodes+selfModifying+encodeBytecode+timingChecks+shuffleOpcodes+handlerTable+classObfuscation+minify',
        seeds: [251, 252, 253],
      },
    ],
  },
  proofs: [
    {
      claim:
        'Specialized operands up to a full 32-bit word under the anti and concealed stack (old normalize-anti-specialized-combinations).',
      file: 'src/vm/jsconfuser-vm/observe-specialized-runtime.js',
      code: 'value <= 0xffffffff',
    },
    {
      claim: 'all-stages-together',
      file: 'src/vm/jsconfuser-vm/normalize-string-concealing.js',
      code: 'if (raw === -1640531527) return 0x9e3779b9',
    },
  ],
}
