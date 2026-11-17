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
