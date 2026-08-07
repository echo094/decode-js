function TEST_FUNCTION(a, b) {
  if (Date.now() == 1000) {
    invokeCountermeasures();
  }
  if (getTimestamp() < 1000) {
    invokeCountermeasures();
  }
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);