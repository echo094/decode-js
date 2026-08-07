function __p_dummyFunction() {}
var test = false;
if (!("randomProp" in __p_dummyFunction) && test) {
  TEST_OUTPUT = "wrong";
} else {
  TEST_OUTPUT = "Correct Value";
}
