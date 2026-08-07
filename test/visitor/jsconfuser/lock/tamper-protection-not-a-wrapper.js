function nativeFunctionCheck() {
  function indexOf(str, substr) {
    return str.indexOf(substr);
  }
  function checkFunction(fn) {
    if (indexOf("" + fn, "{ [native code] }") === -1) {
      while (true) {}
      return undefined;
    }
    return fn;
  }
  var args = arguments;
  if (args.length === 1) {
    return checkFunction(args[0]);
  }
}
function TEST_FUNCTION(a, b) {
  return nativeFunctionCheck(fetchGlobal)(a, b);
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);