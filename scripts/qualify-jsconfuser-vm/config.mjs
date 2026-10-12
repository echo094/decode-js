export const sources = {
  spread: "function sum(a, b) { return a + b; } const args = [2, 5]; window.TEST_OUTPUT = sum(...args);",
  arithmetic: "window.TEST_OUTPUT = (6 * 7 + 3) % 5;",
  branches:
    "let value = 0; for (let i = 0; i < 4; i++) { if (i % 2) value += i; else value -= i; } window.TEST_OUTPUT = value;",
  closures:
    "function counter(start) { let value = start; return () => ++value; } const next = counter(3); window.TEST_OUTPUT = [next(), next()];",
  nestedStrings:
    'function outer(prefix) { return function middle(n) { return function inner() { return prefix + ":" + n; }; }; } window.TEST_OUTPUT = outer("id")(7)();',
  collections:
    "const object = { a: 2, b: 5 }; const list = [object.a, object.b]; window.TEST_OUTPUT = list.map((x) => x * 2);",
  repeatedArrays:
    "const a = [1, 2]; const b = [3, 4]; const c = [5, 6]; window.TEST_OUTPUT = [a, b, c];",
  switch:
    'function classify(value) { switch (value) { case 1: return "one"; case 2: return "two"; default: return "other"; } } window.TEST_OUTPUT = [classify(1), classify(3)];',
  forIn:
    "const object = { a: 2, b: 5 }; let sum = 0; for (const key in object) sum += object[key]; window.TEST_OUTPUT = sum;",
  methods:
    "const object = { value: 3, double() { return this.value * 2; } }; window.TEST_OUTPUT = object.double();",
  tryCatch:
    'function check(value) { try { if (value < 0) throw new Error("negative"); return value + 1; } catch (error) { return error.message; } } window.TEST_OUTPUT = [check(-1), check(4)];',
  throwCatch:
    'function check() { try { throw new Error("caught"); } catch (error) { return error.message; } } window.TEST_OUTPUT = check();',
  tryFinally:
    "let count = 0; function check(value) { try { return value + 1; } finally { count++; } } window.TEST_OUTPUT = [check(4), count];",
  exceptions:
    'function check(value) { try { if (value < 0) throw new Error("negative"); return value + 1; } catch (error) { return error.message; } finally { window.finished = true; } } window.TEST_OUTPUT = [check(-1), check(4), window.finished];',
  exceptionRoutes:
    'const trace = []; function make() { let count = 0; return function run(mode) { try { trace.push("try:" + mode); if (mode === 0) JSON.parse("{"); if (mode === 1) { const value = null; value.missing; } if (mode === 2) throw new Error("explicit"); return ++count; } catch (error) { trace.push("catch:" + error.name); return ++count; } finally { trace.push("finally:" + mode); } }; } const run = make(); window.TEST_OUTPUT = [run(0), run(1), run(2), run(3), trace];',
};

const representationOptions = [
  "randomizeOpcodes",
  "shuffleOpcodes",
  "encodeBytecode",
  "concealConstants",
  "controlFlowFlattening",
  "dispatcher",
  "stringConcealing",
  "macroOpcodes",
  "specializedOpcodes",
  "aliasedOpcodes",
  "antiInstrumentation",
  "selfModifying",
  "timingChecks",
  "classObfuscation",
  "handlerTable",
  "minify",
];

export const baselineOptions = Object.fromEntries(
  representationOptions.map((option) => [option, false]),
);
baselineOptions.target = "browser";

export const profiles = {
  baseline: {},
  randomizeOpcodesClassObfuscation: { randomizeOpcodes: true, classObfuscation: true },
  randomizeOpcodesClassObfuscationMinify: { randomizeOpcodes: true, classObfuscation: true, minify: true },
  randomizeOpcodesMinify: { randomizeOpcodes: true, minify: true },
  ...Object.fromEntries(
    representationOptions.map((option) => [option, { [option]: true }]),
  ),
  stringConcealingControlFlowFlattening: {
    stringConcealing: true,
    controlFlowFlattening: true,
  },
  stringConcealingDispatcher: {
    stringConcealing: true,
    dispatcher: true,
  },
  controlFlowFlatteningDispatcher: {
    controlFlowFlattening: true,
    dispatcher: true,
  },
  stringConcealingControlFlowFlatteningDispatcher: {
    stringConcealing: true,
    controlFlowFlattening: true,
    dispatcher: true,
  },
  stringConcealingConcealConstants: {
    stringConcealing: true,
    concealConstants: true,
  },
  controlFlowFlatteningConcealConstants: {
    controlFlowFlattening: true,
    concealConstants: true,
  },
  dispatcherConcealConstants: {
    dispatcher: true,
    concealConstants: true,
  },
  stringConcealingControlFlowFlatteningConcealConstants: {
    stringConcealing: true,
    controlFlowFlattening: true,
    concealConstants: true,
  },
  stringConcealingDispatcherConcealConstants: {
    stringConcealing: true,
    dispatcher: true,
    concealConstants: true,
  },
  controlFlowFlatteningDispatcherConcealConstants: {
    controlFlowFlattening: true,
    dispatcher: true,
    concealConstants: true,
  },
  stringConcealingControlFlowFlatteningDispatcherConcealConstants: {
    stringConcealing: true,
    controlFlowFlattening: true,
    dispatcher: true,
    concealConstants: true,
  },
  concealConstantsAntiInstrumentation: {
    concealConstants: true,
    antiInstrumentation: true,
  },
  stringConcealingAntiInstrumentation: {
    stringConcealing: true,
    antiInstrumentation: true,
  },
  controlFlowFlatteningAntiInstrumentation: {
    controlFlowFlattening: true,
    antiInstrumentation: true,
  },
  dispatcherAntiInstrumentation: {
    dispatcher: true,
    antiInstrumentation: true,
  },
  antiInstrumentationSpecializedOpcodes: {
    antiInstrumentation: true,
    specializedOpcodes: true,
  },
  antiInstrumentationMacroOpcodes: {
    antiInstrumentation: true,
    macroOpcodes: true,
  },
  specializedOpcodesMacroOpcodes: {
    specializedOpcodes: true,
    macroOpcodes: true,
  },
  antiInstrumentationSpecializedOpcodesMacroOpcodes: {
    antiInstrumentation: true,
    specializedOpcodes: true,
    macroOpcodes: true,
  },
  macroOpcodesAliasedOpcodes: {
    macroOpcodes: true,
    aliasedOpcodes: true,
  },
  aliasedOpcodesShuffleOpcodes: {
    aliasedOpcodes: true,
    shuffleOpcodes: true,
  },
  aliasedOpcodesHandlerTable: {
    aliasedOpcodes: true,
    handlerTable: true,
  },
  shuffleOpcodesHandlerTable: {
    shuffleOpcodes: true,
    handlerTable: true,
  },
  classObfuscationHandlerTable: {
    classObfuscation: true,
    handlerTable: true,
  },
  encodeBytecodeClassObfuscation: {
    encodeBytecode: true,
    classObfuscation: true,
  },
  encodeBytecodeHandlerTable: {
    encodeBytecode: true,
    handlerTable: true,
  },
  encodeBytecodeClassObfuscationHandlerTable: {
    encodeBytecode: true,
    classObfuscation: true,
    handlerTable: true,
  },
  randomizeOpcodesHandlerTable: {
    randomizeOpcodes: true,
    handlerTable: true,
  },
  randomizeOpcodesEncodeBytecode: {
    randomizeOpcodes: true,
    encodeBytecode: true,
  },
  randomizeOpcodesClassObfuscation: {
    randomizeOpcodes: true,
    classObfuscation: true,
  },
  aliasedOpcodesClassObfuscation: {
    aliasedOpcodes: true,
    classObfuscation: true,
  },
  aliasedOpcodesHandlerTableClassObfuscation: {
    aliasedOpcodes: true,
    handlerTable: true,
    classObfuscation: true,
  },
  specializedOpcodesClassObfuscation: {
    specializedOpcodes: true,
    classObfuscation: true,
  },
  macroOpcodesClassObfuscation: {
    macroOpcodes: true,
    classObfuscation: true,
  },
  antiInstrumentationClassObfuscation: {
    antiInstrumentation: true,
    classObfuscation: true,
  },
  aliasedOpcodesShuffleOpcodesHandlerTable: {
    aliasedOpcodes: true,
    shuffleOpcodes: true,
    handlerTable: true,
  },
  antiInstrumentationAliasedOpcodes: {
    antiInstrumentation: true,
    aliasedOpcodes: true,
  },
  specializedOpcodesAliasedOpcodes: {
    specializedOpcodes: true,
    aliasedOpcodes: true,
  },
  antiInstrumentationMacroOpcodesAliasedOpcodes: {
    antiInstrumentation: true,
    macroOpcodes: true,
    aliasedOpcodes: true,
  },
  specializedOpcodesMacroOpcodesAliasedOpcodes: {
    specializedOpcodes: true,
    macroOpcodes: true,
    aliasedOpcodes: true,
  },
  antiInstrumentationSpecializedOpcodesAliasedOpcodes: {
    antiInstrumentation: true,
    specializedOpcodes: true,
    aliasedOpcodes: true,
  },
  antiInstrumentationSpecializedOpcodesMacroOpcodesAliasedOpcodes: {
    antiInstrumentation: true,
    specializedOpcodes: true,
    macroOpcodes: true,
    aliasedOpcodes: true,
  },
  stringConcealingControlFlowFlatteningDispatcherConcealConstantsAntiInstrumentationSpecializedOpcodesMacroOpcodesAliasedOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
      macroOpcodes: true,
      aliasedOpcodes: true,
    },
  stringConcealingControlFlowFlatteningDispatcherAntiInstrumentation: {
    stringConcealing: true,
    controlFlowFlattening: true,
    dispatcher: true,
    antiInstrumentation: true,
  },
  stringConcealingControlFlowFlatteningConcealConstantsAntiInstrumentation: {
    stringConcealing: true,
    controlFlowFlattening: true,
    concealConstants: true,
    antiInstrumentation: true,
  },
  stringConcealingDispatcherConcealConstantsAntiInstrumentation: {
    stringConcealing: true,
    dispatcher: true,
    concealConstants: true,
    antiInstrumentation: true,
  },
  controlFlowFlatteningDispatcherConcealConstantsAntiInstrumentation: {
    controlFlowFlattening: true,
    dispatcher: true,
    concealConstants: true,
    antiInstrumentation: true,
  },
  stringConcealingControlFlowFlatteningDispatcherConcealConstantsAntiInstrumentation:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
      antiInstrumentation: true,
    },
  controlFlowFlatteningDispatcherConcealConstantsAntiInstrumentationSpecializedOpcodes:
    {
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
    },
  stringConcealingDispatcherConcealConstantsAntiInstrumentationSpecializedOpcodes:
    {
      stringConcealing: true,
      dispatcher: true,
      concealConstants: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
    },
  stringConcealingControlFlowFlatteningConcealConstantsAntiInstrumentationSpecializedOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      concealConstants: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
    },
  stringConcealingControlFlowFlatteningDispatcherAntiInstrumentationSpecializedOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
    },
  stringConcealingControlFlowFlatteningDispatcherConcealConstantsSpecializedOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
      specializedOpcodes: true,
    },
  stringConcealingControlFlowFlatteningDispatcherConcealConstantsAntiInstrumentationSpecializedOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
    },
  stringConcealingControlFlowFlatteningDispatcherConcealConstantsAntiInstrumentationMacroOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
      antiInstrumentation: true,
      macroOpcodes: true,
    },
  stringConcealingControlFlowFlatteningDispatcherConcealConstantsSpecializedOpcodesMacroOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
      specializedOpcodes: true,
      macroOpcodes: true,
    },
  stringConcealingControlFlowFlatteningDispatcherAntiInstrumentationSpecializedOpcodesMacroOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
      macroOpcodes: true,
    },
  stringConcealingControlFlowFlatteningConcealConstantsAntiInstrumentationSpecializedOpcodesMacroOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      concealConstants: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
      macroOpcodes: true,
    },
  stringConcealingDispatcherConcealConstantsAntiInstrumentationSpecializedOpcodesMacroOpcodes:
    {
      stringConcealing: true,
      dispatcher: true,
      concealConstants: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
      macroOpcodes: true,
    },
  controlFlowFlatteningDispatcherConcealConstantsAntiInstrumentationSpecializedOpcodesMacroOpcodes:
    {
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
      macroOpcodes: true,
    },
  stringConcealingControlFlowFlatteningDispatcherConcealConstantsAntiInstrumentationSpecializedOpcodesMacroOpcodes:
    {
      stringConcealing: true,
      controlFlowFlattening: true,
      dispatcher: true,
      concealConstants: true,
      antiInstrumentation: true,
      specializedOpcodes: true,
      macroOpcodes: true,
    },
};

const eightOptionAliasStack = [
  "stringConcealing",
  "controlFlowFlattening",
  "dispatcher",
  "concealConstants",
  "antiInstrumentation",
  "specializedOpcodes",
  "macroOpcodes",
  "aliasedOpcodes",
];
for (const omitted of eightOptionAliasStack.filter(
  (option) => option !== "aliasedOpcodes",
)) {
  profiles[
    `eightOptionAliasStackWithout${omitted[0].toUpperCase()}${omitted.slice(1)}`
  ] = Object.fromEntries(
    eightOptionAliasStack
      .filter((option) => option !== omitted)
      .map((option) => [option, true]),
  );
}

const nineOptionAliasShuffleStack = [
  ...eightOptionAliasStack,
  "shuffleOpcodes",
];
profiles.nineOptionAliasShuffleStack = Object.fromEntries(
  nineOptionAliasShuffleStack.map((option) => [option, true]),
);
for (const omitted of nineOptionAliasShuffleStack.filter(
  (option) => option !== "shuffleOpcodes",
)) {
  profiles[
    `nineOptionAliasShuffleStackWithout${omitted[0].toUpperCase()}${omitted.slice(1)}`
  ] = Object.fromEntries(
    nineOptionAliasShuffleStack
      .filter((option) => option !== omitted)
      .map((option) => [option, true]),
  );
}

const tenOptionAliasShuffleHandlerStack = [
  ...nineOptionAliasShuffleStack,
  "handlerTable",
];
profiles.tenOptionAliasShuffleHandlerStack = Object.fromEntries(
  tenOptionAliasShuffleHandlerStack.map((option) => [option, true]),
);
for (const omitted of tenOptionAliasShuffleHandlerStack.filter(
  (option) => option !== "handlerTable",
)) {
  profiles[
    `tenOptionAliasShuffleHandlerStackWithout${omitted[0].toUpperCase()}${omitted.slice(1)}`
  ] = Object.fromEntries(
    tenOptionAliasShuffleHandlerStack
      .filter((option) => option !== omitted)
      .map((option) => [option, true]),
  );
}

const elevenOptionClassStack = [
  ...tenOptionAliasShuffleHandlerStack,
  "classObfuscation",
];
profiles.elevenOptionClassStack = Object.fromEntries(
  elevenOptionClassStack.map((option) => [option, true]),
);
for (const omitted of elevenOptionClassStack.filter(
  (option) => option !== "classObfuscation",
)) {
  profiles[
    `elevenOptionClassStackWithout${omitted[0].toUpperCase()}${omitted.slice(1)}`
  ] = Object.fromEntries(
    elevenOptionClassStack
      .filter((option) => option !== omitted)
      .map((option) => [option, true]),
  );
}

const twelveOptionEncodedStack = [...elevenOptionClassStack, "encodeBytecode"];
profiles.twelveOptionEncodedStack = Object.fromEntries(
  twelveOptionEncodedStack.map((option) => [option, true]),
);
for (const omitted of twelveOptionEncodedStack) {
  profiles[
    `twelveOptionEncodedStackWithout${omitted[0].toUpperCase()}${omitted.slice(1)}`
  ] = Object.fromEntries(
    twelveOptionEncodedStack
      .filter((option) => option !== omitted)
      .map((option) => [option, true]),
  );
}

profiles.selfModifyingEncodeBytecode = {
  selfModifying: true,
  encodeBytecode: true,
};
for (const option of [
  "aliasedOpcodes",
  "macroOpcodes",
  "specializedOpcodes",
  "antiInstrumentation",
  "classObfuscation",
  "handlerTable",
]) {
  profiles[`selfModifying${option[0].toUpperCase()}${option.slice(1)}`] = {
    selfModifying: true,
    [option]: true,
  };
}
profiles.twelveOptionSelfModifyingStack = Object.fromEntries(
  [...twelveOptionEncodedStack, "selfModifying"].map((option) => [
    option,
    true,
  ]),
);
for (const option of ["encodeBytecode", "classObfuscation", "handlerTable"]) {
  profiles[`minify${option[0].toUpperCase()}${option.slice(1)}`] = {
    minify: true,
    [option]: true,
  };
}
profiles.minifySelfModifying = { minify: true, selfModifying: true };
profiles.minifySelfModifyingEncodeBytecode = {
  minify: true,
  selfModifying: true,
  encodeBytecode: true,
};
