// One stage's own special condition.
export default {
  name: 'single-payload-stage-conditions',
  protects: "One stage's own special condition.",
  files: {
    'string-concealing': [
      {
        sources: ['strings-in-nested-closures', 'empty-string-and-utf-16'],
        profile: 'randomizeOpcodes+stringConcealing',
        seeds: [251],
      },
    ],
    'control-flow-flattening': [
      {
        sources: ['cff-loop-return'],
        profile: 'randomizeOpcodes+controlFlowFlattening',
        seeds: [251],
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
        seeds: [251],
      },
      // One program; each seed makes the stage write a different decode form.
      {
        sources: ['dispatcher-branches'],
        profile: 'dispatcher',
        seeds: [33],
        protects:
          'A route key split in two halves. Proved: keyParts order in decodeOrigin, analyze-dispatcher-wordcode.',
      },
      {
        sources: ['dispatcher-branches'],
        profile: 'dispatcher',
        seeds: [32],
        protects:
          'A decode closure returning an array. Proved: array resultMode in analyze-dispatcher-wordcode.',
      },
      {
        sources: ['dispatcher-branches'],
        profile: 'dispatcher',
        seeds: [35],
        protects:
          'A decode closure returning an object. Proved: object resultMode in analyze-dispatcher-wordcode.',
      },
    ],
    'conceal-constants': [
      {
        sources: ['constant-value-kinds', 'repeated-constants'],
        profile: 'randomizeOpcodes+concealConstants',
        seeds: [251],
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
        seeds: [251],
      },
      {
        sources: ['constant-arithmetic'],
        profile: 'antiInstrumentation',
        seeds: [2, 251],
      },
      {
        sources: ['for-in-iterator-number'],
        profile: 'antiInstrumentation',
        seeds: [251],
      },
    ],
    'aliased-opcodes': [
      {
        sources: ['every-aliased-opcode'],
        profile: 'randomizeOpcodes+aliasedOpcodes',
        seeds: [251],
      },
    ],
    'self-modifying': [
      {
        sources: ['self-modifying-try-and-closures'],
        profile: 'randomizeOpcodes+selfModifying',
        seeds: [251],
      },
    ],
  },
  cases: {
    'strings-in-nested-closures':
      'String bank capture threaded through nested closures. Proved: the need walk up parentByChild in normalize-string-concealing.',
    'empty-string-and-utf-16':
      'UTF-16 units in the string decoder. Proved: the 16-bit keystream word in decodeSlice; the empty string is also in the stage cells.',
    'cff-loop-return':
      'Split jumps and catch pops the flattener cannot tell from exit jumps. Proved: the catch exit target in try-ends.',
    'try-arm-exits':
      "Flattening moves each catch elsewhere; a try that never completes in an arm still leaves through the arm with no label. Proved: the try end in a conditional's arm in conditionals.",
    'try-routed-ends':
      'Under flattening a finally still ends where its routed exit lands, past the try. Proved: the routed tails in try-ends.',
    'labeled-exit-forms':
      "Labeled loop exits under flattening keep their statement label only where nothing else holds them. Proved: the loop's blockEnds in closeLaterExits, loop-ends.",
    'for-in-exit-label':
      'A for-in exit label equal to the closure register is not read as that register. Proved: the FOR_IN_NEXT layout in wordcode-operands.',
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
    'constant-arithmetic':
      'Two equal steps in one case: the first is real. Proved: real-step choice in analyze-anti-register-flow; seed 2 is the recorded shape.',
    'for-in-iterator-number':
      'A for-in iterator number off every boundary. Proved: the FOR_IN_NEXT layout in wordcode-operands.',
    'every-aliased-opcode':
      'Every opcode alias can target, EQ and UNARY_NOT included, which the stage cells do not hold. Not proved by a break.',
    'self-modifying-try-and-closures':
      'try and closures inside moved regions. Proved: the upvalue capture kind in read-wordcode.',
  },
  proofs: [
    {
      claim: 'try-arm-exits',
      file: 'src/vm/switch/statements/conditionals.js',
      find: 'fallthrough.ends.has(tryEnd) &&',
      replace: '',
    },
    {
      claim: 'try-routed-ends',
      file: 'src/vm/switch/statements/try-ends.js',
      find: 'tails = this.routedEnds(head).filter((id) => !enclosing.has(id))',
      replace: '',
    },
    {
      claim: 'labeled-exit-forms',
      file: 'src/vm/switch/statements/loop-ends.js',
      find: ': { end, blockEnds: ends }',
      replace: ': { end, blockEnds: [] }',
    },
    {
      claim: 'for-in-exit-label',
      file: 'src/vm/jsconfuser-vm/wordcode/wordcode-operands.js',
      find: "FOR_IN_NEXT: ['register', 'register', 'label'],",
      replace: '',
    },
    {
      claim: 'for-in-iterator-number',
      file: 'src/vm/jsconfuser-vm/wordcode/wordcode-operands.js',
      find: "FOR_IN_NEXT: ['register', 'register', 'label'],",
      replace: '',
    },
    {
      claim: 'dispatcher-branches seed 33',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-dispatcher-wordcode.js',
      find: ': keyParts[tail.keyRegisters.indexOf(register)],',
      replace: ': keyParts[0],',
    },
    {
      claim: 'dispatcher-branches seed 32',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-dispatcher-wordcode.js',
      find: "resultMode = { kind: 'array' }",
      replace: '',
    },
    {
      claim: 'dispatcher-branches seed 35',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-dispatcher-wordcode.js',
      find: "resultMode = { kind: 'object', key: pool[load.words[2]] }",
      replace: '',
    },
    {
      claim: 'anti-real-comparison',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-anti-register-flow.js',
      find: 'position === index || fakeStepMatches(other, instruction, model)',
      replace: 'fakeStepMatches(other, instruction, model)',
    },
    {
      claim: 'constant-arithmetic',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-anti-register-flow.js',
      find: 'const index = [...positions][0]',
      replace: 'const index = 0',
    },
    {
      claim: 'strings-in-nested-closures',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-string-concealing.js',
      find: 'need.add(parent)',
      replace: '',
    },
    {
      claim: 'empty-string-and-utf-16',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-string-concealing.js',
      find: '(bank[2 * (start + index)] | (bank[2 * (start + index) + 1] << 8)) ^ mask,',
      replace: '',
    },
    {
      claim: 'cff-loop-return',
      file: 'src/vm/switch/statements/try-ends.js',
      find: 'if (target) targets.add(target.id)',
      replace: '',
    },
    {
      claim: 'constant-value-kinds',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-concealed-constants.js',
      find: 'return value ^ key',
      replace: '',
    },
    {
      claim: 'repeated-constants',
      file: 'src/vm/jsconfuser-vm/normalize/normalize-concealed-constants.js',
      find: 'pairs.push({ index, key, keyPc: instruction.pc + offset })',
      replace: '',
    },
    {
      claim: 'anti-real-arithmetic',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-anti-register-flow.js',
      find: '  EXP: 3,',
      replace: '',
    },
    {
      claim: 'anti-real-unary-and-move',
      file: 'src/vm/jsconfuser-vm/normalize/analyze-anti-register-flow.js',
      find: '  UNARY_NOT: 2,',
      replace: '',
    },
    {
      claim: 'self-modifying-try-and-closures',
      file: 'src/vm/jsconfuser-vm/wordcode/wordcode-instructions.js',
      find: "kind: isLocal === 1 ? 'local' : 'upvalue',",
      replace: '',
    },
  ],

  // A program the stage cannot act on: its payload equals its plain encoding (M4). It is checked
  // by distinct-cells on the payload and decoded by no test.
  inertControls: [
    {
      source: 'no-eligible-string',
      profile: 'randomizeOpcodes+stringConcealing',
      seed: 251,
      protects: 'No string, so string concealing has no effect.',
    },
    {
      source: 'single-block-function',
      profile: 'randomizeOpcodes+controlFlowFlattening',
      seed: 251,
      protects: 'One block, so flattening has no effect.',
    },
    {
      source: 'no-repeated-window',
      profile: 'randomizeOpcodes+macroOpcodes',
      seed: 251,
      protects: 'No repeated window, so no macro.',
    },
  ],
}
