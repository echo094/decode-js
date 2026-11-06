// One stage's own special condition.
export default {
  name: 'single-payload-stage-conditions',
  protects: "One stage's own special condition.",
  files: {
    'string-concealing': [
      {
        sources: [
          'strings-in-nested-closures',
          'empty-string-and-utf-16',
          'no-eligible-string',
        ],
        profile: 'randomizeOpcodes+stringConcealing',
        seeds: [251, 252, 253],
      },
    ],
    'control-flow-flattening': [
      {
        sources: ['single-block-function', 'cff-loop-return'],
        profile: 'randomizeOpcodes+controlFlowFlattening',
        seeds: [251, 252, 253],
      },
      {
        sources: ['labeled-exit-forms', 'try-arm-exits', 'try-routed-ends'],
        profile: 'controlFlowFlattening',
        seeds: [251],
      },
    ],
    dispatcher: [
      {
        sources: ['for-in-exit-label'],
        profile: 'randomizeOpcodes+dispatcher',
        seeds: [251, 252, 253],
      },
      {
        sources: ['dispatcher-split-key'],
        profile: 'dispatcher',
        seeds: [33],
      },
      {
        sources: ['dispatcher-array-result'],
        profile: 'dispatcher',
        seeds: [32],
      },
      {
        sources: ['dispatcher-object-result'],
        profile: 'dispatcher',
        seeds: [35],
      },
    ],
    'conceal-constants': [
      {
        sources: ['constant-value-kinds', 'repeated-constants'],
        profile: 'randomizeOpcodes+concealConstants',
        seeds: [251, 252, 253],
      },
    ],
    'anti-instrumentation': [
      {
        sources: [
          'anti-real-arithmetic',
          'anti-real-comparison',
          'anti-real-unary-and-move',
        ],
        profile: 'randomizeOpcodes+antiInstrumentation',
        seeds: [251, 252, 253],
      },
      {
        sources: ['anti-runtime-duplicate-step'],
        profile: 'antiInstrumentation',
        seeds: [2, 251, 252],
      },
      {
        sources: ['for-in-iterator-number'],
        profile: 'antiInstrumentation',
        seeds: [251, 252, 253],
      },
    ],
    'macro-opcodes': [
      {
        sources: ['no-repeated-window'],
        profile: 'randomizeOpcodes+macroOpcodes',
        seeds: [251, 252, 253],
      },
    ],
    'aliased-opcodes': [
      {
        sources: ['every-aliased-opcode'],
        profile: 'randomizeOpcodes+aliasedOpcodes',
        seeds: [251, 252, 253],
      },
    ],
    'self-modifying': [
      {
        sources: ['self-modifying-try-and-closures'],
        profile: 'randomizeOpcodes+selfModifying',
        seeds: [251, 252, 253],
      },
    ],
  },
  cases: {
    'strings-in-nested-closures':
      'String bank capture threaded through nested closures. Proved: the need walk up parentByChild in normalize-string-concealing.',
    'empty-string-and-utf-16':
      'UTF-16 units in the string decoder. Proved: the 16-bit keystream word in decodeSlice; the empty string is also in the stage cells.',
    'no-eligible-string':
      'Inert control: no string, so the stage has no effect. Proved by distinct-cells.',
    'single-block-function':
      'Inert control: one block, so flattening has no effect. Proved by distinct-cells.',
    'cff-loop-return':
      'Split jumps and catch pops the flattener cannot tell from exit jumps (fix history R-08). Proved: the catch exit target in vm-switch-statements.',
    'try-arm-exits':
      "Flattening moves each catch elsewhere; a try that never completes in an arm still leaves through the arm with no label. Proved: the try end in a conditional's arm in vm-switch-statements.",
    'try-routed-ends':
      'Under flattening a finally still ends where its routed exit lands, past the try. Proved: the routed tails in vm-switch-statements.',
    'labeled-exit-forms':
      "Labeled loop exits under flattening keep their statement label only where nothing else holds them. Proved: the loop's blockEnds in closeLaterExits, vm-switch-statements.",
    'for-in-exit-label':
      'A for-in exit label equal to the closure register is not read as that register. Proved: FOR_IN_NEXT labelOffset in read-wordcode (65b3d98).',
    'dispatcher-split-key':
      'A route key split in two halves. Proved: keyParts order in decodeOrigin, observe-dispatcher-wordcode (seed 33).',
    'dispatcher-array-result':
      'A decode closure returning an array. Proved: array resultMode in observe-dispatcher-wordcode (seed 32).',
    'dispatcher-object-result':
      'A decode closure returning an object. Proved: object resultMode in observe-dispatcher-wordcode (seed 35).',
    'constant-value-kinds':
      'Concealed zero, negative, large int32 and float values. Proved: the full 32-bit XOR in restoreConcealedValue; the stage cells hold no large integer.',
    'repeated-constants':
      'Repeated integers sharing one pool entry and key. Proved: every use clears its key word in normalize-concealed-constants.',
    'anti-real-arithmetic':
      'The real step of an arithmetic case. Proved: real EXP in analyze-anti-register-flow; the other operations are in the stage cells.',
    'anti-real-comparison':
      'The real step of a comparison case. Proved: fakeStepMatches in analyze-anti-register-flow, which the stage cells do not catch.',
    'anti-real-unary-and-move':
      'The real step of unary and MOVE cases. Proved: real UNARY_NOT in analyze-anti-register-flow; the other operations are in the stage cells.',
    'anti-runtime-duplicate-step':
      'Two equal steps in one case: the first is real. Proved: real-step choice in analyze-anti-register-flow; seed 2 is the recorded shape.',
    'for-in-iterator-number':
      'A for-in iterator number off every boundary. Proved: FOR_IN_NEXT labelOffset in read-wordcode (65b3d98).',
    'no-repeated-window':
      'Inert control: no repeated window, so no macro. Proved by distinct-cells.',
    'every-aliased-opcode':
      'Every opcode alias can target. Proved: aliases of EQ and UNARY_NOT in observe-aliased-runtime, which the stage cells do not hold.',
    'self-modifying-try-and-closures':
      'try and closures inside moved regions. Proved: the upvalue capture kind in read-wordcode.',
  },
  proofs: [
    {
      claim: 'try-arm-exits',
      file: 'src/vm/switch/vm-switch-statements.js',
      code: 'reached.get(fallthroughId).has(tryEnd) &&',
    },
    {
      claim: 'try-routed-ends',
      file: 'src/vm/switch/vm-switch-statements.js',
      code: 'tails = routedEnds(item.head).filter((id) => !enclosing.has(id))',
    },
    {
      claim: 'labeled-exit-forms',
      file: 'src/vm/switch/vm-switch-statements.js',
      code: '      : { end, blockEnds: ends }',
    },
    {
      claim: 'for-in-exit-label',
      file: 'src/vm/jsconfuser-vm/read-wordcode.js',
      code: "name === 'FOR_IN_NEXT'\n        ? 2",
    },
    {
      claim: 'for-in-iterator-number',
      file: 'src/vm/jsconfuser-vm/read-wordcode.js',
      code: "name === 'FOR_IN_NEXT'\n        ? 2",
    },
    {
      claim: 'dispatcher-split-key',
      file: 'src/vm/jsconfuser-vm/observe-dispatcher-wordcode.js',
      code: ': keyParts[tail.keyRegisters.indexOf(register)],',
    },
    {
      claim: 'dispatcher-array-result',
      file: 'src/vm/jsconfuser-vm/observe-dispatcher-wordcode.js',
      code: "resultMode = { kind: 'array' }",
    },
    {
      claim: 'dispatcher-object-result',
      file: 'src/vm/jsconfuser-vm/observe-dispatcher-wordcode.js',
      code: "resultMode = { kind: 'object', key: pool[load.words[2]] }",
    },
    {
      claim: 'anti-real-comparison',
      file: 'src/vm/jsconfuser-vm/analyze-anti-register-flow.js',
      code: 'position === index ||\n                fakeStepMatches(',
    },
    {
      claim: 'anti-runtime-duplicate-step',
      file: 'src/vm/jsconfuser-vm/analyze-anti-register-flow.js',
      code: 'const index = [...positions][0]',
    },
    {
      claim: 'strings-in-nested-closures',
      file: 'src/vm/jsconfuser-vm/normalize-string-concealing.js',
      code: 'need.add(parent)',
    },
    {
      claim: 'empty-string-and-utf-16',
      file: 'src/vm/jsconfuser-vm/normalize-string-concealing.js',
      code: '(bank[2 * (start + index)] | (bank[2 * (start + index) + 1] << 8)) ^ mask,',
    },
    {
      claim: 'cff-loop-return',
      file: 'src/vm/switch/vm-switch-statements.js',
      code: 'if (target) targets.add(target.id)',
    },
    {
      claim: 'constant-value-kinds',
      file: 'src/vm/jsconfuser-vm/normalize-concealed-constants.js',
      code: 'return value ^ key',
    },
    {
      claim: 'repeated-constants',
      file: 'src/vm/jsconfuser-vm/normalize-concealed-constants.js',
      code: 'pairs.push({ index, key, keyPc: instruction.pc + offset })',
    },
    {
      claim: 'anti-real-arithmetic',
      file: 'src/vm/jsconfuser-vm/analyze-anti-register-flow.js',
      code: '  EXP: 3,',
    },
    {
      claim: 'anti-real-unary-and-move',
      file: 'src/vm/jsconfuser-vm/analyze-anti-register-flow.js',
      code: '  UNARY_NOT: 2,',
    },
    {
      claim: 'every-aliased-opcode',
      file: 'src/vm/jsconfuser-vm/observe-aliased-runtime.js',
      code: "if (found?.kind !== 'alias') continue",
    },
    {
      claim: 'self-modifying-try-and-closures',
      file: 'src/vm/jsconfuser-vm/read-wordcode.js',
      code: "kind: isLocal === 1 ? 'local' : 'upvalue',",
    },
  ],
  inertControls: [
    'no-eligible-string',
    'single-block-function',
    'no-repeated-window',
  ],
}
