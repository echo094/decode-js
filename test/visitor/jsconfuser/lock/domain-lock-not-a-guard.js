function TEST_FUNCTION(a, b) {
  if (!new RegExp("example\\.com").test(location.href)) {
    invokeCountermeasures();
  }
  if (new RegExp("example\\.com").test(window.location.href)) {
    invokeCountermeasures();
  }
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);