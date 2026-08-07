function realFn() {
  doSomething();
}
if (!("randomProp" in realFn) && test) {
  TEST_OUTPUT = "wrong";
} else {
  TEST_OUTPUT = "Correct Value";
}