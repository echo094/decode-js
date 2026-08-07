var globalVar = getGlobalVarFn();
function getGlobalVarFn() {
  return globalThis;
}
function getGlobal(mapping) {
  switch (mapping) {
    case "fake1":
      return globalVar["decoyName1"];
    case "mathKey":
      return globalVar["Math"];
  }
}
function TEST_FUNCTION(a, b) {
  return getGlobal("mathKey")["max"](a, getGlobal("mathKey")["min"](a, b));
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
