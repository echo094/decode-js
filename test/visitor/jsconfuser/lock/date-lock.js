function TEST_FUNCTION(a, b) {
  if (Date.now() < 1000) {
    while (true) {}
  }
  if (new Date().getTime() > 9999999999999) {
    while (true) {}
  }
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
