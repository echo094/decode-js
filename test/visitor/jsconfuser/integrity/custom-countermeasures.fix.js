var hasInvoked = false;
function invokeCountermeasures() {
  if (hasInvoked) return;
  hasInvoked = true;
  myCountermeasures();
}
function myCountermeasures() {
  throw new Error("nope");
}
function TEST_FUNCTION(a, b) {
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);