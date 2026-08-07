(function () {
  var namedFunction = function () {
    const test = function () {
      const regExp = new RegExp("\n");
      return regExp["test"](namedFunction);
    };
    if (test()) {
      invokeCountermeasures();
    }
  };
  return namedFunction();
})();
var hasInvoked = false;
function invokeCountermeasures() {
  if (hasInvoked) return;
  hasInvoked = true;
  myCountermeasures();
}
function myCountermeasures() {
  TEST_OUTPUT = "countermeasures ran";
}
function TEST_FUNCTION(a, b) {
  if (userDefinedFlag) {
    invokeCountermeasures();
  }
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
