function TEST_FUNCTION(a, b) {
  console["log"]("sum is " + (a + b));
  return fetchGlobal(a, b);
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);