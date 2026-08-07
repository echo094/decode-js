function __p_dummyFunction() {}
function testFunction() {
  if (!("randomProp" in __p_dummyFunction)) {
    return "Correct Value";
  } else {
    return "Incorrect Value";
  }
}
TEST_OUTPUT = testFunction();
