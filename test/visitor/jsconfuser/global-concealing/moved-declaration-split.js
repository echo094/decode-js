var globalVar;
globalVar = getGlobalVarFn();
function getGlobalVarFn() {
  return globalThis;
}
function getGlobal(mapping) {
  switch (mapping) {
    case "fake1":
      return globalVar["decoyName1"];
    case "realKey":
      return globalVar["console"];
    case "fake2":
      return globalVar["decoyName2"];
  }
}
function TEST_FUNCTION(a, b) {
  getGlobal("realKey")["log"]("hello");
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
