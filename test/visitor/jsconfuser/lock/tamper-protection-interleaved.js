function nativeFunctionCheck() {
  function indexOf(str, substr) {
    const len = str.length;
    const sublen = substr.length;
    let count = 0;
    if (sublen > len) {
      return -1;
    }
    for (let i = 0; i <= len - sublen; i++) {
      for (let j = 0; j < sublen; j++) {
        if (str[i + j] === substr[j]) {
          count++;
          if (count === sublen) {
            return i;
          }
        } else {
          count = 0;
          break;
        }
      }
    }
    return -1;
  }
  function checkFunction(fn) {
    if (indexOf("" + fn, "{ [native code] }") === -1 || typeof Object.getOwnPropertyDescriptor(fn, "toString") !== "undefined") {
      if (Date.now() < 500) {
        while (true) {}
      }
      while (true) {}
      return undefined;
    }
    return fn;
  }
  var args = arguments;
  if (args.length === 1) {
    if (Date.now() < 500) {
      while (true) {}
    }
    return checkFunction(args[0]);
  } else if (args.length === 2) {
    var object = args[0];
    var property = args[1];
    var fn = object[property];
    fn = checkFunction(fn);
    return fn.bind(object);
  }
}
(function () {
  function isStrictMode() {
    try {
      if (!new RegExp("example\\.com").test(window.location.href)) {
        while (true) {}
      }
      var arr = [];
      delete arr["length"];
    } catch (e) {
      return true;
    }
    return false;
  }
  if (isStrictMode()) {
    while (true) {}
    nativeFunctionCheck = undefined;
  }
})();
function TEST_FUNCTION(a, b) {
  if (Date.now() < 500) {
    while (true) {}
  }
  nativeFunctionCheck(console, "log")("sum is " + (a + b));
  return nativeFunctionCheck(fetchGlobal)(a, b);
}
TEST_OUTPUT = TEST_FUNCTION(1, 2);
