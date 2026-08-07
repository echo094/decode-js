function TEST_FUNCTION(a, b) {
  return Math["max"](a, Math["min"](a, b));
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);