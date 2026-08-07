function getGlobal(mapping) {
  switch (mapping) {
    case "fake1":
      return otherVar["decoyName1"];
    case "realKey":
      return globalVar["console"];
  }
}
TEST_OUTPUT = getGlobal("realKey");