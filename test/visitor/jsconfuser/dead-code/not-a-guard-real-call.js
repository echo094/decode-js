function realFn() {}
if ("length" in realFn) {
  TEST_OUTPUT = "has length";
} else {
  TEST_OUTPUT = "no length";
}