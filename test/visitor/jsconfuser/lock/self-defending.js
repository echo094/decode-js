(function () {
  var namedFunction = function () {
    const test = function () {
      const regExp = new RegExp("\n");
      return regExp["test"](namedFunction);
    };
    if (test()) {
    }
  };
  return namedFunction();
})();
function TEST_FUNCTION(a, b) {
  (function () {
    var namedFunction = function () {
      const test = function () {
        const regExp = new RegExp("\n");
        return regExp["test"](namedFunction);
      };
      if (test()) {
      }
    };
    return namedFunction();
  })();
  return a + b;
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
