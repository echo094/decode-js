(function () {
  var namedFunction = function () {
    const test = function () {
      const regExp = new RegExp("other");
      return regExp["test"](namedFunction);
    };
    if (test()) {}
  };
  return namedFunction();
})();
function TEST_FUNCTION(a, b) {
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);