function TEST_FUNCTION(a, b) {
  if (!new RegExp("example\\.com").test(window.location.href)) {
    while (true) {}
  }
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
